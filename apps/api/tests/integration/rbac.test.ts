import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/db';
import { Client, createUser, insertTicket, standardFixture } from '../helpers/factories';

let fx: Awaited<ReturnType<typeof standardFixture>>;
beforeEach(async () => {
  await resetDb();
  fx = await standardFixture();
});

describe('authorization (enforced server-side)', () => {
  it('customers cannot reach staff or admin endpoints', async () => {
    const c = await Client.as(fx.customer);
    expect((await c.get('/api/users')).status).toBe(403);
    expect((await c.get('/api/teams')).status).toBe(403);
    expect((await c.get('/api/reports/agents')).status).toBe(403);
    expect((await c.get('/api/audit-logs')).status).toBe(403);
    expect((await c.patch('/api/settings', { organizationName: 'Hacked' })).status).toBe(403);
    expect((await c.post('/api/tickets/bulk', { ticketIds: [fx.team.id], status: 'CLOSED' })).status).toBe(403);
  });

  it('agents cannot manage users, roles or settings', async () => {
    const c = await Client.as(fx.agent);
    expect((await c.get('/api/users')).status).toBe(200); // directory read is allowed
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    expect((await c.post('/api/users', { email: 'x@test.local', name: 'Xavier', password: 'Val1dPassword!', roleId: role.id })).status).toBe(403);
    expect((await c.patch(`/api/roles/${role.id}`, { name: 'Pwned' })).status).toBe(403);
    expect((await c.post('/api/departments', { name: 'Shadow IT' })).status).toBe(403);
    expect((await c.patch(`/api/users/${fx.agent.id}`, { roleId: role.id })).status).toBe(403);
  });

  it('customers only see their own tickets; foreign tickets are 404', async () => {
    const mine = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id });
    const theirs = await insertTicket({ requesterId: fx.customer2.id, teamId: fx.team.id });
    const c = await Client.as(fx.customer);
    const list = await c.get('/api/tickets');
    expect(list.body.data.map((t: { id: string }) => t.id)).toEqual([mine.id]);
    expect((await c.get(`/api/tickets/${theirs.id}`)).status).toBe(404);
    expect((await c.get(`/api/tickets/${theirs.id}/comments`)).status).toBe(404);
    expect((await c.post(`/api/tickets/${theirs.id}/comments`, { body: 'hi' })).status).toBe(404);
  });

  it('agents see team and assigned tickets but not other teams', async () => {
    const teamTicket = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id });
    const otherTeam = await insertTicket({ requesterId: fx.customer.id, teamId: fx.otherTeam.id });
    const assignedAcross = await insertTicket({ requesterId: fx.customer.id, teamId: fx.otherTeam.id, assigneeId: fx.agent.id, status: 'ASSIGNED' });
    const c = await Client.as(fx.agent);
    const ids = (await c.get('/api/tickets')).body.data.map((t: { id: string }) => t.id).sort();
    expect(ids).toEqual([teamTicket.id, assignedAcross.id].sort());
    expect((await c.get(`/api/tickets/${otherTeam.id}`)).status).toBe(404);
    // Reports are scoped the same way
    const summary = await c.get('/api/reports/summary');
    expect(summary.body.data.total).toBe(2);
  });

  it('super admins see everything', async () => {
    await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id });
    await insertTicket({ requesterId: fx.customer2.id, teamId: fx.otherTeam.id });
    const c = await Client.as(fx.admin);
    expect((await c.get('/api/tickets')).body.meta.total).toBe(2);
  });

  it('admins manage users; changes are audited; last super admin is protected', async () => {
    const c = await Client.as(fx.admin);
    const agentRole = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPPORT_AGENT' } });
    const created = await c.post('/api/users', { email: 'Hire@Test.local', name: 'New Hire', password: 'Val1dPassword!', roleId: agentRole.id, teamIds: [fx.team.id] });
    expect(created.status).toBe(201);
    expect(created.body.data.email).toBe('hire@test.local');
    expect(created.body.data).not.toHaveProperty('passwordHash');
    expect((await c.post('/api/users', { email: 'hire@test.local', name: 'Dup', password: 'Val1dPassword!', roleId: agentRole.id })).status).toBe(409);
    expect((await c.post(`/api/users/${created.body.data.id}/deactivate`)).status).toBe(200);
    expect((await c.post(`/api/users/${fx.admin.id}/deactivate`)).status).toBe(400);
    const actions = (await prisma.auditLog.findMany({ where: { actorId: fx.admin.id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['user.create', 'user.deactivate']));
  });

  it('super admin role cannot lose user/role/settings management', async () => {
    const c = await Client.as(fx.admin);
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    expect((await c.patch(`/api/roles/${role.id}`, { permissions: ['ticket.view_all'] })).status).toBe(400);
  });

  it('role permission changes take effect on the next request', async () => {
    const c = await Client.as(fx.agent);
    expect((await c.get('/api/reports/agents')).status).toBe(200);
    const admin = await Client.as(fx.admin);
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPPORT_AGENT' }, include: { permissions: { include: { permission: true } } } });
    const keep = role.permissions.map((p) => p.permission.key).filter((k) => k !== 'report.view');
    expect((await admin.patch(`/api/roles/${role.id}`, { permissions: keep })).status).toBe(200);
    expect((await c.get('/api/reports/agents')).status).toBe(403);
  });
});
