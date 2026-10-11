import { Prisma, type TicketPriority } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../../lib/prisma';
import type { AuthContext } from '../../lib/types';
import { getSettings } from '../../services/settings';
import { PERMISSIONS } from '../auth/permissions';

export interface ReportFilters {
  from: Date;
  to: Date;
  teamId?: string;
  assigneeId?: string;
  priority?: TicketPriority;
  categoryId?: string;
}

export type Interval = 'day' | 'week' | 'month';

/** SQL twin of ticketScope(): reports must never aggregate tickets the caller cannot see. */
export function scopeSql(auth: AuthContext): Prisma.Sql {
  if (auth.can(PERMISSIONS.TICKET_VIEW_ALL)) return Prisma.sql`TRUE`;
  if (auth.can(PERMISSIONS.TICKET_VIEW_TEAM)) {
    const teams = auth.teamIds.length ? Prisma.sql`t."teamId" IN (${Prisma.join(auth.teamIds)})` : Prisma.sql`FALSE`;
    return Prisma.sql`(${teams} OR t."assigneeId" = ${auth.user.id} OR t."requesterId" = ${auth.user.id})`;
  }
  return Prisma.sql`t."requesterId" = ${auth.user.id}`;
}

function filterSql(f: Omit<ReportFilters, 'from' | 'to'>): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`t."archivedAt" IS NULL`];
  if (f.teamId) parts.push(Prisma.sql`t."teamId" = ${f.teamId}`);
  if (f.assigneeId) parts.push(Prisma.sql`t."assigneeId" = ${f.assigneeId}`);
  if (f.priority) parts.push(Prisma.sql`t.priority = ${f.priority}::"TicketPriority"`);
  if (f.categoryId) parts.push(Prisma.sql`(t."categoryId" = ${f.categoryId} OR t."subcategoryId" = ${f.categoryId})`);
  return Prisma.join(parts, ' AND ');
}

const createdIn = (f: ReportFilters) => Prisma.sql`t."createdAt" BETWEEN ${f.from} AND ${f.to}`;
const ACTIVE = Prisma.sql`t.status IN ('OPEN','ASSIGNED','IN_PROGRESS','PENDING_CUSTOMER','ESCALATED')`;

/** SLA outcome expressions computed from real timestamps (and breach markers set by the monitor). */
const FR_BREACH = Prisma.sql`(t."firstResponseDueAt" IS NOT NULL AND (t."firstResponseBreachedAt" IS NOT NULL OR COALESCE(t."firstResponseAt", t."resolvedAt", now() AT TIME ZONE 'UTC') > t."firstResponseDueAt"))`;
const RES_BREACH = Prisma.sql`(t."resolutionDueAt" IS NOT NULL AND (t."resolutionBreachedAt" IS NOT NULL OR COALESCE(t."resolvedAt", now() AT TIME ZONE 'UTC') > t."resolutionDueAt"))`;
const BREACHED = Prisma.sql`(${FR_BREACH} OR ${RES_BREACH})`;
const MET = Prisma.sql`(t."resolvedAt" IS NOT NULL AND t."resolutionDueAt" IS NOT NULL AND NOT ${BREACHED})`;
const MINUTES = (a: Prisma.Sql, b: Prisma.Sql) => Prisma.sql`EXTRACT(EPOCH FROM (${b} - ${a})) / 60.0`;

const num = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
const int = (v: unknown) => Number(v ?? 0);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

// ───────────────────────────── Summary ─────────────────────────────

