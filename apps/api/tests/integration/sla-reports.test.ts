import { beforeEach, describe, expect, it } from 'vitest';
import { runSlaMonitor } from '../../src/jobs/slaMonitor';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/db';
import { Client, insertTicket, standardFixture } from '../helpers/factories';

let fx: Awaited<ReturnType<typeof standardFixture>>;
beforeEach(async () => {
  await resetDb();
  fx = await standardFixture();
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const hoursAhead = (h: number) => new Date(Date.now() + h * 3_600_000);

describe('SLA monitor', () => {
  it('flags breaches, notifies, and auto-escalates per policy', async () => {
    const t = await insertTicket({
      requesterId: fx.customer.id,
      teamId: fx.team.id,
      assigneeId: fx.agent.id,
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      createdAt: hoursAgo(10),
      firstResponseDueAt: hoursAgo(8),
      resolutionDueAt: hoursAgo(1),
    });
    const result = await runSlaMonitor();
    expect(result.breaches).toBe(2);
    expect(result.escalations).toBe(1);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.firstResponseBreachedAt).not.toBeNull();
    expect(after.resolutionBreachedAt).not.toBeNull();
    expect(after.status).toBe('ESCALATED');
    expect(await prisma.notification.count({ where: { userId: fx.agent.id, type: 'SLA_BREACHED' } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: fx.customer.id, type: 'SLA_BREACHED' } })).toBe(0);
    // idempotent
    expect((await runSlaMonitor()).breaches).toBe(0);
  });

  it('warns once when the threshold is crossed and ignores paused tickets', async () => {
    const warn = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, assigneeId: fx.agent.id, status: 'IN_PROGRESS', createdAt: hoursAgo(9), resolutionDueAt: hoursAhead(1) });
    await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, assigneeId: fx.agent.id, status: 'PENDING_CUSTOMER', createdAt: hoursAgo(10), resolutionDueAt: hoursAgo(1) });
    await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, status: 'OPEN', createdAt: hoursAgo(1), resolutionDueAt: hoursAhead(20) });
    const r = await runSlaMonitor();
    expect(r.warnings).toBe(1);
    expect(r.breaches).toBe(0);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: warn.id } })).resolutionWarnedAt).not.toBeNull();
    expect((await runSlaMonitor()).warnings).toBe(0);
  });

  it('auto-closes resolved tickets after the grace period', async () => {
    const t = await insertTicket({ requesterId: fx.customer.id, status: 'RESOLVED', resolvedAt: hoursAgo(24 * 10), resolutionNotes: 'fixed' });
    expect((await runSlaMonitor()).autoClosed).toBe(1);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.status).toBe('CLOSED');
  });

  it('exposes live SLA state on ticket details', async () => {
    const t = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, createdAt: hoursAgo(5), firstResponseDueAt: hoursAgo(1), resolutionDueAt: hoursAhead(100) });
    const d = (await (await Client.as(fx.agent)).get(`/api/tickets/${t.id}`)).body.data;
    expect(d.sla.firstResponse.state).toBe('breached');
    expect(d.sla.resolution.state).toBe('on_track');
  });
});

describe('SLA administration', () => {
  it('validates and saves business hours, holidays and policies', async () => {
    const c = await Client.as(fx.admin);
    const days = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dayOfWeek: d, isWorkingDay: d <= 5, startMinute: 480, endMinute: 960 }));
    expect((await c.put('/api/sla/business-hours', { days })).status).toBe(200);
    expect((await c.put('/api/sla/business-hours', { days: days.map((d) => ({ ...d, endMinute: 100 })) })).status).toBe(422);
    expect((await c.post('/api/sla/holidays', { date: '2030-12-25', name: 'Christmas' })).status).toBe(201);
    expect((await c.post('/api/sla/holidays', { date: '2030-12-25', name: 'Dup' })).status).toBe(409);
    const policies = (await c.get('/api/sla/policies')).body.data;
    expect(policies).toHaveLength(4);
    const p = policies[0];
    expect((await c.patch(`/api/sla/policies/${p.id}`, { firstResponseMinutes: 600, resolutionMinutes: 60 })).status).toBe(422);
    expect((await c.patch(`/api/sla/policies/${p.id}`, { warningThresholdPercent: 70 })).status).toBe(200);
    expect((await (await Client.as(fx.manager)).patch(`/api/sla/policies/${p.id}`, { warningThresholdPercent: 50 })).status).toBe(403);
  });
});

describe('reports', () => {
  beforeEach(async () => {
    const created = hoursAgo(48);
    await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, assigneeId: fx.agent.id, status: 'RESOLVED', priority: 'HIGH', createdAt: created, resolvedAt: hoursAgo(40), resolutionDueAt: hoursAgo(30), firstResponseDueAt: hoursAgo(46), resolutionNotes: 'ok' });
    await prisma.ticket.updateMany({ data: { firstResponseAt: hoursAgo(47) } });
    await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, assigneeId: fx.agent.id, status: 'IN_PROGRESS', priority: 'LOW', createdAt: created, resolutionDueAt: hoursAgo(1) });
    await insertTicket({ requesterId: fx.customer2.id, teamId: fx.otherTeam.id, status: 'OPEN', createdAt: created });
  });

  it('computes summary metrics from real data and respects scope', async () => {
    const admin = (await (await Client.as(fx.admin)).get('/api/reports/summary')).body.data;
    expect(admin.total).toBe(3);
    expect(admin.resolved).toBe(1);
    expect(admin.overdue).toBe(1);
    expect(admin.slaMet).toBe(1);
    expect(admin.slaBreached).toBe(1);
    expect(admin.slaCompliancePercent).toBe(50);
    expect(admin.avgFirstResponseMinutes).toBe(60);
    expect(admin.avgResolutionMinutes).toBe(480);
    const customer = (await (await Client.as(fx.customer2)).get('/api/reports/summary')).body.data;
    expect(customer.total).toBe(1);
    const agent = (await (await Client.as(fx.agent)).get('/api/reports/summary')).body.data;
    expect(agent.total).toBe(2);
  });

  it('returns distribution, volume and agent workload', async () => {
    const c = await Client.as(fx.manager);
    const dist = (await c.get('/api/reports/distribution')).body.data;
    expect(dist.byPriority.find((p: { key: string }) => p.key === 'HIGH').count).toBe(1);
    const vol = (await c.get('/api/reports/volume?interval=day')).body.data;
    expect(vol.reduce((s: number, v: { created: number }) => s + v.created, 0)).toBe(2);
    const agents = (await c.get('/api/reports/agents')).body.data;
    const a = agents.find((x: { id: string }) => x.id === fx.agent.id);
    expect(a.openAssigned).toBe(1);
    expect(a.resolved).toBe(1);
    expect(agents.some((x: { id: string }) => x.id === fx.outsider.id)).toBe(false);
    expect((await c.get('/api/reports/summary?from=2030-01-01&to=2020-01-01')).status).toBe(422);
  });

  it('exports CSV for authorised users only', async () => {
    const c = await Client.as(fx.admin);
    const res = await c.get('/api/reports/export?report=tickets');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="tickets-report/);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toContain('number,subject,status');
    expect(lines).toHaveLength(4);
    expect((await (await Client.as(fx.customer)).get('/api/reports/export?report=tickets')).status).toBe(403);
  });
});
