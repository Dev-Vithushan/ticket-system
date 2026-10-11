import type { Prisma, SlaPolicy, TicketPriority, TicketSource, TicketStatus } from '@prisma/client';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { pageMeta } from '../../lib/http';
import { prisma, type Tx } from '../../lib/prisma';
import type { AuthContext } from '../../lib/types';
import { createNotifications, dispatch, teamMembers, teamSupervisors, type PendingDelivery } from '../../services/notifications/notify';
import { getSettings } from '../../services/settings';
import { PERMISSIONS } from '../auth/permissions';
import { computeDeadlines, evaluateSla } from '../sla/sla.service';
import { recordHistory, lockTicket, type HistoryEntry } from './history';
import { nextTicketNumber } from './numbering';
import { canSeeInternal, ticketScope } from './scope';
import { ACTIVE_STATUSES, DONE_STATUSES, TRANSITIONS, transitionError } from './workflow';

// ───────────────────────────── Shared helpers ─────────────────────────────

const userBrief = { select: { id: true, name: true, email: true } } as const;

export async function policyThresholds(): Promise<Map<TicketPriority, SlaPolicy>> {
  const policies = await prisma.slaPolicy.findMany({ where: { isActive: true } });
  return new Map(policies.map((p) => [p.priority, p]));
}

/** Loads a ticket the caller is allowed to see, or throws 404 (never reveals existence). */
export async function findVisibleTicket(id: string, auth: AuthContext, tx: Tx = prisma) {
  const ticket = await tx.ticket.findFirst({ where: { AND: [{ id }, ticketScope(auth)] } });
  if (!ticket || ticket.archivedAt) throw notFound('Ticket');
  return ticket;
}

export type TicketRow = Awaited<ReturnType<typeof findVisibleTicket>>;

/** Server-side capability matrix for one ticket; the UI uses it to show only actions the API will accept. */
export function ticketCapabilities(t: TicketRow, auth: AuthContext, reopenWindowDays: number) {
  const isRequester = t.requesterId === auth.user.id;
  const staff = auth.user.isStaff;
  const isClosed = t.status === 'CLOSED';
  const done = DONE_STATUSES.includes(t.status);
  const withinReopenWindow =
    t.status === 'RESOLVED' && !!t.resolvedAt && Date.now() - t.resolvedAt.getTime() <= reopenWindowDays * 86_400_000;
  const canChangeStatus = staff && auth.can(PERMISSIONS.TICKET_CHANGE_STATUS);
  const allowedTransitions = canChangeStatus
    ? TRANSITIONS[t.status].filter((to) => to !== 'ESCALATED' || auth.can(PERMISSIONS.TICKET_ESCALATE))
    : isRequester && t.status === 'RESOLVED'
      ? (['CLOSED'] as TicketStatus[])
      : [];
  return {
    canEdit: staff && auth.can(PERMISSIONS.TICKET_UPDATE) && !isClosed,
    canAssign: staff && auth.can(PERMISSIONS.TICKET_ASSIGN) && !done,
    canAccept: staff && auth.can(PERMISSIONS.TICKET_ACCEPT) && !done && t.assigneeId !== auth.user.id,
    canChangeStatus: allowedTransitions.length > 0,
    allowedTransitions,
    canChangePriority: staff && auth.can(PERMISSIONS.TICKET_CHANGE_PRIORITY) && !done,
    canEscalate: staff && auth.can(PERMISSIONS.TICKET_ESCALATE) && !done && t.status !== 'ESCALATED',
    canReopen: done && (auth.can(PERMISSIONS.TICKET_REOPEN_ANY) || (isRequester && withinReopenWindow)),
    canReply: !isClosed,
    canAddInternalNote: canSeeInternal(auth),
    canLogTime: staff && auth.can(PERMISSIONS.TICKET_LOG_TIME),
    canAttach: !isClosed,
    canRate: isRequester && done,
    canLink: staff && auth.can(PERMISSIONS.TICKET_UPDATE),
  };
}

// ───────────────────────────── List ─────────────────────────────

