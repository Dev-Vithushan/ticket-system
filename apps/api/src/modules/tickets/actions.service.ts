import type { Prisma, TicketPriority, TicketStatus } from '@prisma/client';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { prisma, type Tx } from '../../lib/prisma';
import type { AuthContext } from '../../lib/types';
import { createNotifications, dispatch, teamMembers, teamSupervisors, type PendingDelivery } from '../../services/notifications/notify';
import { getSettings } from '../../services/settings';
import { PERMISSIONS } from '../auth/permissions';
import { computeDeadlines, extendForPause, getPolicy, calendarFor } from '../sla/sla.service';
import { addBusinessMinutes } from '../sla/businessTime';
import { lockTicket, recordHistory, type HistoryEntry } from './history';
import { ticketScope } from './scope';
import { findVisibleTicket, getTicketDetail, ticketCapabilities, validateAssignee, type TicketRow } from './tickets.service';
import { DONE_STATUSES, transitionError } from './workflow';

type Actor = AuthContext | null; // null = system (SLA monitor / automation)
const actorId = (a: Actor) => a?.user.id ?? null;
const ref = (t: TicketRow) => ({ id: t.id, number: t.number, subject: t.subject });
const pretty = (s: string) => s.replace(/_/g, ' ').toLowerCase();

/** Re-reads the ticket under a row lock so concurrent edits are serialised. */
async function lockAndLoad(tx: Tx, id: string, auth: Actor) {
  await lockTicket(tx, id);
  const t = auth
    ? await tx.ticket.findFirst({ where: { AND: [{ id }, ticketScope(auth)] } })
    : await tx.ticket.findUnique({ where: { id } });
  if (!t || t.archivedAt) throw notFound('Ticket');
  return t;
}

/** Runs one ticket action inside a transaction, then dispatches notifications after commit. */
async function run(id: string, auth: AuthContext, fn: (tx: Tx, t: TicketRow) => Promise<PendingDelivery[]>) {
  const pending = await prisma.$transaction((tx) => lockAndLoad(tx, id, auth).then((t) => fn(tx, t)), { timeout: 15_000 });
  dispatch(pending);
  return getTicketDetail(id, auth);
}

// ───────────────────────────── Status ─────────────────────────────

export interface StatusInput {
  status: TicketStatus;
  resolutionNotes?: string | null;
  reason?: string;
}

