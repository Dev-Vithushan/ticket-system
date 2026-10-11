import { Router } from 'express';
import multer from 'multer';
import { config } from '../../config/env';
import { badRequest } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { defineRoute } from '../../lib/route';
import { boolQuery, csvEnum, csvUuid, idParams, pagination, uuid, z } from '../../lib/zod';
import { sensitiveLimiter } from '../../middleware/rateLimit';
import { PERMISSIONS } from '../auth/permissions';
import * as actions from './actions.service';
import * as comments from './comments.service';
import { canSeeInternal, ticketScope } from './scope';
import * as svc from './tickets.service';
import { STATUSES } from './workflow';

const router = Router();
const M = '/tickets';
const tags = ['Tickets'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 5, fields: 10, fieldSize: 64 * 1024 },
});

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const SOURCES = ['WEB', 'EMAIL', 'PHONE', 'INTERNAL'] as const;
const STATUS_ENUM = z.enum(STATUSES as [string, ...string[]]).transform((s) => s as (typeof STATUSES)[number]);

const subject = z.string().trim().min(5, 'Subject must be at least 5 characters').max(200);
const description = z.string().trim().min(10, 'Please describe the issue (at least 10 characters)').max(20_000);
const resolutionNotes = z.string().trim().max(10_000);
const dateish = z.coerce.date();

// ───────────────────────────── Collection ─────────────────────────────

