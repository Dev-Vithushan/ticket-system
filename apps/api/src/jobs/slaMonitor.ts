import type { TicketPriority } from '@prisma/client';
import { config } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { createNotifications, dispatch, teamSupervisors, type PendingDelivery } from '../services/notifications/notify';
import { getSettings } from '../services/settings';
import { applyEscalation, applyStatusChange } from '../modules/tickets/actions.service';
import { recordHistory } from '../modules/tickets/history';

const LOCK_KEY = 4_242_001; // advisory lock id: only one instance runs the monitor at a time
const BATCH = 200;
const ACTIVE = `('OPEN','ASSIGNED','IN_PROGRESS','ESCALATED')`; // PENDING_CUSTOMER is paused

export interface SlaRunResult {
  warnings: number;
  breaches: number;
  escalations: number;
  autoClosed: number;
  skipped?: boolean;
}

type Kind = 'firstResponse' | 'resolution';
interface Candidate {
  id: string;
  number: string;
  subject: string;
  priority: TicketPriority;
  assigneeId: string | null;
  teamId: string | null;
  escalateOnBreach: boolean | null;
}

/**
 * Scans active tickets for approaching and passed SLA deadlines.
 * Warning: elapsed share of the window >= policy threshold. Breach: deadline passed without the target being met.
 */
export async function runSlaMonitor(now = new Date()): Promise<SlaRunResult> {
  const result: SlaRunResult = { warnings: 0, breaches: 0, escalations: 0, autoClosed: 0 };
  const pending: PendingDelivery[] = [];

  const locked = await prisma.$transaction(
    async (tx) => {
      const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS ok`;
      if (!ok) return false;

      const due = (kind: Kind) => (kind === 'firstResponse' ? `"firstResponseDueAt"` : `"resolutionDueAt"`);
      const done = (kind: Kind) => (kind === 'firstResponse' ? `t."firstResponseAt" IS NULL` : `t."resolvedAt" IS NULL`);
      const warned = (kind: Kind) => (kind === 'firstResponse' ? `"firstResponseWarnedAt"` : `"resolutionWarnedAt"`);
      const breached = (kind: Kind) => (kind === 'firstResponse' ? `"firstResponseBreachedAt"` : `"resolutionBreachedAt"`);
      const label = (kind: Kind) => (kind === 'firstResponse' ? 'first response' : 'resolution');

      for (const kind of ['firstResponse', 'resolution'] as Kind[]) {
        // Breaches
        const breaches = await tx.$queryRawUnsafe<Candidate[]>(
          `SELECT t.id, t.number, t.subject, t.priority, t."assigneeId", t."teamId", p."escalateOnBreach"
             FROM "Ticket" t LEFT JOIN "SlaPolicy" p ON p.priority = t.priority AND p."isActive"
            WHERE t.status IN ${ACTIVE} AND t."archivedAt" IS NULL AND ${done(kind)}
              AND t.${due(kind)} IS NOT NULL AND t.${due(kind)} < $1 AND t.${breached(kind)} IS NULL
            ORDER BY t.${due(kind)} LIMIT ${BATCH}`,
          now,
        );
        for (const c of breaches) {
          await tx.$executeRawUnsafe(`UPDATE "Ticket" SET ${breached(kind)} = $1 WHERE id = $2`, now, c.id);
          await recordHistory(tx, { ticketId: c.id, actorId: null, action: 'SLA_BREACHED', field: kind, isInternal: true });
          pending.push(
            await createNotifications(
              {
                type: 'SLA_BREACHED',
                ticket: c,
                recipientIds: [c.assigneeId, ...(await teamSupervisors(c.teamId, tx))],
                staffOnly: true,
                title: `SLA breached: ${label(kind)} on ${c.number}`,
                body: c.subject,
              },
              tx,
            ),
          );
          result.breaches++;
          if (c.escalateOnBreach) {
            const t = await tx.ticket.findUniqueOrThrow({ where: { id: c.id } });
            if (t.status !== 'ESCALATED') {
              pending.push(...(await applyEscalation(tx, t, { reason: `Automatic escalation: ${label(kind)} SLA breached` }, null)));
              result.escalations++;
            }
          }
        }

        // Warnings (elapsed fraction of the window >= threshold)
        const warnings = await tx.$queryRawUnsafe<Candidate[]>(
          `SELECT t.id, t.number, t.subject, t.priority, t."assigneeId", t."teamId", p."escalateOnBreach"
             FROM "Ticket" t JOIN "SlaPolicy" p ON p.priority = t.priority AND p."isActive"
            WHERE t.status IN ${ACTIVE} AND t."archivedAt" IS NULL AND ${done(kind)}
              AND t.${due(kind)} IS NOT NULL AND t.${due(kind)} >= $1 AND t.${warned(kind)} IS NULL
              AND $1 >= t."createdAt" + (t.${due(kind)} - t."createdAt") * (p."warningThresholdPercent" / 100.0)
            LIMIT ${BATCH}`,
          now,
        );
        for (const c of warnings) {
          await tx.$executeRawUnsafe(`UPDATE "Ticket" SET ${warned(kind)} = $1 WHERE id = $2`, now, c.id);
          await recordHistory(tx, { ticketId: c.id, actorId: null, action: 'SLA_WARNING', field: kind, isInternal: true });
          pending.push(
            await createNotifications(
              {
                type: 'SLA_WARNING',
                ticket: c,
                recipientIds: c.assigneeId ? [c.assigneeId] : await teamSupervisors(c.teamId, tx),
                staffOnly: true,
                title: `SLA warning: ${label(kind)} due soon on ${c.number}`,
                body: c.subject,
              },
              tx,
            ),
          );
          result.warnings++;
        }
      }

      // Auto-close resolved tickets after the configured grace period
      const settings = await getSettings();
      if (settings.autoCloseResolvedAfterDays > 0) {
        const cutoff = new Date(now.getTime() - settings.autoCloseResolvedAfterDays * 86_400_000);
        const stale = await tx.ticket.findMany({ where: { status: 'RESOLVED', resolvedAt: { lt: cutoff }, archivedAt: null }, take: BATCH });
        for (const t of stale) {
          pending.push(
            ...(await applyStatusChange(tx, t, { status: 'CLOSED', reason: `Auto-closed ${settings.autoCloseResolvedAfterDays} days after resolution` }, null, { automatic: true })),
          );
          result.autoClosed++;
        }
      }
      return true;
    },
    { timeout: 120_000 },
  );

  if (!locked) return { ...result, skipped: true };
  dispatch(pending);
  if (result.warnings || result.breaches || result.autoClosed) logger.info(result, 'SLA monitor run');
  return result;
}

let timer: NodeJS.Timeout | null = null;

export function startSlaMonitor() {
  if (!config.SLA_MONITOR_ENABLED || timer) return;
  const tick = () => runSlaMonitor().catch((err) => logger.error({ err }, 'SLA monitor failed'));
  timer = setInterval(tick, config.SLA_MONITOR_INTERVAL_SECONDS * 1000);
  timer.unref();
  setTimeout(tick, 5_000).unref();
  logger.info({ intervalSeconds: config.SLA_MONITOR_INTERVAL_SECONDS }, 'SLA monitor started');
}

export function stopSlaMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}
