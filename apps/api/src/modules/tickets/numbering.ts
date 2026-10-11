import { DateTime } from 'luxon';
import type { Tx } from '../../lib/prisma';
import type { SystemSettings } from '../../services/settings';

export function formatTicketNumber(
  settings: Pick<SystemSettings, 'ticketNumberPrefix' | 'ticketNumberPadding' | 'ticketNumberIncludeYear'>,
  year: number,
  seq: number,
) {
  const n = String(seq).padStart(settings.ticketNumberPadding, '0');
  return settings.ticketNumberIncludeYear ? `${settings.ticketNumberPrefix}-${year}-${n}` : `${settings.ticketNumberPrefix}-${n}`;
}

/** Atomically allocates the next ticket number (row-level upsert; safe under concurrency). */
export async function nextTicketNumber(tx: Tx, settings: SystemSettings, now = new Date()) {
  const year = DateTime.fromJSDate(now, { zone: settings.timezone }).year;
  const scope = settings.ticketNumberIncludeYear ? `${settings.ticketNumberPrefix}:${year}` : `${settings.ticketNumberPrefix}`;
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "TicketCounter" ("scope", "lastValue") VALUES (${scope}, 1)
    ON CONFLICT ("scope") DO UPDATE SET "lastValue" = "TicketCounter"."lastValue" + 1
    RETURNING "lastValue"`;
  return formatTicketNumber(settings, year, rows[0].lastValue);
}