export async function summary(auth: AuthContext, f: ReportFilters) {
  const [row] = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT
      COUNT(*)                                                         AS total,
      COUNT(*) FILTER (WHERE t.status = 'OPEN')                        AS open,
      COUNT(*) FILTER (WHERE t.status = 'ASSIGNED')                    AS assigned,
      COUNT(*) FILTER (WHERE t.status = 'IN_PROGRESS')                 AS in_progress,
      COUNT(*) FILTER (WHERE t.status = 'PENDING_CUSTOMER')            AS pending,
      COUNT(*) FILTER (WHERE t.status = 'ESCALATED')                   AS escalated,
      COUNT(*) FILTER (WHERE t.status = 'RESOLVED')                    AS resolved,
      COUNT(*) FILTER (WHERE t.status = 'CLOSED')                      AS closed,
      COUNT(*) FILTER (WHERE ${ACTIVE} AND (t."resolutionDueAt" < now() AT TIME ZONE 'UTC' OR t."dueAt" < now() AT TIME ZONE 'UTC')) AS overdue,
      COUNT(*) FILTER (WHERE ${MET})                                   AS sla_met,
      COUNT(*) FILTER (WHERE ${BREACHED})                              AS sla_breached,
      COUNT(*) FILTER (WHERE t."reopenCount" > 0)                      AS reopened,
      AVG(${MINUTES(Prisma.sql`t."createdAt"`, Prisma.sql`t."firstResponseAt"`)}) FILTER (WHERE t."firstResponseAt" IS NOT NULL) AS avg_first_response,
      AVG(${MINUTES(Prisma.sql`t."createdAt"`, Prisma.sql`t."resolvedAt"`)})      FILTER (WHERE t."resolvedAt" IS NOT NULL)      AS avg_resolution
    FROM "Ticket" t
    WHERE ${scopeSql(auth)} AND ${filterSql(f)} AND ${createdIn(f)}`;
  const [csat] = await prisma.$queryRaw<{ avg: unknown; count: unknown }[]>`
    SELECT AVG(fb.rating) AS avg, COUNT(*) AS count
    FROM "CustomerFeedback" fb JOIN "Ticket" t ON t.id = fb."ticketId"
    WHERE ${scopeSql(auth)} AND ${filterSql(f)} AND ${createdIn(f)}`;
  const met = int(row.sla_met);
  const breached = int(row.sla_breached);
  const total = int(row.total);
  return {
    total,
    open: int(row.open),
    assigned: int(row.assigned),
    inProgress: int(row.in_progress),
    pending: int(row.pending),
    escalated: int(row.escalated),
    resolved: int(row.resolved),
    closed: int(row.closed),
    overdue: int(row.overdue),
    slaMet: met,
    slaBreached: breached,
    slaCompliancePercent: pct(met, met + breached),
    reopened: int(row.reopened),
    reopenRatePercent: pct(int(row.reopened), total),
    avgFirstResponseMinutes: num(row.avg_first_response),
    avgResolutionMinutes: num(row.avg_resolution),
    csatAverage: num(csat.avg),
    csatResponses: int(csat.count),
  };
}

// ───────────────────────────── Volume over time ─────────────────────────────

export async function volume(auth: AuthContext, f: ReportFilters, interval: Interval) {
  const { timezone: tz } = await getSettings();
  const bucket = (col: Prisma.Sql) => Prisma.sql`to_char(date_trunc(${interval}, (${col} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM-DD')`;
  const [created, resolved] = await Promise.all([
    prisma.$queryRaw<{ bucket: string; count: unknown }[]>`
      SELECT ${bucket(Prisma.sql`t."createdAt"`)} AS bucket, COUNT(*) AS count
      FROM "Ticket" t WHERE ${scopeSql(auth)} AND ${filterSql(f)} AND ${createdIn(f)}
      GROUP BY 1`,
    prisma.$queryRaw<{ bucket: string; count: unknown }[]>`
      SELECT ${bucket(Prisma.sql`t."resolvedAt"`)} AS bucket, COUNT(*) AS count
      FROM "Ticket" t WHERE ${scopeSql(auth)} AND ${filterSql(f)} AND t."resolvedAt" BETWEEN ${f.from} AND ${f.to}
      GROUP BY 1`,
  ]);
  const c = new Map(created.map((r) => [r.bucket, int(r.count)]));
  const r = new Map(resolved.map((x) => [x.bucket, int(x.count)]));
  const out: { period: string; created: number; resolved: number }[] = [];
  let cursor = DateTime.fromJSDate(f.from, { zone: tz }).startOf(interval);
  const end = DateTime.fromJSDate(f.to, { zone: tz });
  for (let i = 0; cursor <= end && i < 1000; i++) {
    const key = cursor.toISODate()!;
    out.push({ period: key, created: c.get(key) ?? 0, resolved: r.get(key) ?? 0 });
    cursor = cursor.plus({ [interval + 's']: 1 } as never);
  }
  return out;
}

// ───────────────────────────── Distribution ─────────────────────────────

export async function distribution(auth: AuthContext, f: ReportFilters) {
  const where = Prisma.sql`${scopeSql(auth)} AND ${filterSql(f)} AND ${createdIn(f)}`;
  const [byPriority, byStatus, byCategory, bySource, byTeam] = await Promise.all([
    prisma.$queryRaw<{ key: string; count: unknown }[]>`SELECT t.priority::text AS key, COUNT(*) AS count FROM "Ticket" t WHERE ${where} GROUP BY 1`,
    prisma.$queryRaw<{ key: string; count: unknown }[]>`SELECT t.status::text AS key, COUNT(*) AS count FROM "Ticket" t WHERE ${where} GROUP BY 1`,
    prisma.$queryRaw<{ key: string; count: unknown }[]>`
      SELECT COALESCE(c.name, 'Uncategorized') AS key, COUNT(*) AS count
      FROM "Ticket" t LEFT JOIN "TicketCategory" c ON c.id = t."categoryId" WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<{ key: string; count: unknown }[]>`SELECT t.source::text AS key, COUNT(*) AS count FROM "Ticket" t WHERE ${where} GROUP BY 1`,
    prisma.$queryRaw<{ key: string; count: unknown }[]>`
      SELECT COALESCE(tm.name, 'Unrouted') AS key, COUNT(*) AS count
      FROM "Ticket" t LEFT JOIN "Team" tm ON tm.id = t."teamId" WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
  ]);
  const order = <T extends string>(rows: { key: string; count: unknown }[], keys: T[]) =>
    keys.map((k) => ({ key: k, count: int(rows.find((r) => r.key === k)?.count) }));
  const plain = (rows: { key: string; count: unknown }[]) => rows.map((r) => ({ key: r.key, count: int(r.count) }));
  return {
    byPriority: order(byPriority, ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    byStatus: order(byStatus, ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED']),
    byCategory: plain(byCategory),
    bySource: order(bySource, ['WEB', 'EMAIL', 'PHONE', 'INTERNAL']),
    byTeam: plain(byTeam),
  };
}

// ───────────────────────────── Agents ─────────────────────────────

export async function agentPerformance(auth: AuthContext, f: ReportFilters) {
  const allAgents = auth.can(PERMISSIONS.TICKET_VIEW_ALL);
  const memberFilter = allAgents
    ? Prisma.sql`TRUE`
    : auth.teamIds.length
      ? Prisma.sql`(u.id = ${auth.user.id} OR EXISTS (SELECT 1 FROM "TeamMembership" m WHERE m."userId" = u.id AND m."teamId" IN (${Prisma.join(auth.teamIds)})))`
      : Prisma.sql`u.id = ${auth.user.id}`;
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT u.id, u.name,
      COUNT(t.id) FILTER (WHERE ${ACTIVE})                                                           AS open_assigned,
      COUNT(t.id) FILTER (WHERE ${ACTIVE} AND t."resolutionDueAt" < now() AT TIME ZONE 'UTC')         AS overdue,
      COUNT(t.id) FILTER (WHERE t."resolvedAt" BETWEEN ${f.from} AND ${f.to})                         AS resolved,
      AVG(${MINUTES(Prisma.sql`t."createdAt"`, Prisma.sql`t."resolvedAt"`)}) FILTER (WHERE t."resolvedAt" BETWEEN ${f.from} AND ${f.to}) AS avg_resolution,
      AVG(${MINUTES(Prisma.sql`t."createdAt"`, Prisma.sql`t."firstResponseAt"`)}) FILTER (WHERE t."firstResponseAt" BETWEEN ${f.from} AND ${f.to}) AS avg_first_response,
      COUNT(t.id) FILTER (WHERE t."resolvedAt" BETWEEN ${f.from} AND ${f.to} AND ${MET})              AS sla_met,
      COUNT(t.id) FILTER (WHERE t."resolvedAt" BETWEEN ${f.from} AND ${f.to} AND ${BREACHED})         AS sla_breached
    FROM "User" u
    JOIN "Role" r ON r.id = u."roleId" AND r."isStaff"
    LEFT JOIN "Ticket" t ON t."assigneeId" = u.id AND ${scopeSql(auth)} AND ${filterSql({ ...f, assigneeId: undefined })}
    WHERE u."isActive" AND ${memberFilter} ${f.assigneeId ? Prisma.sql`AND u.id = ${f.assigneeId}` : Prisma.empty}
    GROUP BY u.id, u.name
    ORDER BY open_assigned DESC, u.name`;
  const ids = rows.map((r) => String(r.id));
  const [time, csat] = ids.length
    ? await Promise.all([
        prisma.timeEntry.groupBy({ by: ['userId'], where: { userId: { in: ids }, workDate: { gte: f.from, lte: f.to } }, _sum: { minutes: true } }),
        prisma.$queryRaw<{ id: string; avg: unknown }[]>`
          SELECT t."assigneeId" AS id, AVG(fb.rating) AS avg FROM "CustomerFeedback" fb JOIN "Ticket" t ON t.id = fb."ticketId"
          WHERE t."assigneeId" IN (${Prisma.join(ids)}) AND ${scopeSql(auth)} AND fb."createdAt" BETWEEN ${f.from} AND ${f.to}
          GROUP BY 1`,
      ])
    : [[], []];
  return rows.map((r) => {
    const met = int(r.sla_met);
    const breached = int(r.sla_breached);
    return {
      id: String(r.id),
      name: String(r.name),
      openAssigned: int(r.open_assigned),
      overdue: int(r.overdue),
      resolved: int(r.resolved),
      avgResolutionMinutes: num(r.avg_resolution),
      avgFirstResponseMinutes: num(r.avg_first_response),
      slaCompliancePercent: pct(met, met + breached),
      timeLoggedMinutes: time.find((x) => x.userId === r.id)?._sum.minutes ?? 0,
      csatAverage: num(csat.find((x) => x.id === r.id)?.avg),
    };
  });
}

// ───────────────────────────── Teams ─────────────────────────────

export async function teamPerformance(auth: AuthContext, f: ReportFilters) {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT tm.id, tm.name,
      COUNT(t.id) FILTER (WHERE ${createdIn(f)})                                                      AS created,
      COUNT(t.id) FILTER (WHERE ${ACTIVE})                                                            AS open,
      COUNT(t.id) FILTER (WHERE t."resolvedAt" BETWEEN ${f.from} AND ${f.to})                         AS resolved,
      AVG(${MINUTES(Prisma.sql`t."createdAt"`, Prisma.sql`t."resolvedAt"`)}) FILTER (WHERE t."resolvedAt" BETWEEN ${f.from} AND ${f.to}) AS avg_resolution,
      AVG(${MINUTES(Prisma.sql`t."createdAt"`, Prisma.sql`t."firstResponseAt"`)}) FILTER (WHERE t."firstResponseAt" BETWEEN ${f.from} AND ${f.to}) AS avg_first_response,
      COUNT(t.id) FILTER (WHERE t."resolvedAt" BETWEEN ${f.from} AND ${f.to} AND ${MET})              AS sla_met,
      COUNT(t.id) FILTER (WHERE t."resolvedAt" BETWEEN ${f.from} AND ${f.to} AND ${BREACHED})         AS sla_breached,
      COUNT(t.id) FILTER (WHERE t."reopenCount" > 0 AND ${createdIn(f)})                              AS reopened
    FROM "Team" tm
    JOIN "Ticket" t ON t."teamId" = tm.id AND ${scopeSql(auth)} AND ${filterSql(f)}
    GROUP BY tm.id, tm.name
    ORDER BY tm.name`;
  return rows.map((r) => {
    const met = int(r.sla_met);
    const breached = int(r.sla_breached);
    return {
      id: String(r.id),
      name: String(r.name),
      created: int(r.created),
      open: int(r.open),
      resolved: int(r.resolved),
      avgResolutionMinutes: num(r.avg_resolution),
      avgFirstResponseMinutes: num(r.avg_first_response),
      slaCompliancePercent: pct(met, met + breached),
      reopened: int(r.reopened),
      reopenRatePercent: pct(int(r.reopened), int(r.created)),
    };
  });
}

// ───────────────────────────── SLA ─────────────────────────────

export async function slaReport(auth: AuthContext, f: ReportFilters) {
  const where = Prisma.sql`${scopeSql(auth)} AND ${filterSql(f)} AND ${createdIn(f)}`;
  const byPriority = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT t.priority::text AS priority,
      COUNT(*)                                       AS total,
      COUNT(*) FILTER (WHERE ${MET})                 AS met,
      COUNT(*) FILTER (WHERE ${BREACHED})            AS breached,
      COUNT(*) FILTER (WHERE ${FR_BREACH})           AS first_response_breaches,
      COUNT(*) FILTER (WHERE ${RES_BREACH})          AS resolution_breaches,
      COUNT(*) FILTER (WHERE t."firstResponseAt" IS NOT NULL AND t."firstResponseAt" <= t."firstResponseDueAt") AS first_response_met,
      COUNT(*) FILTER (WHERE t."firstResponseAt" IS NOT NULL)                                                   AS responded,
      AVG(${MINUTES(Prisma.sql`t."createdAt"`, Prisma.sql`t."firstResponseAt"`)}) FILTER (WHERE t."firstResponseAt" IS NOT NULL) AS avg_first_response
    FROM "Ticket" t WHERE ${where} GROUP BY 1`;
  const breachedTickets = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT t.id, t.number, t.subject, t.status::text AS status, t.priority::text AS priority,
           t."resolutionDueAt", t."firstResponseDueAt", u.name AS assignee
    FROM "Ticket" t LEFT JOIN "User" u ON u.id = t."assigneeId"
    WHERE ${scopeSql(auth)} AND ${filterSql(f)} AND ${ACTIVE} AND ${BREACHED}
    ORDER BY t."resolutionDueAt" ASC NULLS LAST LIMIT 25`;
  const rows = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((p) => {
    const r = byPriority.find((x) => x.priority === p) ?? {};
    const met = int(r.met);
    const breached = int(r.breached);
    return {
      priority: p,
      total: int(r.total),
      met,
      breached,
      firstResponseBreaches: int(r.first_response_breaches),
      resolutionBreaches: int(r.resolution_breaches),
      compliancePercent: pct(met, met + breached),
      firstResponseMetPercent: pct(int(r.first_response_met), int(r.responded)),
      avgFirstResponseMinutes: num(r.avg_first_response),
    };
  });
  return { byPriority: rows, openBreaches: breachedTickets };
}

// ───────────────────────────── Satisfaction ─────────────────────────────

export async function satisfaction(auth: AuthContext, f: ReportFilters) {
  const where = Prisma.sql`${scopeSql(auth)} AND ${filterSql(f)} AND fb."createdAt" BETWEEN ${f.from} AND ${f.to}`;
  const [dist, recent] = await Promise.all([
    prisma.$queryRaw<{ rating: number; count: unknown }[]>`
      SELECT fb.rating, COUNT(*) AS count FROM "CustomerFeedback" fb JOIN "Ticket" t ON t.id = fb."ticketId" WHERE ${where} GROUP BY 1`,
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT fb.rating, fb.comment, fb."createdAt", t.id AS "ticketId", t.number, u.name AS requester
      FROM "CustomerFeedback" fb JOIN "Ticket" t ON t.id = fb."ticketId" JOIN "User" u ON u.id = fb."requesterId"
      WHERE ${where} ORDER BY fb."createdAt" DESC LIMIT 10`,
  ]);
  const distribution = [1, 2, 3, 4, 5].map((rating) => ({ rating, count: int(dist.find((d) => Number(d.rating) === rating)?.count) }));
  const responses = distribution.reduce((s, d) => s + d.count, 0);
  const avg = responses ? distribution.reduce((s, d) => s + d.rating * d.count, 0) / responses : null;
  const satisfied = distribution.filter((d) => d.rating >= 4).reduce((s, d) => s + d.count, 0);
  return { average: num(avg), responses, satisfiedPercent: pct(satisfied, responses), distribution, recent };
}

// ───────────────────────────── Ticket export ─────────────────────────────

export async function ticketExportRows(auth: AuthContext, f: ReportFilters) {
  return prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT t.number, t.subject, t.status::text AS status, t.priority::text AS priority, t.source::text AS source,
           r.name AS requester, r.email AS requester_email, a.name AS assignee, tm.name AS team, c.name AS category,
           t."createdAt" AS created_at, t."firstResponseAt" AS first_response_at, t."resolvedAt" AS resolved_at, t."closedAt" AS closed_at,
           t."firstResponseDueAt" AS first_response_due, t."resolutionDueAt" AS resolution_due,
           CASE WHEN ${BREACHED} THEN 'breached' WHEN ${MET} THEN 'met' ELSE 'pending' END AS sla,
           t."reopenCount" AS reopen_count, fb.rating AS csat
    FROM "Ticket" t
    JOIN "User" r ON r.id = t."requesterId"
    LEFT JOIN "User" a ON a.id = t."assigneeId"
    LEFT JOIN "Team" tm ON tm.id = t."teamId"
    LEFT JOIN "TicketCategory" c ON c.id = t."categoryId"
    LEFT JOIN "CustomerFeedback" fb ON fb."ticketId" = t.id
    WHERE ${scopeSql(auth)} AND ${filterSql(f)} AND ${createdIn(f)}
    ORDER BY t."createdAt" DESC
    LIMIT 50000`;
}

/** RFC 4180 CSV with spreadsheet formula-injection protection. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? v.toString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}