export interface ListTicketsQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: TicketStatus[];
  priority?: TicketPriority[];
  source?: TicketSource[];
  assigneeId?: string;
  teamId?: string[];
  categoryId?: string;
  requesterId?: string;
  tagId?: string;
  from?: Date;
  to?: Date;
  overdue?: boolean;
  slaBreached?: boolean;
  view?: 'all' | 'mine' | 'unassigned' | 'requested' | 'my_teams';
  sort: 'createdAt' | 'updatedAt' | 'priority' | 'status' | 'number' | 'resolutionDueAt' | 'subject';
  order: 'asc' | 'desc';
}

export function buildTicketWhere(q: Partial<ListTicketsQuery>, auth: AuthContext, now = new Date()): Prisma.TicketWhereInput {
  const and: Prisma.TicketWhereInput[] = [ticketScope(auth), { archivedAt: null }];
  if (q.search) {
    const s = q.search;
    and.push({
      OR: [
        { number: { contains: s, mode: 'insensitive' } },
        { subject: { contains: s, mode: 'insensitive' } },
        { requester: { name: { contains: s, mode: 'insensitive' } } },
        { requester: { email: { contains: s, mode: 'insensitive' } } },
      ],
    });
  }
  if (q.status?.length) and.push({ status: { in: q.status } });
  if (q.priority?.length) and.push({ priority: { in: q.priority } });
  if (q.source?.length) and.push({ source: { in: q.source } });
  if (q.assigneeId === 'unassigned') and.push({ assigneeId: null });
  else if (q.assigneeId === 'me') and.push({ assigneeId: auth.user.id });
  else if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
  if (q.teamId?.length) and.push({ teamId: { in: q.teamId } });
  if (q.categoryId) and.push({ OR: [{ categoryId: q.categoryId }, { subcategoryId: q.categoryId }] });
  if (q.requesterId) and.push({ requesterId: q.requesterId });
  if (q.tagId) and.push({ tags: { some: { tagId: q.tagId } } });
  if (q.from || q.to) and.push({ createdAt: { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) } });
  if (q.overdue) {
    and.push({ status: { in: ACTIVE_STATUSES }, OR: [{ resolutionDueAt: { lt: now } }, { dueAt: { lt: now } }] });
  }
  if (q.slaBreached) {
    and.push({
      OR: [
        { firstResponseBreachedAt: { not: null } },
        { resolutionBreachedAt: { not: null } },
        { status: { in: ACTIVE_STATUSES }, resolutionDueAt: { lt: now } },
        { firstResponseAt: null, firstResponseDueAt: { lt: now } },
      ],
    });
  }
  switch (q.view) {
    case 'mine':
      and.push({ assigneeId: auth.user.id });
      break;
    case 'unassigned':
      and.push({ assigneeId: null, status: { in: ACTIVE_STATUSES } });
      break;
    case 'requested':
      and.push({ requesterId: auth.user.id });
      break;
    case 'my_teams':
      and.push({ teamId: { in: auth.teamIds } });
      break;
  }
  return { AND: and };
}

const listInclude = {
  requester: userBrief,
  assignee: userBrief,
  team: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  subcategory: { select: { id: true, name: true } },
  tags: { include: { tag: true } },
  _count: { select: { comments: true, attachments: true } },
} satisfies Prisma.TicketInclude;

export async function listTickets(q: ListTicketsQuery, auth: AuthContext) {
  const where = buildTicketWhere(q, auth);
  const orderBy: Prisma.TicketOrderByWithRelationInput[] = [
    q.sort === 'resolutionDueAt' ? { resolutionDueAt: { sort: q.order, nulls: 'last' } } : { [q.sort]: q.order },
    { createdAt: 'desc' },
  ];
  const [total, rows, policies] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({ where, include: listInclude, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    policyThresholds(),
  ]);
  const now = new Date();
  return {
    data: rows.map(({ tags, _count, ...t }) => ({
      id: t.id,
      number: t.number,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      source: t.source,
      requester: t.requester,
      assignee: t.assignee,
      team: t.team,
      category: t.category,
      subcategory: t.subcategory,
      tags: tags.map((x) => x.tag),
      dueAt: t.dueAt,
      escalationLevel: t.escalationLevel,
      commentCount: _count.comments,
      attachmentCount: _count.attachments,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      sla: evaluateSla(t, policies.get(t.priority)?.warningThresholdPercent, now),
    })),
    meta: pageMeta(q.page, q.pageSize, total),
  };
}

// ───────────────────────────── Detail ─────────────────────────────

