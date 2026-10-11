import { Router } from 'express';
import { badRequest } from '../../lib/errors';
import { defineRoute } from '../../lib/route';
import { uuid, z } from '../../lib/zod';
import { sensitiveLimiter } from '../../middleware/rateLimit';
import { PERMISSIONS } from '../auth/permissions';
import * as reports from './reports.service';

const router = Router();
const M = '/reports';
const tags = ['Reports'];

const filters = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    teamId: uuid.optional(),
    assigneeId: uuid.optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    categoryId: uuid.optional(),
  })
  .transform((q) => {
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 30 * 86_400_000);
    return { ...q, from, to };
  })
  .refine((q) => q.from <= q.to, { message: '"from" must be before "to"' })
  .refine((q) => q.to.getTime() - q.from.getTime() <= 3 * 366 * 86_400_000, { message: 'Date range may not exceed 3 years' });

// zod-to-openapi needs a plain object for query docs
const filterDoc = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  teamId: uuid.optional(),
  assigneeId: uuid.optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  categoryId: uuid.optional(),
});

const parse = (q: unknown) => filters.parse(q);

defineRoute(router, M, {
  method: 'get',
  path: '/summary',
  tags,
  summary: 'Headline metrics (counts, overdue, SLA compliance, response/resolution times, CSAT)',
  description: 'Available to every user; figures are restricted to the tickets the caller can access.',
  query: filterDoc,
  handler: async ({ req, auth }) => ({ data: await reports.summary(auth, parse(req.query)) }),
});

defineRoute(router, M, {
  method: 'get',
  path: '/volume',
  tags,
  summary: 'Tickets created and resolved per day / week / month',
  query: filterDoc.extend({ interval: z.enum(['day', 'week', 'month']).default('day') }),
  handler: async ({ req, auth }) => {
    const interval = z.enum(['day', 'week', 'month']).default('day').parse(req.query.interval);
    const f = parse(req.query);
    const days = (f.to.getTime() - f.from.getTime()) / 86_400_000;
    if (interval === 'day' && days > 400) throw badRequest('Use a weekly or monthly interval for ranges over 400 days');
    return { data: await reports.volume(auth, f, interval) };
  },
});

defineRoute(router, M, {
  method: 'get',
  path: '/distribution',
  tags,
  summary: 'Ticket distribution by priority, status, category, source and team',
  query: filterDoc,
  handler: async ({ req, auth }) => ({ data: await reports.distribution(auth, parse(req.query)) }),
});

defineRoute(router, M, {
  method: 'get',
  path: '/agents',
  tags,
  summary: 'Agent workload and performance',
  permissions: [PERMISSIONS.REPORT_VIEW],
  query: filterDoc,
  handler: async ({ req, auth }) => ({ data: await reports.agentPerformance(auth, parse(req.query)) }),
});

defineRoute(router, M, {
  method: 'get',
  path: '/teams',
  tags,
  summary: 'Resolution time, SLA and reopen rate by team',
  permissions: [PERMISSIONS.REPORT_VIEW],
  query: filterDoc,
  handler: async ({ req, auth }) => ({ data: await reports.teamPerformance(auth, parse(req.query)) }),
});

defineRoute(router, M, {
  method: 'get',
  path: '/sla',
  tags,
  summary: 'SLA compliance, first-response performance and open breaches by priority',
  permissions: [PERMISSIONS.REPORT_VIEW],
  query: filterDoc,
  handler: async ({ req, auth }) => ({ data: await reports.slaReport(auth, parse(req.query)) }),
});

defineRoute(router, M, {
  method: 'get',
  path: '/satisfaction',
  tags,
  summary: 'Customer satisfaction (CSAT)',
  permissions: [PERMISSIONS.REPORT_VIEW],
  query: filterDoc,
  handler: async ({ req, auth }) => ({ data: await reports.satisfaction(auth, parse(req.query)) }),
});

const EXPORTS = ['tickets', 'agents', 'teams', 'sla', 'volume', 'satisfaction'] as const;

defineRoute(router, M, {
  method: 'get',
  path: '/export',
  tags,
  summary: 'CSV export of a report',
  permissions: [PERMISSIONS.REPORT_VIEW],
  middleware: [sensitiveLimiter],
  query: filterDoc.extend({ report: z.enum(EXPORTS), interval: z.enum(['day', 'week', 'month']).optional() }),
  produces: 'text/csv',
  handler: async ({ req, res, auth }) => {
    const report = z.enum(EXPORTS).parse(req.query.report);
    const f = parse(req.query);
    let rows: Record<string, unknown>[];
    switch (report) {
      case 'tickets':
        rows = await reports.ticketExportRows(auth, f);
        break;
      case 'agents':
        rows = await reports.agentPerformance(auth, f);
        break;
      case 'teams':
        rows = await reports.teamPerformance(auth, f);
        break;
      case 'sla':
        rows = (await reports.slaReport(auth, f)).byPriority;
        break;
      case 'volume':
        rows = await reports.volume(auth, f, z.enum(['day', 'week', 'month']).default('day').parse(req.query.interval));
        break;
      case 'satisfaction':
        rows = (await reports.satisfaction(auth, f)).distribution;
        break;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${report}-report-${stamp}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send('﻿' + reports.toCsv(rows));
  },
});

export default router;
