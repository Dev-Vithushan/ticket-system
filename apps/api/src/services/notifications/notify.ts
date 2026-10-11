import type { NotificationType } from '@prisma/client';
import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { prisma, type Tx } from '../../lib/prisma';
import { getSettings } from '../settings';
import { channels, type OutboundMessage } from './channels';

export interface NotifyInput {
  type: NotificationType;
  ticket: { id: string; number: string; subject: string };
  recipientIds: (string | null | undefined)[];
  title: string;
  body: string;
  /** Excluded from recipients (you don't get notified about your own actions). */
  actorId?: string | null;
  /** Only deliver to staff users (e.g. internal-note notifications). */
  staffOnly?: boolean;
}

export interface PendingDelivery {
  messages: OutboundMessage[];
}

/**
 * Persists in-app notifications (inside the caller's transaction when given) and returns
 * the outbound messages to deliver once the transaction has committed.
 */
export async function createNotifications(input: NotifyInput, tx: Tx = prisma): Promise<PendingDelivery> {
  const ids = [...new Set(input.recipientIds.filter((id): id is string => !!id && id !== input.actorId))];
  if (!ids.length) return { messages: [] };
  const users = await tx.user.findMany({
    where: { id: { in: ids }, isActive: true, ...(input.staffOnly && { role: { isStaff: true } }) },
    select: { id: true, email: true, name: true, emailNotifications: true },
  });
  if (!users.length) return { messages: [] };
  await tx.notification.createMany({
    data: users.map((u) => ({ userId: u.id, type: input.type, title: input.title, body: input.body, ticketId: input.ticket.id })),
  });
  const link = `${config.APP_URL}/tickets/${input.ticket.id}`;
  return {
    messages: users
      .filter((u) => u.emailNotifications)
      .map((u) => ({ to: { email: u.email, name: u.name }, subject: `[${input.ticket.number}] ${input.title}`, text: input.body, link })),
  };
}

/** Fire-and-forget external delivery. Never throws. */
export function dispatch(pending: PendingDelivery | PendingDelivery[]) {
  const messages = (Array.isArray(pending) ? pending : [pending]).flatMap((p) => p.messages);
  if (!messages.length) return;
  void (async () => {
    try {
      const settings = await getSettings();
      if (!settings.emailNotificationsEnabled) return;
      for (const ch of channels) if (ch.isEnabled()) await ch.send(messages);
    } catch (err) {
      logger.warn({ err }, 'Notification dispatch failed');
    }
  })();
}

/** Users that should hear about team-level events: team leads plus users who can assign tickets in that team. */
export async function teamSupervisors(teamId: string | null, tx: Tx = prisma): Promise<string[]> {
  const assigners = await tx.user.findMany({
    where: {
      isActive: true,
      role: { permissions: { some: { permission: { key: 'ticket.assign' } } } },
      ...(teamId ? { OR: [{ teamMemberships: { some: { teamId } } }, { role: { permissions: { some: { permission: { key: 'ticket.view_all' } } } } }] } : {}),
    },
    select: { id: true },
  });
  const leads = teamId
    ? await tx.teamMembership.findMany({ where: { teamId, role: 'LEAD', user: { isActive: true } }, select: { userId: true } })
    : [];
  return [...new Set([...assigners.map((u) => u.id), ...leads.map((l) => l.userId)])];
}

export async function teamMembers(teamId: string | null, tx: Tx = prisma): Promise<string[]> {
  if (!teamId) return [];
  const rows = await tx.teamMembership.findMany({ where: { teamId, user: { isActive: true } }, select: { userId: true } });
  return rows.map((r) => r.userId);
}