export async function getTicketDetail(id: string, auth: AuthContext) {
  const base = await findVisibleTicket(id, auth);
  const internal = canSeeInternal(auth);
  const [t, settings, policies, timeAgg] = await Promise.all([
    prisma.ticket.findUniqueOrThrow({
      where: { id: base.id },
      include: {
        requester: { select: { id: true, name: true, email: true, phone: true, organization: true, createdAt: true } },
        createdBy: userBrief,
        assignee: userBrief,
        team: { select: { id: true, name: true, department: { select: { id: true, name: true } } } },
        category: { select: { id: true, name: true } },
        subcategory: { select: { id: true, name: true } },
        tags: { include: { tag: true } },
        feedback: true,
        linksFrom: { include: { target: { select: { id: true, number: true, subject: true, status: true } } } },
        linksTo: { include: { source: { select: { id: true, number: true, subject: true, status: true } } } },
        _count: { select: { comments: internal ? true : { where: { isInternal: false } }, attachments: { where: { deletedAt: null, ...(internal ? {} : { isInternal: false }) } } } },
      },
    }),
    getSettings(),
    policyThresholds(),
    internal ? prisma.timeEntry.aggregate({ where: { ticketId: id }, _sum: { minutes: true } }) : null,
  ]);

  // Related tickets are only listed if the viewer may see them too.
  const relatedIds = [...t.linksFrom.map((l) => l.target.id), ...t.linksTo.map((l) => l.source.id)];
  const visibleRelated = relatedIds.length
    ? new Set((await prisma.ticket.findMany({ where: { AND: [{ id: { in: relatedIds } }, ticketScope(auth)] }, select: { id: true } })).map((r) => r.id))
    : new Set<string>();
  const related = [...t.linksFrom.map((l) => l.target), ...t.linksTo.map((l) => l.source)].filter((r) => visibleRelated.has(r.id));

  const policy = policies.get(t.priority);
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    description: t.description,
    status: t.status,
    priority: t.priority,
    source: t.source,
    requester: t.requester,
    createdBy: t.createdBy,
    assignee: t.assignee,
    team: t.team,
    category: t.category,
    subcategory: t.subcategory,
    tags: t.tags.map((x) => x.tag),
    dueAt: t.dueAt,
    resolutionNotes: t.resolutionNotes,
    escalationLevel: t.escalationLevel,
    escalatedAt: t.escalatedAt,
    reopenCount: t.reopenCount,
    firstResponseAt: t.firstResponseAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    sla: {
      policy: policy
        ? {
            name: policy.name,
            firstResponseMinutes: policy.firstResponseMinutes,
            resolutionMinutes: policy.resolutionMinutes,
            useBusinessHours: policy.useBusinessHours,
            warningThresholdPercent: policy.warningThresholdPercent,
          }
        : null,
      ...evaluateSla(t, policy?.warningThresholdPercent),
      pausedAt: t.slaPausedAt,
    },
    feedback: t.feedback ? { rating: t.feedback.rating, comment: t.feedback.comment, createdAt: t.feedback.createdAt } : null,
    related,
    counts: { comments: t._count.comments, attachments: t._count.attachments },
    ...(internal && { timeSpentMinutes: timeAgg?._sum.minutes ?? 0 }),
    capabilities: ticketCapabilities(base, auth, settings.reopenWindowDays),
  };
}

// ───────────────────────────── Create ─────────────────────────────

export interface CreateTicketInput {
  subject: string;
  description: string;
  priority: TicketPriority;
  source?: TicketSource;
  categoryId?: string | null;
  subcategoryId?: string | null;
  requesterId?: string;
  teamId?: string | null;
  assigneeId?: string | null;
  tagIds?: string[];
  dueAt?: Date | null;
}

export async function validateCategory(categoryId?: string | null, subcategoryId?: string | null) {
  if (subcategoryId && !categoryId) throw badRequest('A subcategory requires its parent category');
  if (!categoryId) return { defaultTeamId: null as string | null };
  const cat = await prisma.ticketCategory.findFirst({ where: { id: categoryId, isActive: true, parentId: null } });
  if (!cat) throw badRequest('Unknown or inactive category');
  let defaultTeamId = cat.defaultTeamId;
  if (subcategoryId) {
    const sub = await prisma.ticketCategory.findFirst({ where: { id: subcategoryId, isActive: true, parentId: categoryId } });
    if (!sub) throw badRequest('Subcategory does not belong to the selected category');
    defaultTeamId = sub.defaultTeamId ?? defaultTeamId;
  }
  return { defaultTeamId };
}

