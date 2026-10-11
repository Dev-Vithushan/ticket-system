import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { defineRoute } from '../../lib/route';
import { idParams, z } from '../../lib/zod';
import { audit } from '../../services/audit';
import { PERMISSIONS } from '../auth/permissions';
import { invalidateCalendarCache, DEFAULT_WINDOW, loadCalendar } from './sla.service';
import { runSlaMonitor } from '../../jobs/slaMonitor';

const router = Router();
const M = '/sla';
const tags = ['SLA'];
const READ = [PERMISSIONS.SLA_MANAGE, PERMISSIONS.REPORT_VIEW, PERMISSIONS.TICKET_VIEW_TEAM, PERMISSIONS.TICKET_VIEW_ALL];

defineRoute(router, M, {
  method: 'get',
  path: '/policies',
  tags,
  summary: 'List SLA policies (one per priority)',
  anyPermission: READ,
  handler: async () => ({
    data: await prisma.slaPolicy.findMany({ orderBy: { priority: 'desc' } }),
  }),
});

const policyBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    firstResponseMinutes: z.number().int().min(1).max(60 * 24 * 60),
    resolutionMinutes: z.number().int().min(1).max(60 * 24 * 365),
    useBusinessHours: z.boolean(),
    warningThresholdPercent: z.number().int().min(1).max(99),
    escalateOnBreach: z.boolean(),
    isActive: z.boolean(),
  })
  .partial()
  .refine(
    (b) => b.firstResponseMinutes === undefined || b.resolutionMinutes === undefined || b.resolutionMinutes >= b.firstResponseMinutes,
    { message: 'Resolution target must be at least the first-response target', path: ['resolutionMinutes'] },
  );

defineRoute(router, M, {
  method: 'patch',
  path: '/policies/:id',
  tags,
  summary: 'Update an SLA policy (applies to tickets created or re-prioritised afterwards)',
  permissions: [PERMISSIONS.SLA_MANAGE],
  params: idParams,
  body: policyBody,
  handler: async ({ req, params, body }) => {
    const p = await prisma.slaPolicy.update({ where: { id: params.id }, data: body });
    await audit({ req, action: 'sla.policy_update', entityType: 'SlaPolicy', entityId: p.id, metadata: body });
    return { data: p };
  },
});

defineRoute(router, M, {
  method: 'get',
  path: '/business-hours',
  tags,
  summary: 'Business hours (ISO weekday 1=Mon … 7=Sun) and time zone',
  anyPermission: READ,
  handler: async () => {
    const cal = await loadCalendar();
    const rows = await prisma.businessHours.findMany();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = i + 1;
      const row = rows.find((r) => r.dayOfWeek === d);
      return row ?? { dayOfWeek: d, isWorkingDay: d <= 5, startMinute: DEFAULT_WINDOW.start, endMinute: DEFAULT_WINDOW.end };
    });
    return { data: { timezone: cal.timezone, days } };
  },
});

defineRoute(router, M, {
  method: 'put',
  path: '/business-hours',
  tags,
  summary: 'Replace business hours',
  permissions: [PERMISSIONS.SLA_MANAGE],
  body: z.object({
    days: z
      .array(
        z
          .object({
            dayOfWeek: z.number().int().min(1).max(7),
            isWorkingDay: z.boolean(),
            startMinute: z.number().int().min(0).max(1439),
            endMinute: z.number().int().min(1).max(1440),
          })
          .refine((d) => d.endMinute > d.startMinute, { message: 'End must be after start', path: ['endMinute'] }),
      )
      .length(7)
      .refine((d) => new Set(d.map((x) => x.dayOfWeek)).size === 7, 'Each weekday exactly once')
      .refine((d) => d.some((x) => x.isWorkingDay), 'At least one working day is required'),
  }),
  handler: async ({ req, body }) => {
    await prisma.$transaction(
      body.days.map((d) => prisma.businessHours.upsert({ where: { dayOfWeek: d.dayOfWeek }, create: d, update: d })),
    );
    invalidateCalendarCache();
    await audit({ req, action: 'sla.business_hours_update', entityType: 'BusinessHours', metadata: body });
    return { data: await prisma.businessHours.findMany({ orderBy: { dayOfWeek: 'asc' } }) };
  },
});

defineRoute(router, M, {
  method: 'get',
  path: '/holidays',
  tags,
  summary: 'List holidays / non-working days',
  anyPermission: READ,
  handler: async () => ({ data: await prisma.holiday.findMany({ orderBy: { date: 'asc' } }) }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/holidays',
  tags,
  summary: 'Add a holiday',
  permissions: [PERMISSIONS.SLA_MANAGE],
  body: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'), name: z.string().trim().min(2).max(100) }),
  responses: { 201: 'Created', 409: 'Date exists' },
  handler: async ({ req, res, body }) => {
    const h = await prisma.holiday.create({ data: { date: new Date(`${body.date}T00:00:00Z`), name: body.name } });
    invalidateCalendarCache();
    await audit({ req, action: 'sla.holiday_create', entityType: 'Holiday', entityId: h.id, metadata: body });
    res.status(201);
    return { data: h };
  },
});

defineRoute(router, M, {
  method: 'delete',
  path: '/holidays/:id',
  tags,
  summary: 'Remove a holiday',
  permissions: [PERMISSIONS.SLA_MANAGE],
  params: idParams,
  handler: async ({ req, params }) => {
    const h = await prisma.holiday.delete({ where: { id: params.id } });
    invalidateCalendarCache();
    await audit({ req, action: 'sla.holiday_delete', entityType: 'Holiday', entityId: h.id, metadata: { name: h.name } });
    return { data: { deleted: true } };
  },
});

defineRoute(router, M, {
  method: 'post',
  path: '/run-check',
  tags,
  summary: 'Run the SLA monitor now (warnings, breaches, escalations, auto-close)',
  permissions: [PERMISSIONS.SLA_MANAGE],
  handler: async ({ req }) => {
    const result = await runSlaMonitor();
    await audit({ req, action: 'sla.manual_check', entityType: 'SlaPolicy', metadata: { ...result } });
    return { data: result };
  },
});

export default router;