export async function applyStatusChange(tx: Tx, t: TicketRow, input: StatusInput, auth: Actor, opts: { automatic?: boolean } = {}) {
  const isRequester = auth && t.requesterId === auth.user.id;
  const staffAllowed = !auth || (auth.user.isStaff && auth.can(PERMISSIONS.TICKET_CHANGE_STATUS));
  if (!staffAllowed && !opts.automatic) {
    // Requesters may only accept a resolution by closing their resolved ticket.
    if (!(isRequester && t.status === 'RESOLVED' && input.status === 'CLOSED')) throw forbidden('You cannot change the status of this ticket');
  }
  if (input.status === 'ESCALATED') return applyEscalation(tx, t, { reason: input.reason ?? 'Escalated via status change' }, auth);

  const now = new Date();
  const data: Prisma.TicketUncheckedUpdateInput = { status: input.status };
  const history: HistoryEntry[] = [];
  let assigneeId = t.assigneeId;

  if (input.status === 'IN_PROGRESS' && !assigneeId && auth?.can(PERMISSIONS.TICKET_ACCEPT)) {
    assigneeId = auth.user.id; // starting work on an unassigned ticket implicitly accepts it
    data.assigneeId = assigneeId;
    await tx.ticketAssignment.updateMany({ where: { ticketId: t.id, endedAt: null }, data: { endedAt: now } });
    await tx.ticketAssignment.create({ data: { ticketId: t.id, assigneeId, teamId: t.teamId, assignedById: assigneeId } });
    history.push({ ticketId: t.id, actorId: assigneeId, action: 'ASSIGNED', field: 'assignee', newValue: assigneeId });
  }

  const resolutionNotes = input.resolutionNotes?.trim() || t.resolutionNotes;
  const err = transitionError({ from: t.status, to: input.status, hasAssignee: !!assigneeId, resolutionNotes });
  if (err) throw new AppError(422, 'INVALID_TRANSITION', err);

  if (input.resolutionNotes?.trim()) data.resolutionNotes = input.resolutionNotes.trim();
  if (t.status === 'PENDING_CUSTOMER' && t.slaPausedAt) {
    data.slaPausedAt = null;
    if (t.resolutionDueAt && !DONE_STATUSES.includes(input.status)) {
      data.resolutionDueAt = await extendForPause(t.priority, t.resolutionDueAt, t.slaPausedAt, now);
    }
  }
  if (input.status === 'PENDING_CUSTOMER') data.slaPausedAt = now;
  if (input.status === 'RESOLVED') data.resolvedAt = now;
  if (input.status === 'CLOSED') {
    data.closedAt = now;
    if (!t.resolvedAt) data.resolvedAt = now;
  }

  await tx.ticket.update({ where: { id: t.id }, data });
  history.push({
    ticketId: t.id,
    actorId: actorId(auth),
    action: 'STATUS_CHANGED',
    field: 'status',
    oldValue: t.status,
    newValue: input.status,
    metadata: opts.automatic || !auth ? { automatic: true, reason: input.reason ?? null } : input.reason ? { reason: input.reason } : undefined,
  });
  await recordHistory(tx, history);

  const type = input.status === 'RESOLVED' ? 'TICKET_RESOLVED' : input.status === 'CLOSED' ? 'TICKET_CLOSED' : 'STATUS_CHANGED';
  const title =
    input.status === 'RESOLVED'
      ? `Ticket ${t.number} has been resolved`
      : input.status === 'CLOSED'
        ? `Ticket ${t.number} has been closed`
        : `Ticket ${t.number} is now ${pretty(input.status)}`;
  const body =
    input.status === 'RESOLVED' && resolutionNotes
      ? `Resolution: ${resolutionNotes.slice(0, 500)}`
      : input.status === 'PENDING_CUSTOMER'
        ? 'The support team is waiting for your response.'
        : t.subject;
  return [await createNotifications({ type, ticket: ref(t), recipientIds: [t.requesterId, assigneeId], actorId: actorId(auth), title, body }, tx)];
}

export const changeStatus = (id: string, input: StatusInput, auth: AuthContext) =>
  run(id, auth, (tx, t) => applyStatusChange(tx, t, input, auth));

// ───────────────────────────── Assignment ─────────────────────────────

export interface AssignInput {
  /** undefined = keep, null = unassign */
  assigneeId?: string | null;
  /** undefined = keep, null = no team */
  teamId?: string | null;
}