export async function validateAssignee(assigneeId: string, teamId: string | null, tx: Tx = prisma) {
  const user = await tx.user.findUnique({ where: { id: assigneeId }, include: { role: true, teamMemberships: true } });
  if (!user || !user.isActive) throw badRequest('Assignee not found or inactive');
  if (!user.role.isStaff) throw badRequest('Tickets can only be assigned to staff');
  if (teamId && !user.teamMemberships.some((m) => m.teamId === teamId)) {
    throw badRequest('Assignee is not a member of the selected team');
  }
  return user;
}

export async function createTicket(input: CreateTicketInput, auth: AuthContext) {
  const staff = auth.user.isStaff;
  const onBehalf = input.requesterId && input.requesterId !== auth.user.id;
  if (onBehalf && !auth.can(PERMISSIONS.TICKET_CREATE_ON_BEHALF)) throw forbidden('You cannot create tickets for other users');
  const requesterId = onBehalf ? input.requesterId! : auth.user.id;
  if (onBehalf) {
    const r = await prisma.user.findUnique({ where: { id: requesterId } });
    if (!r || !r.isActive) throw badRequest('Requester not found or inactive');
  }
  // Customers cannot route, assign, tag or set internal fields.
  if (!staff && (input.teamId || input.assigneeId || input.tagIds?.length || input.dueAt || (input.source && input.source !== 'WEB'))) {
    throw forbidden('Only staff can set team, assignee, tags, due date or source');
  }
  if (input.assigneeId && input.assigneeId !== auth.user.id && !auth.can(PERMISSIONS.TICKET_ASSIGN)) {
    throw forbidden('You cannot assign tickets to other agents');
  }
  if (input.assigneeId === auth.user.id && !auth.can(PERMISSIONS.TICKET_ACCEPT) && !auth.can(PERMISSIONS.TICKET_ASSIGN)) {
    throw forbidden('You cannot accept tickets');
  }
  const { defaultTeamId } = await validateCategory(input.categoryId, input.subcategoryId);
  const teamId = input.teamId ?? defaultTeamId ?? null;
  if (teamId) {
    const team = await prisma.team.findFirst({ where: { id: teamId, isActive: true } });
    if (!team) throw badRequest('Unknown or inactive team');
  }
  if (input.assigneeId) await validateAssignee(input.assigneeId, teamId);

  const settings = await getSettings();
  const now = new Date();
  const deadlines = await computeDeadlines(input.priority, now);
  const pending: PendingDelivery[] = [];

  const ticket = await prisma.$transaction(async (tx) => {
    const number = await nextTicketNumber(tx, settings, now);
    const t = await tx.ticket.create({
      data: {
        number,
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        source: staff ? (input.source ?? 'WEB') : 'WEB',
        status: input.assigneeId ? 'ASSIGNED' : 'OPEN',
        requesterId,
        createdById: auth.user.id,
        teamId,
        assigneeId: input.assigneeId ?? null,
        categoryId: input.categoryId ?? null,
        subcategoryId: input.subcategoryId ?? null,
        dueAt: input.dueAt ?? null,
        firstResponseDueAt: deadlines.firstResponseDueAt,
        resolutionDueAt: deadlines.resolutionDueAt,
        createdAt: now,
        tags: input.tagIds?.length ? { create: input.tagIds.map((tagId) => ({ tagId })) } : undefined,
      },
    });
    const history: HistoryEntry[] = [
      { ticketId: t.id, actorId: auth.user.id, action: 'CREATED', newValue: t.status, metadata: { priority: t.priority, source: t.source } },
    ];
    if (t.assigneeId || t.teamId) {
      await tx.ticketAssignment.create({ data: { ticketId: t.id, assigneeId: t.assigneeId, teamId: t.teamId, assignedById: auth.user.id } });
      if (t.assigneeId) history.push({ ticketId: t.id, actorId: auth.user.id, action: 'ASSIGNED', field: 'assignee', newValue: t.assigneeId });
    }
    await recordHistory(tx, history);

    const ref = { id: t.id, number: t.number, subject: t.subject };
    pending.push(
      await createNotifications(
        {
          type: 'TICKET_CREATED',
          ticket: ref,
          recipientIds: [requesterId],
          actorId: auth.user.id,
          title: `Ticket ${t.number} created`,
          body: `A support ticket "${t.subject}" was created on your behalf.`,
        },
        tx,
      ),
      await createNotifications(
        {
          type: 'TICKET_CREATED',
          ticket: ref,
          recipientIds: teamId ? await teamMembers(teamId, tx) : await teamSupervisors(null, tx),
          actorId: auth.user.id,
          staffOnly: true,
          title: `New ${t.priority.toLowerCase()} priority ticket ${t.number}`,
          body: t.subject,
        },
        tx,
      ),
    );
    if (t.assigneeId) {
      pending.push(
        await createNotifications(
          {
            type: 'TICKET_ASSIGNED',
            ticket: ref,
            recipientIds: [t.assigneeId],
            actorId: auth.user.id,
            title: `Ticket ${t.number} assigned to you`,
            body: t.subject,
          },
          tx,
        ),
      );
    }
    return t;
  });
  dispatch(pending);
  return getTicketDetail(ticket.id, auth);
}

