import type { Prisma, TicketHistoryAction } from '@prisma/client';
import type { Tx } from '../../lib/prisma';

export interface HistoryEntry {
  ticketId: string;
  actorId: string | null;
  action: TicketHistoryAction;
  field?: string;
  oldValue?: string | null;
  newValue?: string | null;
  isInternal?: boolean;
  metadata?: Prisma.InputJsonValue;
}

export async function recordHistory(tx: Tx, entries: HistoryEntry | HistoryEntry[]) {
  const list = Array.isArray(entries) ? entries : [entries];
  if (!list.length) return;
  await tx.ticketHistory.createMany({
    data: list.map((e) => ({
      ticketId: e.ticketId,
      actorId: e.actorId,
      action: e.action,
      field: e.field,
      oldValue: e.oldValue ?? null,
      newValue: e.newValue ?? null,
      isInternal: e.isInternal ?? false,
      metadata: e.metadata,
    })),
  });
}

/** Serialises concurrent writers on one ticket for the rest of the transaction. */
export async function lockTicket(tx: Tx, ticketId: string) {
  await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
}
