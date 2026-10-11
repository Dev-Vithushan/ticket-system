import crypto from 'node:crypto';
import type { Prisma, TicketStatus } from '@prisma/client';
import { badRequest, forbidden, notFound, validationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { prisma, type Tx } from '../../lib/prisma';
import { sha256 } from '../../lib/tokens';
import type { AuthContext } from '../../lib/types';
import { createNotifications, dispatch, teamMembers, type PendingDelivery } from '../../services/notifications/notify';
import { getSettings } from '../../services/settings';
import { detectAndValidate, sanitizeFilename } from '../../services/storage/fileValidation';
import { storage } from '../../services/storage/storage';
import { PERMISSIONS } from '../auth/permissions';
import { applyStatusChange, lockAndLoad } from './actions.service';
import { recordHistory } from './history';
import { canSeeInternal } from './scope';
import { findVisibleTicket, type TicketRow } from './tickets.service';

const authorSelect = { select: { id: true, name: true, role: { select: { isStaff: true, name: true } } } } as const;
const attachmentSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  size: true,
  isInternal: true,
  createdAt: true,
  commentId: true,
  uploadedBy: { select: { id: true, name: true } },
} satisfies Prisma.TicketAttachmentSelect;

// ───────────────────────────── Files ─────────────────────────────

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

interface StoredFile {
  originalName: string;
  storageKey: string;
  mimeType: string;
  size: number;
  checksum: string;
}