// ───────────────────────────── Update fields ─────────────────────────────

export interface UpdateTicketInput {
  subject?: string;
  description?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  source?: TicketSource;
  dueAt?: Date | null;
  tagIds?: string[];
  resolutionNotes?: string | null;
}

export async function updateTicket(id: string, input: UpdateTicketInput, auth: AuthContext) {
  const existing = await findVisibleTicket(id, auth);
  if (!auth.user.isStaff || !auth.can(PERMISSIONS.TICKET_UPDATE)) throw forbidden();
  if (existing.status === 'CLOSED') throw badRequest('Closed tickets cannot be edited; reopen it first');
  if (input.categoryId !== undefined || input.subcategoryId !== undefined) {
    await validateCategory(
      input.categoryId !== undefined ? input.categoryId : existing.categoryId,
      input.subcategoryId !== undefined ? input.subcategoryId : input.categoryId !== undefined ? null : existing.subcategoryId,
    );
  }
  await prisma.$transaction(async (tx) => {
    await lockTicket(tx, id);
    const { tagIds, ...fields } = input;
    if (input.categoryId !== undefined && input.subcategoryId === undefined) fields.subcategoryId = null;
    const history: HistoryEntry[] = [];
    const fmt = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
    for (const [key, value] of Object.entries(fields)) {
      const old = (existing as Record<string, unknown>)[key];
      if (fmt(old) !== fmt(value)) {
        history.push({
          ticketId: id,
          actorId: auth.user.id,
          action: 'UPDATED',
          field: key,
          // long text fields are recorded as changed without copying the full content
          oldValue: key === 'description' ? null : fmt(old),
          newValue: key === 'description' ? null : fmt(value),
        });
      }
    }
    if (tagIds) {
      const current = await tx.ticketTag.findMany({ where: { ticketId: id }, include: { tag: true } });
      const have = new Set(current.map((c) => c.tagId));
      const want = new Set(tagIds);
      const removed = current.filter((c) => !want.has(c.tagId));
      const added = tagIds.filter((t) => !have.has(t));
      if (removed.length) await tx.ticketTag.deleteMany({ where: { ticketId: id, tagId: { in: removed.map((r) => r.tagId) } } });
      if (added.length) await tx.ticketTag.createMany({ data: added.map((tagId) => ({ ticketId: id, tagId })) });
      if (removed.length || added.length) {
        const addedTags = await tx.tag.findMany({ where: { id: { in: added } } });
        history.push({
          ticketId: id,
          actorId: auth.user.id,
          action: 'UPDATED',
          field: 'tags',
          oldValue: current.map((c) => c.tag.name).join(', ') || null,
          newValue: [...current.filter((c) => want.has(c.tagId)).map((c) => c.tag.name), ...addedTags.map((t) => t.name)].join(', ') || null,
          isInternal: true,
        });
      }
    }
    await tx.ticket.update({ where: { id }, data: fields });
    await recordHistory(tx, history);
  });
  return getTicketDetail(id, auth);
}

export { transitionError };