defineRoute(router, M, {
  method: 'get',
  path: '/',
  tags,
  summary: 'List tickets visible to the caller',
  description: 'Search by number, subject or requester; filter, sort and paginate. Results are always limited to the caller’s data scope.',
  query: z.object({
    ...pagination,
    search: z.string().trim().max(100).optional(),
    status: csvEnum(STATUSES as [string, ...string[]]),
    priority: csvEnum([...PRIORITIES]),
    source: csvEnum([...SOURCES]),
    assigneeId: z.union([uuid, z.enum(['me', 'unassigned'])]).optional(),
    teamId: csvUuid,
    categoryId: uuid.optional(),
    requesterId: uuid.optional(),
    tagId: uuid.optional(),
    from: dateish.optional(),
    to: dateish.optional(),
    overdue: boolQuery,
    slaBreached: boolQuery,
    view: z.enum(['all', 'mine', 'unassigned', 'requested', 'my_teams']).optional(),
    sort: z.enum(['createdAt', 'updatedAt', 'priority', 'status', 'number', 'resolutionDueAt', 'subject']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  }),
  handler: ({ query, auth }) => svc.listTickets(query as svc.ListTicketsQuery, auth),
});

defineRoute(router, M, {
  method: 'post',
  path: '/',
  tags,
  summary: 'Create a ticket',
  permissions: [PERMISSIONS.TICKET_CREATE],
  body: z.object({
    subject,
    description,
    priority: z.enum(PRIORITIES).default('MEDIUM'),
    source: z.enum(SOURCES).optional(),
    categoryId: uuid.nullable().optional(),
    subcategoryId: uuid.nullable().optional(),
    requesterId: uuid.optional(),
    teamId: uuid.nullable().optional(),
    assigneeId: uuid.nullable().optional(),
    tagIds: z.array(uuid).max(20).optional(),
    dueAt: dateish.nullable().optional(),
  }),
  responses: { 201: 'Created' },
  handler: async ({ res, body, auth }) => {
    res.status(201);
    return { data: await svc.createTicket(body, auth) };
  },
});

defineRoute(router, M, {
  method: 'post',
  path: '/bulk',
  tags,
  summary: 'Bulk assign / change status / change priority (all-or-nothing)',
  permissions: [PERMISSIONS.TICKET_BULK_UPDATE],
  middleware: [sensitiveLimiter],
  body: z
    .object({
      ticketIds: z.array(uuid).min(1).max(100),
      assigneeId: uuid.nullable().optional(),
      teamId: uuid.nullable().optional(),
      status: STATUS_ENUM.optional(),
      priority: z.enum(PRIORITIES).optional(),
      resolutionNotes: resolutionNotes.optional(),
    })
    .refine((b) => b.assigneeId !== undefined || b.teamId !== undefined || b.status || b.priority, 'Nothing to update'),
  handler: async ({ body, auth }) => ({ data: await actions.bulkUpdate(body, auth) }),
});

defineRoute(router, M, {
  method: 'get',
  path: '/activity/recent',
  tags,
  summary: 'Recent ticket activity within the caller’s scope',
  query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(15) }),
  handler: async ({ query, auth }) => {
    const rows = await prisma.ticketHistory.findMany({
      where: { ticket: ticketScope(auth), ...(canSeeInternal(auth) ? {} : { isInternal: false }) },
      include: { actor: { select: { id: true, name: true } }, ticket: { select: { id: true, number: true, subject: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return {
      data: rows.map((h) => ({
        id: h.id,
        action: h.action,
        field: h.field,
        oldValue: h.oldValue,
        newValue: h.newValue,
        createdAt: h.createdAt,
        actor: h.actor ?? { id: null, name: 'System' },
        ticket: h.ticket,
      })),
    };
  },
});

// ───────────────────────────── Single ticket ─────────────────────────────

defineRoute(router, M, {
  method: 'get',
  path: '/:id',
  tags,
  summary: 'Ticket details with SLA status and caller capabilities',
  params: idParams,
  responses: { 200: 'Ticket', 404: 'Not found or not visible' },
  handler: async ({ params, auth }) => ({ data: await svc.getTicketDetail(params.id, auth) }),
});

defineRoute(router, M, {
  method: 'patch',
  path: '/:id',
  tags,
  summary: 'Edit ticket fields (subject, description, category, tags, due date, resolution notes)',
  permissions: [PERMISSIONS.TICKET_UPDATE],
  params: idParams,
  body: z.object({
    subject: subject.optional(),
    description: description.optional(),
    categoryId: uuid.nullable().optional(),
    subcategoryId: uuid.nullable().optional(),
    source: z.enum(SOURCES).optional(),
    dueAt: dateish.nullable().optional(),
    tagIds: z.array(uuid).max(20).optional(),
    resolutionNotes: resolutionNotes.nullable().optional(),
  }),
  handler: async ({ params, body, auth }) => ({ data: await svc.updateTicket(params.id, body, auth) }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/status',
  tags,
  summary: 'Change ticket status (validated against the workflow)',
  params: idParams,
  body: z.object({ status: STATUS_ENUM, resolutionNotes: resolutionNotes.optional(), reason: z.string().trim().max(1000).optional() }),
  responses: { 200: 'Updated', 422: 'Transition not allowed' },
  handler: async ({ params, body, auth }) => ({ data: await actions.changeStatus(params.id, body, auth) }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/assign',
  tags,
  summary: 'Assign / reassign / unassign a ticket (agent and/or team). Agents may accept (self-assign).',
  anyPermission: [PERMISSIONS.TICKET_ASSIGN, PERMISSIONS.TICKET_ACCEPT],
  params: idParams,
  body: z.object({ assigneeId: uuid.nullable().optional(), teamId: uuid.nullable().optional() }),
  handler: async ({ params, body, auth }) => ({ data: await actions.assignTicket(params.id, body, auth) }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/accept',
  tags,
  summary: 'Accept the ticket (assign it to yourself)',
  permissions: [PERMISSIONS.TICKET_ACCEPT],
  params: idParams,
  handler: async ({ params, auth }) => ({ data: await actions.assignTicket(params.id, { assigneeId: auth.user.id }, auth) }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/priority',
  tags,
  summary: 'Change priority (recalculates SLA targets)',
  permissions: [PERMISSIONS.TICKET_CHANGE_PRIORITY],
  params: idParams,
  body: z.object({ priority: z.enum(PRIORITIES) }),
  handler: async ({ params, body, auth }) => ({ data: await actions.changePriority(params.id, body.priority, auth) }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/escalate',
  tags,
  summary: 'Escalate a ticket',
  permissions: [PERMISSIONS.TICKET_ESCALATE],
  params: idParams,
  body: z.object({ reason: z.string().trim().min(5).max(1000) }),
  handler: async ({ params, body, auth }) => ({ data: await actions.escalateTicket(params.id, body.reason, auth) }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/reopen',
  tags,
  summary: 'Reopen a resolved (requester, within window) or closed (staff) ticket',
  params: idParams,
  body: z.object({ reason: z.string().trim().min(5).max(2000) }),
  handler: async ({ params, body, auth }) => ({ data: await actions.reopenTicket(params.id, body.reason, auth) }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/feedback',
  tags,
  summary: 'Rate support (requester only, once the ticket is resolved/closed)',
  params: idParams,
  body: z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional() }),
  responses: { 201: 'Created', 409: 'Already rated' },
  handler: async ({ res, params, body, auth }) => {
    res.status(201);
    return { data: await actions.submitFeedback(params.id, body, auth) };
  },
});

defineRoute(router, M, {
  method: 'get',
  path: '/:id/history',
  tags,
  summary: 'Timestamped activity history (internal entries hidden from customers)',
  params: idParams,
  handler: async ({ params, auth }) => ({ data: await comments.listHistory(params.id, auth) }),
});

defineRoute(router, M, {
  method: 'get',
  path: '/:id/time-entries',
  tags,
  summary: 'Time entries (staff only)',
  params: idParams,
  handler: async ({ params, auth }) => ({ data: await actions.listTimeEntries(params.id, auth) }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/time-entries',
  tags,
  summary: 'Log time spent',
  permissions: [PERMISSIONS.TICKET_LOG_TIME],
  params: idParams,
  body: z.object({ minutes: z.number().int().min(1).max(1440), note: z.string().trim().max(500).optional(), workDate: dateish.optional() }),
  responses: { 201: 'Created' },
  handler: async ({ res, params, body, auth }) => {
    res.status(201);
    return { data: await actions.logTime(params.id, body, auth) };
  },
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/links',
  tags,
  summary: 'Link a related ticket (by number or id)',
  permissions: [PERMISSIONS.TICKET_UPDATE],
  params: idParams,
  body: z.object({ ticket: z.string().trim().min(3).max(64) }),
  handler: async ({ params, body, auth }) => ({ data: await actions.linkTicket(params.id, body.ticket, auth) }),
});

defineRoute(router, M, {
  method: 'delete',
  path: '/:id/links/:otherId',
  tags,
  summary: 'Remove a related-ticket link',
  permissions: [PERMISSIONS.TICKET_UPDATE],
  params: z.object({ id: uuid, otherId: uuid }),
  handler: async ({ params, auth }) => ({ data: await actions.unlinkTicket(params.id, params.otherId, auth) }),
});

// ───────────────────────────── Conversation ─────────────────────────────

defineRoute(router, M, {
  method: 'get',
  path: '/:id/comments',
  tags: ['Comments'],
  summary: 'Conversation thread (internal notes only for authorised staff)',
  params: idParams,
  handler: async ({ params, auth }) => ({ data: await comments.listComments(params.id, auth) }),
});

const commentFields = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty').max(20_000),
  isInternal: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
  status: STATUS_ENUM.optional(),
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/comments',
  tags: ['Comments'],
  summary: 'Add a public reply or internal note, optionally with attachments and a status change',
  description: 'Accepts JSON or multipart/form-data (fields: body, isInternal, status, files[]).',
  params: idParams,
  multipart: {
    body: { type: 'string', required: true },
    isInternal: { type: 'boolean' },
    status: { type: 'string' },
    files: { type: 'file', array: true },
  },
  middleware: [upload.array('files', 5)],
  responses: { 201: 'Created' },
  handler: async ({ req, res, params, auth }) => {
    const input = commentFields.parse(req.body ?? {});
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    res.status(201);
    return { data: await comments.addComment(params.id, input, files, auth) };
  },
});

// ───────────────────────────── Attachments ─────────────────────────────

defineRoute(router, M, {
  method: 'get',
  path: '/:id/attachments',
  tags: ['Attachments'],
  summary: 'List attachments',
  params: idParams,
  handler: async ({ params, auth }) => ({ data: await comments.listAttachments(params.id, auth) }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/attachments',
  tags: ['Attachments'],
  summary: 'Upload attachments (type, content and size validated server-side)',
  params: idParams,
  multipart: { files: { type: 'file', array: true, required: true }, isInternal: { type: 'boolean' } },
  middleware: [sensitiveLimiter, upload.array('files', 5)],
  responses: { 201: 'Uploaded', 413: 'Too large' },
  handler: async ({ req, res, params, auth }) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw badRequest('No files uploaded (use the "files" field)');
    const isInternal = req.body?.isInternal === 'true';
    res.status(201);
    return { data: await comments.uploadAttachments(params.id, files, auth, isInternal) };
  },
});

defineRoute(router, M, {
  method: 'get',
  path: '/:id/attachments/:attachmentId/download',
  tags: ['Attachments'],
  summary: 'Download an attachment (authorised)',
  params: z.object({ id: uuid, attachmentId: uuid }),
  produces: 'application/octet-stream',
  handler: async ({ req, res, params, auth }) => {
    const { attachment, stream } = await comments.openAttachment(params.id, params.attachmentId, auth);
    const inline = req.query.inline === 'true' && /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(attachment.mimeType);
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', String(attachment.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${attachment.originalName.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
    );
    await new Promise<void>((resolve, reject) => {
      stream.on('error', reject);
      res.on('finish', resolve);
      stream.pipe(res);
    });
  },
});

defineRoute(router, M, {
  method: 'delete',
  path: '/:id/attachments/:attachmentId',
  tags: ['Attachments'],
  summary: 'Remove an attachment (soft delete; uploader or staff)',
  params: z.object({ id: uuid, attachmentId: uuid }),
  handler: async ({ params, auth }) => {
    await comments.deleteAttachment(params.id, params.attachmentId, auth);
    return { data: { deleted: true } };
  },
});

export default router;