/** Validates content and writes blobs to storage. Caller must call `discard` if the DB write fails. */
async function storeFiles(files: UploadedFile[]): Promise<{ stored: StoredFile[]; discard: () => Promise<void> }> {
  if (!files.length) return { stored: [], discard: async () => {} };
  const settings = await getSettings();
  const maxBytes = Math.floor(settings.maxAttachmentMb * 1024 * 1024);
  const prepared: StoredFile[] = [];
  for (const f of files) {
    const name = sanitizeFilename(f.originalname);
    if (f.size === 0) throw validationError(`File is empty: ${name}`);
    if (f.size > maxBytes) throw validationError(`File exceeds the ${settings.maxAttachmentMb} MB limit: ${name}`);
    const mimeType = await detectAndValidate(f.buffer, name, settings.allowedAttachmentTypes);
    const now = new Date();
    const storageKey = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}`;
    prepared.push({ originalName: name, storageKey, mimeType, size: f.size, checksum: sha256(f.buffer) });
  }
  const written: string[] = [];
  const discard = async () => {
    await Promise.allSettled(written.map((k) => storage().delete(k)));
  };
  try {
    for (let i = 0; i < prepared.length; i++) {
      await storage().put(prepared[i].storageKey, files[i].buffer, prepared[i].mimeType);
      written.push(prepared[i].storageKey);
    }
  } catch (err) {
    await discard();
    throw err;
  }
  return { stored: prepared, discard };
}

// ───────────────────────────── Comments ─────────────────────────────

export async function listComments(id: string, auth: AuthContext) {
  await findVisibleTicket(id, auth);
  const internal = canSeeInternal(auth);
  const comments = await prisma.ticketComment.findMany({
    where: { ticketId: id, ...(internal ? {} : { isInternal: false }) },
    include: {
      author: authorSelect,
      attachments: { where: { deletedAt: null, ...(internal ? {} : { isInternal: false }) }, select: attachmentSelect },
    },
    orderBy: { createdAt: 'asc' },
  });
  return comments.map((c) => ({
    id: c.id,
    body: c.body,
    isInternal: c.isInternal,
    createdAt: c.createdAt,
    author: { id: c.author.id, name: c.author.name, isStaff: c.author.role.isStaff, roleName: c.author.role.name },
    attachments: c.attachments,
  }));
}

export interface AddCommentInput {
  body: string;
  isInternal: boolean;
  /** Optional status to apply together with a staff reply (e.g. Pending Customer). */
  status?: TicketStatus;
}

export async function addComment(id: string, input: AddCommentInput, files: UploadedFile[], auth: AuthContext) {
  const ticket = await findVisibleTicket(id, auth);
  if (input.isInternal && !canSeeInternal(auth)) throw forbidden('You cannot add internal notes');
  if (!input.isInternal && ticket.status === 'CLOSED') throw badRequest('This ticket is closed. Reopen it to continue the conversation.');
  const isRequester = ticket.requesterId === auth.user.id;
  if (!input.isInternal && ticket.status === 'RESOLVED' && isRequester && !auth.user.isStaff) {
    throw badRequest('This ticket is resolved. Reopen it if the issue persists.');
  }
  if (input.status && !auth.can(PERMISSIONS.TICKET_CHANGE_STATUS)) throw forbidden('You cannot change the status of this ticket');

  const { stored, discard } = await storeFiles(files);
  try {
    const { comment, pending } = await prisma.$transaction(
      async (tx) => {
        const t = await lockAndLoad(tx, id, auth);
        const now = new Date();
        const comment = await tx.ticketComment.create({
          data: { ticketId: t.id, authorId: auth.user.id, body: input.body, isInternal: input.isInternal },
        });
        if (stored.length) {
          await tx.ticketAttachment.createMany({
            data: stored.map((s) => ({ ...s, ticketId: t.id, commentId: comment.id, uploadedById: auth.user.id, isInternal: input.isInternal })),
          });
        }
        await recordHistory(tx, {
          ticketId: t.id,
          actorId: auth.user.id,
          action: input.isInternal ? 'INTERNAL_NOTE_ADDED' : 'COMMENT_ADDED',
          isInternal: input.isInternal,
          metadata: { commentId: comment.id, attachments: stored.length },
        });

        const pending: PendingDelivery[] = [];
        const staffReply = !input.isInternal && auth.user.isStaff && !isRequester;
        if (staffReply && !t.firstResponseAt) {
          await tx.ticket.update({ where: { id: t.id }, data: { firstResponseAt: now } });
        } else {
          await tx.ticket.update({ where: { id: t.id }, data: { updatedAt: now } });
        }
        // A requester replying while we wait on them resumes work automatically.
        if (!input.isInternal && isRequester && t.status === 'PENDING_CUSTOMER') {
          const fresh = await tx.ticket.findUniqueOrThrow({ where: { id: t.id } });
          pending.push(
            ...(await applyStatusChange(tx, fresh, { status: fresh.assigneeId ? 'IN_PROGRESS' : 'OPEN', reason: 'Requester replied' }, auth, { automatic: true })),
          );
        }
        if (input.status && input.status !== t.status) {
          const fresh = await tx.ticket.findUniqueOrThrow({ where: { id: t.id } });
          pending.push(...(await applyStatusChange(tx, fresh, { status: input.status }, auth)));
        }
        pending.push(...(await replyNotifications(tx, t, input, auth)));
        return { comment, pending };
      },
      { timeout: 15_000 },
    );
    dispatch(pending);
    return comment;
  } catch (err) {
    await discard();
    throw err;
  }
}

async function replyNotifications(tx: Tx, t: TicketRow, input: AddCommentInput, auth: AuthContext) {
  const ticket = { id: t.id, number: t.number, subject: t.subject };
  const snippet = input.body.length > 280 ? `${input.body.slice(0, 277)}…` : input.body;
  if (input.isInternal) {
    return [
      await createNotifications(
        { type: 'INTERNAL_NOTE', ticket, recipientIds: [t.assigneeId], actorId: auth.user.id, staffOnly: true, title: `Internal note on ${t.number}`, body: snippet },
        tx,
      ),
    ];
  }
  if (t.requesterId === auth.user.id) {
    const staff = t.assigneeId ? [t.assigneeId] : await teamMembers(t.teamId, tx);
    return [
      await createNotifications(
        { type: 'NEW_REPLY', ticket, recipientIds: staff, actorId: auth.user.id, staffOnly: true, title: `New reply from requester on ${t.number}`, body: snippet },
        tx,
      ),
    ];
  }
  return [
    await createNotifications(
      { type: 'NEW_REPLY', ticket, recipientIds: [t.requesterId, t.assigneeId], actorId: auth.user.id, title: `New reply on ${t.number}`, body: snippet },
      tx,
    ),
  ];
}

// ───────────────────────────── Attachments ─────────────────────────────

export async function listAttachments(id: string, auth: AuthContext) {
  await findVisibleTicket(id, auth);
  return prisma.ticketAttachment.findMany({
    where: { ticketId: id, deletedAt: null, ...(canSeeInternal(auth) ? {} : { isInternal: false }) },
    select: attachmentSelect,
    orderBy: { createdAt: 'desc' },
  });
}

export async function uploadAttachments(id: string, files: UploadedFile[], auth: AuthContext, isInternal = false) {
  if (!files.length) throw badRequest('No files uploaded');
  const ticket = await findVisibleTicket(id, auth);
  if (ticket.status === 'CLOSED') throw badRequest('Cannot attach files to a closed ticket');
  if (isInternal && !canSeeInternal(auth)) throw forbidden();
  const { stored, discard } = await storeFiles(files);
  try {
    await prisma.$transaction(async (tx) => {
      const t = await lockAndLoad(tx, id, auth);
      await tx.ticketAttachment.createMany({ data: stored.map((s) => ({ ...s, ticketId: t.id, uploadedById: auth.user.id, isInternal })) });
      await recordHistory(
        tx,
        stored.map((s) => ({ ticketId: t.id, actorId: auth.user.id, action: 'ATTACHMENT_ADDED' as const, newValue: s.originalName, isInternal })),
      );
      await tx.ticket.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
    });
  } catch (err) {
    await discard();
    throw err;
  }
  return listAttachments(id, auth);
}

/** Authorises and opens an attachment stream. Internal attachments are invisible to customers. */
export async function openAttachment(ticketId: string, attachmentId: string, auth: AuthContext) {
  await findVisibleTicket(ticketId, auth);
  const att = await prisma.ticketAttachment.findFirst({
    where: { id: attachmentId, ticketId, deletedAt: null, ...(canSeeInternal(auth) ? {} : { isInternal: false }) },
  });
  if (!att) throw notFound('Attachment');
  try {
    const stream = await storage().get(att.storageKey);
    return { attachment: att, stream };
  } catch (err) {
    logger.error({ err, attachmentId }, 'Attachment blob missing');
    throw notFound('Attachment file');
  }
}

export async function deleteAttachment(ticketId: string, attachmentId: string, auth: AuthContext) {
  await prisma.$transaction(async (tx) => {
    const t = await lockAndLoad(tx, ticketId, auth);
    const att = await tx.ticketAttachment.findFirst({
      where: { id: attachmentId, ticketId, deletedAt: null, ...(canSeeInternal(auth) ? {} : { isInternal: false }) },
    });
    if (!att) throw notFound('Attachment');
    const mayDelete = att.uploadedById === auth.user.id || (auth.user.isStaff && auth.can(PERMISSIONS.TICKET_UPDATE));
    if (!mayDelete) throw forbidden('You cannot remove this attachment');
    if (t.status === 'CLOSED') throw badRequest('Attachments of closed tickets are preserved');
    // Soft delete keeps the record (and blob) for the audit trail.
    await tx.ticketAttachment.update({ where: { id: att.id }, data: { deletedAt: new Date() } });
    await recordHistory(tx, { ticketId, actorId: auth.user.id, action: 'ATTACHMENT_REMOVED', oldValue: att.originalName, isInternal: att.isInternal });
  });
}

// ───────────────────────────── History ─────────────────────────────

export async function listHistory(id: string, auth: AuthContext) {
  await findVisibleTicket(id, auth);
  const internal = canSeeInternal(auth);
  const rows = await prisma.ticketHistory.findMany({
    where: { ticketId: id, ...(internal ? {} : { isInternal: false }) },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((h) => ({
    id: h.id,
    action: h.action,
    field: h.field,
    oldValue: h.oldValue,
    newValue: h.newValue,
    isInternal: h.isInternal,
    // metadata may carry internal reasons; customers only get the automatic flag
    metadata: internal ? h.metadata : h.metadata && typeof h.metadata === 'object' && 'automatic' in h.metadata ? { automatic: (h.metadata as { automatic?: boolean }).automatic } : null,
    actor: h.actor ?? { id: null, name: 'System' },
    createdAt: h.createdAt,
  }));
}