export async function applyAssignment(tx: Tx, t: TicketRow, input: AssignInput, auth: AuthContext) {
  if (DONE_STATUSES.includes(t.status)) throw badRequest('Resolved or closed tickets cannot be reassigned');
  const isSelfAccept = input.assigneeId === auth.user.id && (input.teamId === undefined || input.teamId === t.teamId);
  if (!auth.user.isStaff) throw forbidden();
  if (isSelfAccept) {
    if (!auth.can(PERMISSIONS.TICKET_ACCEPT) && !auth.can(PERMISSIONS.TICKET_ASSIGN)) throw forbidden('You cannot accept tickets');
  } else if (!auth.can(PERMISSIONS.TICKET_ASSIGN)) {
    throw forbidden('You cannot assign tickets');
  }

  const newTeamId = input.teamId !== undefined ? input.teamId : t.teamId;
  if (newTeamId && newTeamId !== t.teamId) {
    const team = await tx.team.findFirst({ where: { id: newTeamId, isActive: true } });
    if (!team) throw badRequest('Unknown or inactive team');
  }
  let newAssigneeId = input.assigneeId !== undefined ? input.assigneeId : t.assigneeId;
  if (newAssigneeId) {
    if (input.assigneeId !== undefined) await validateAssignee(newAssigneeId, newTeamId, tx);
    else {
      // team changed and current assignee is not part of it → unassign
      const member = newTeamId ? await tx.teamMembership.findUnique({ where: { teamId_userId: { teamId: newTeamId, userId: newAssigneeId } } }) : true;
      if (!member) newAssigneeId = null;
    }
  }
  if (newAssigneeId === t.assigneeId && newTeamId === t.teamId) throw badRequest('Nothing to change');

  const now = new Date();
  const data: Prisma.TicketUncheckedUpdateInput = { assigneeId: newAssigneeId, teamId: newTeamId };
  let newStatus = t.status;
  if (newAssigneeId && t.status === 'OPEN') newStatus = 'ASSIGNED';
  if (!newAssigneeId && (t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS')) newStatus = 'OPEN';
  if (newStatus !== t.status) data.status = newStatus;
  await tx.ticket.update({ where: { id: t.id }, data });
  await tx.ticketAssignment.updateMany({ where: { ticketId: t.id, endedAt: null }, data: { endedAt: now } });
  await tx.ticketAssignment.create({ data: { ticketId: t.id, assigneeId: newAssigneeId, teamId: newTeamId, assignedById: auth.user.id } });

  const history: HistoryEntry[] = [];
  const users = await tx.user.findMany({ where: { id: { in: [t.assigneeId, newAssigneeId].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const nameOf = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? id) : null);
  if (newAssigneeId !== t.assigneeId) {
    history.push({
      ticketId: t.id,
      actorId: auth.user.id,
      action: newAssigneeId ? 'ASSIGNED' : 'UNASSIGNED',
      field: 'assignee',
      oldValue: nameOf(t.assigneeId),
      newValue: nameOf(newAssigneeId),
    });
  }
  if (newTeamId !== t.teamId) {
    const teams = await tx.team.findMany({ where: { id: { in: [t.teamId, newTeamId].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const teamName = (id: string | null) => (id ? (teams.find((x) => x.id === id)?.name ?? id) : null);
    history.push({ ticketId: t.id, actorId: auth.user.id, action: 'TEAM_CHANGED', field: 'team', oldValue: teamName(t.teamId), newValue: teamName(newTeamId) });
  }
  if (newStatus !== t.status) {
    history.push({ ticketId: t.id, actorId: auth.user.id, action: 'STATUS_CHANGED', field: 'status', oldValue: t.status, newValue: newStatus, metadata: { automatic: true } });
  }
  await recordHistory(tx, history);

  const pending: PendingDelivery[] = [];
  if (newAssigneeId && newAssigneeId !== t.assigneeId) {
    pending.push(
      await createNotifications(
        { type: 'TICKET_ASSIGNED', ticket: ref(t), recipientIds: [newAssigneeId], actorId: auth.user.id, title: `Ticket ${t.number} assigned to you`, body: t.subject },
        tx,
      ),
    );
  }
  if (newTeamId && newTeamId !== t.teamId && !newAssigneeId) {
    pending.push(
      await createNotifications(
        { type: 'TICKET_ASSIGNED', ticket: ref(t), recipientIds: await teamMembers(newTeamId, tx), actorId: auth.user.id, staffOnly: true, title: `Ticket ${t.number} routed to your team`, body: t.subject },
        tx,
      ),
    );
  }
  return pending;
}

export const assignTicket = (id: string, input: AssignInput, auth: AuthContext) =>
  run(id, auth, (tx, t) => applyAssignment(tx, t, input, auth));

// ───────────────────────────── Priority ─────────────────────────────

export async function applyPriorityChange(tx: Tx, t: TicketRow, priority: TicketPriority, auth: AuthContext) {
  if (!auth.user.isStaff || !auth.can(PERMISSIONS.TICKET_CHANGE_PRIORITY)) throw forbidden('You cannot change ticket priority');
  if (DONE_STATUSES.includes(t.status)) throw badRequest('Resolved or closed tickets cannot be re-prioritised');
  if (priority === t.priority) throw badRequest(`Ticket is already ${priority}`);
  // SLA targets follow the new priority, measured from the original creation time.
  const d = await computeDeadlines(priority, t.createdAt);
  const data: Prisma.TicketUncheckedUpdateInput = {
    priority,
    resolutionDueAt: d.resolutionDueAt,
    resolutionWarnedAt: null,
  };
  if (!t.firstResponseAt) {
    data.firstResponseDueAt = d.firstResponseDueAt;
    data.firstResponseWarnedAt = null;
  }
  await tx.ticket.update({ where: { id: t.id }, data });
  await recordHistory(tx, { ticketId: t.id, actorId: auth.user.id, action: 'PRIORITY_CHANGED', field: 'priority', oldValue: t.priority, newValue: priority });
  return [
    await createNotifications(
      {
        type: 'PRIORITY_CHANGED',
        ticket: ref(t),
        recipientIds: [t.assigneeId, t.requesterId],
        actorId: auth.user.id,
        title: `Ticket ${t.number} priority changed to ${pretty(priority)}`,
        body: t.subject,
      },
      tx,
    ),
  ];
}

export const changePriority = (id: string, priority: TicketPriority, auth: AuthContext) =>
  run(id, auth, (tx, t) => applyPriorityChange(tx, t, priority, auth));

// ───────────────────────────── Escalation ─────────────────────────────

export async function applyEscalation(tx: Tx, t: TicketRow, input: { reason: string }, auth: Actor) {
  if (auth && (!auth.user.isStaff || !auth.can(PERMISSIONS.TICKET_ESCALATE))) throw forbidden('You cannot escalate tickets');
  if (DONE_STATUSES.includes(t.status)) throw badRequest('Resolved or closed tickets cannot be escalated');
  const now = new Date();
  const data: Prisma.TicketUncheckedUpdateInput = { status: 'ESCALATED', escalationLevel: { increment: 1 }, escalatedAt: now };
  if (t.status === 'PENDING_CUSTOMER' && t.slaPausedAt) {
    data.slaPausedAt = null;
    if (t.resolutionDueAt) data.resolutionDueAt = await extendForPause(t.priority, t.resolutionDueAt, t.slaPausedAt, now);
  }
  await tx.ticket.update({ where: { id: t.id }, data });
  await recordHistory(tx, [
    {
      ticketId: t.id,
      actorId: actorId(auth),
      action: 'ESCALATED',
      field: 'escalationLevel',
      oldValue: String(t.escalationLevel),
      newValue: String(t.escalationLevel + 1),
      isInternal: true,
      metadata: { reason: input.reason, automatic: !auth },
    },
    ...(t.status !== 'ESCALATED'
      ? [{ ticketId: t.id, actorId: actorId(auth), action: 'STATUS_CHANGED' as const, field: 'status', oldValue: t.status, newValue: 'ESCALATED' }]
      : []),
  ]);
  if (auth) {
    await tx.ticketComment.create({ data: { ticketId: t.id, authorId: auth.user.id, isInternal: true, body: `Escalated: ${input.reason}` } });
  }
  return [
    await createNotifications(
      {
        type: 'TICKET_ESCALATED',
        ticket: ref(t),
        recipientIds: [...(await teamSupervisors(t.teamId, tx)), t.assigneeId],
        actorId: actorId(auth),
        staffOnly: true,
        title: `Ticket ${t.number} escalated (level ${t.escalationLevel + 1})`,
        body: input.reason,
      },
      tx,
    ),
  ];
}

export const escalateTicket = (id: string, reason: string, auth: AuthContext) =>
  run(id, auth, (tx, t) => applyEscalation(tx, t, { reason }, auth));

// ───────────────────────────── Reopen ─────────────────────────────

export async function reopenTicket(id: string, reason: string, auth: AuthContext) {
  const settings = await getSettings();
  return run(id, auth, async (tx, t) => {
    if (!DONE_STATUSES.includes(t.status)) throw badRequest('Only resolved or closed tickets can be reopened');
    if (!ticketCapabilities(t, auth, settings.reopenWindowDays).canReopen) {
      throw forbidden(
        t.status === 'CLOSED'
          ? 'Closed tickets can only be reopened by support staff'
          : `Resolved tickets can be reopened within ${settings.reopenWindowDays} days`,
      );
    }
    const now = new Date();
    const status: TicketStatus = t.assigneeId ? 'IN_PROGRESS' : 'OPEN';
    const policy = await getPolicy(t.priority);
    const resolutionDueAt = policy ? addBusinessMinutes(now, policy.resolutionMinutes, await calendarFor(policy)) : t.resolutionDueAt;
    await tx.ticket.update({
      where: { id: t.id },
      data: { status, reopenCount: { increment: 1 }, resolvedAt: null, closedAt: null, resolutionDueAt, resolutionWarnedAt: null, slaPausedAt: null },
    });
    await tx.ticketComment.create({ data: { ticketId: t.id, authorId: auth.user.id, isInternal: false, body: `Ticket reopened: ${reason}` } });
    await recordHistory(tx, [
      { ticketId: t.id, actorId: auth.user.id, action: 'REOPENED', field: 'status', oldValue: t.status, newValue: status, metadata: { reason } },
    ]);
    return [
      await createNotifications(
        {
          type: 'TICKET_REOPENED',
          ticket: ref(t),
          recipientIds: [t.requesterId, t.assigneeId, ...(t.assigneeId ? [] : await teamSupervisors(t.teamId, tx))],
          actorId: auth.user.id,
          title: `Ticket ${t.number} was reopened`,
          body: reason,
        },
        tx,
      ),
    ];
  });
}

// ───────────────────────────── Bulk ─────────────────────────────

export interface BulkInput {
  ticketIds: string[];
  assigneeId?: string | null;
  teamId?: string | null;
  status?: TicketStatus;
  priority?: TicketPriority;
  resolutionNotes?: string;
}

/** All-or-nothing bulk update: any failing ticket rolls back the whole batch and is reported. */
export async function bulkUpdate(input: BulkInput, auth: AuthContext) {
  const ids = [...new Set(input.ticketIds)];
  const pending = await prisma.$transaction(
    async (tx) => {
      const all: PendingDelivery[] = [];
      for (const id of ids) {
        let number = id;
        try {
          const t = await lockAndLoad(tx, id, auth);
          number = t.number;
          let current = t;
          if (input.assigneeId !== undefined || input.teamId !== undefined) {
            const wantsChange =
              (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) ||
              (input.teamId !== undefined && input.teamId !== current.teamId);
            if (wantsChange) {
              all.push(...(await applyAssignment(tx, current, { assigneeId: input.assigneeId, teamId: input.teamId }, auth)));
              current = await tx.ticket.findUniqueOrThrow({ where: { id } });
            }
          }
          if (input.priority && input.priority !== current.priority) {
            all.push(...(await applyPriorityChange(tx, current, input.priority, auth)));
            current = await tx.ticket.findUniqueOrThrow({ where: { id } });
          }
          if (input.status && input.status !== current.status) {
            all.push(...(await applyStatusChange(tx, current, { status: input.status, resolutionNotes: input.resolutionNotes }, auth)));
          }
        } catch (err) {
          if (err instanceof AppError) {
            throw new AppError(err.status, err.code, `${number}: ${err.message}`, { ticketId: id, ticketNumber: number });
          }
          throw err;
        }
      }
      return all;
    },
    { timeout: 60_000 },
  );
  dispatch(pending);
  return { updated: ids.length };
}

// ───────────────────────────── Time tracking ─────────────────────────────

export async function listTimeEntries(id: string, auth: AuthContext) {
  await findVisibleTicket(id, auth);
  if (!auth.user.isStaff || !auth.can(PERMISSIONS.TICKET_INTERNAL_NOTES)) throw forbidden();
  return prisma.timeEntry.findMany({
    where: { ticketId: id },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { workDate: 'desc' },
  });
}

export async function logTime(id: string, input: { minutes: number; note?: string; workDate?: Date }, auth: AuthContext) {
  if (!auth.user.isStaff || !auth.can(PERMISSIONS.TICKET_LOG_TIME)) throw forbidden('You cannot log time');
  return prisma.$transaction(async (tx) => {
    const t = await lockAndLoad(tx, id, auth);
    const entry = await tx.timeEntry.create({
      data: { ticketId: t.id, userId: auth.user.id, minutes: input.minutes, note: input.note, workDate: input.workDate ?? new Date() },
      include: { user: { select: { id: true, name: true } } },
    });
    await recordHistory(tx, { ticketId: t.id, actorId: auth.user.id, action: 'TIME_LOGGED', newValue: String(input.minutes), isInternal: true, metadata: { note: input.note ?? null } });
    return entry;
  });
}

// ───────────────────────────── Feedback ─────────────────────────────

export async function submitFeedback(id: string, input: { rating: number; comment?: string }, auth: AuthContext) {
  return prisma.$transaction(async (tx) => {
    const t = await lockAndLoad(tx, id, auth);
    if (t.requesterId !== auth.user.id) throw forbidden('Only the requester can rate this ticket');
    if (!DONE_STATUSES.includes(t.status)) throw badRequest('Feedback can be given once the ticket is resolved or closed');
    if (await tx.customerFeedback.findUnique({ where: { ticketId: t.id } })) throw conflict('Feedback was already submitted for this ticket');
    const fb = await tx.customerFeedback.create({ data: { ticketId: t.id, requesterId: auth.user.id, rating: input.rating, comment: input.comment } });
    await recordHistory(tx, { ticketId: t.id, actorId: auth.user.id, action: 'FEEDBACK_SUBMITTED', newValue: String(input.rating) });
    return fb;
  });
}

// ───────────────────────────── Related tickets ─────────────────────────────

export async function linkTicket(id: string, targetNumberOrId: string, auth: AuthContext) {
  if (!auth.can(PERMISSIONS.TICKET_UPDATE)) throw forbidden();
  await prisma.$transaction(async (tx) => {
    const t = await lockAndLoad(tx, id, auth);
    const target = await tx.ticket.findFirst({
      where: { AND: [ticketScope(auth), { OR: [{ number: targetNumberOrId.toUpperCase() }, ...(/^[0-9a-f-]{36}$/i.test(targetNumberOrId) ? [{ id: targetNumberOrId }] : [])] }] },
    });
    if (!target) throw notFound('Related ticket');
    if (target.id === t.id) throw badRequest('A ticket cannot be linked to itself');
    const exists = await tx.ticketLink.findFirst({ where: { OR: [{ sourceId: t.id, targetId: target.id }, { sourceId: target.id, targetId: t.id }] } });
    if (exists) throw conflict('Tickets are already linked');
    await tx.ticketLink.create({ data: { sourceId: t.id, targetId: target.id } });
    await recordHistory(tx, [
      { ticketId: t.id, actorId: auth.user.id, action: 'LINKED', newValue: target.number },
      { ticketId: target.id, actorId: auth.user.id, action: 'LINKED', newValue: t.number },
    ]);
  });
  return getTicketDetail(id, auth);
}

export async function unlinkTicket(id: string, otherId: string, auth: AuthContext) {
  if (!auth.can(PERMISSIONS.TICKET_UPDATE)) throw forbidden();
  await prisma.$transaction(async (tx) => {
    const t = await lockAndLoad(tx, id, auth);
    const other = await tx.ticket.findUnique({ where: { id: otherId } });
    const res = await tx.ticketLink.deleteMany({ where: { OR: [{ sourceId: t.id, targetId: otherId }, { sourceId: otherId, targetId: t.id }] } });
    if (!res.count) throw notFound('Link');
    await recordHistory(tx, { ticketId: t.id, actorId: auth.user.id, action: 'UNLINKED', oldValue: other?.number ?? otherId });
  });
  return getTicketDetail(id, auth);
}

export { lockAndLoad };
