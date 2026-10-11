import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/db';
import { Client, insertTicket, standardFixture } from '../helpers/factories';

let fx: Awaited<ReturnType<typeof standardFixture>>;
beforeEach(async () => {
  await resetDb();
  fx = await standardFixture();
});

const createAs = async (c: Client, extra: object = {}) => {
  const res = await c.post('/api/tickets', {
    subject: 'Cannot export monthly report',
    description: 'Export button spins forever and nothing downloads.',
    priority: 'HIGH',
    categoryId: fx.category.parent.id,
    subcategoryId: fx.category.child.id,
    ...extra,
  });
  return res;
};

describe('ticket creation', () => {
  it('creates a numbered ticket routed to the category team with SLA deadlines and history', async () => {
    const c = await Client.as(fx.customer);
    const res = await createAs(c);
    expect(res.status).toBe(201);
    const t = res.body.data;
    expect(t.number).toMatch(/^TKT-\d{4}-00001$/);
    expect(t.status).toBe('OPEN');
    expect(t.source).toBe('WEB');
    expect(t.team.id).toBe(fx.team.id);
    expect(t.requester.id).toBe(fx.customer.id);
    expect(t.sla.firstResponse.dueAt).toBeTruthy();
    expect(new Date(t.sla.resolution.dueAt).getTime()).toBeGreaterThan(new Date(t.sla.firstResponse.dueAt).getTime());
    expect(t.capabilities.canAddInternalNote).toBe(false);
    const second = await createAs(c);
    expect(second.body.data.number).toMatch(/-00002$/);
    const history = await prisma.ticketHistory.findMany({ where: { ticketId: t.id } });
    expect(history.map((h) => h.action)).toContain('CREATED');
    // team members are notified
    expect(await prisma.notification.count({ where: { userId: fx.agent.id, type: 'TICKET_CREATED' } })).toBe(2);
  });

  it('validates input server-side', async () => {
    const c = await Client.as(fx.customer);
    const res = await c.post('/api/tickets', { subject: 'Hi', description: 'short', priority: 'URGENT' });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.details.fieldErrors)).toEqual(expect.arrayContaining(['subject', 'description', 'priority']));
    const mismatch = await createAs(c, { subcategoryId: (await prisma.ticketCategory.create({ data: { name: 'Lonely' } })).id });
    expect(mismatch.status).toBe(400);
  });

  it('customers cannot set staff-only fields or create on behalf of others', async () => {
    const c = await Client.as(fx.customer);
    expect((await createAs(c, { assigneeId: fx.agent.id })).status).toBe(403);
    expect((await createAs(c, { requesterId: fx.customer2.id })).status).toBe(403);
    expect((await createAs(c, { source: 'PHONE' })).status).toBe(403);
  });

  it('agents can log phone tickets on behalf of a customer', async () => {
    const c = await Client.as(fx.agent);
    const res = await createAs(c, { requesterId: fx.customer.id, source: 'PHONE', assigneeId: fx.agent.id });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('ASSIGNED');
    expect(res.body.data.createdBy.id).toBe(fx.agent.id);
    expect(res.body.data.requester.id).toBe(fx.customer.id);
  });

  it('uses the configured ticket number format', async () => {
    const admin = await Client.as(fx.admin);
    expect((await admin.patch('/api/settings', { ticketNumberPrefix: 'HD', ticketNumberIncludeYear: false, ticketNumberPadding: 4 })).status).toBe(200);
    const res = await createAs(await Client.as(fx.customer));
    expect(res.body.data.number).toBe('HD-0001');
  });
});

describe('assignment', () => {
  it('managers assign; agents may only accept; assignee must belong to the team', async () => {
    const t = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id });
    const agent = await Client.as(fx.agent);
    expect((await agent.post(`/api/tickets/${t.id}/assign`, { assigneeId: fx.agent2.id })).status).toBe(403);
    const accepted = await agent.post(`/api/tickets/${t.id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.assignee.id).toBe(fx.agent.id);
    expect(accepted.body.data.status).toBe('ASSIGNED');

    const mgr = await Client.as(fx.manager);
    expect((await mgr.post(`/api/tickets/${t.id}/assign`, { assigneeId: fx.outsider.id })).status).toBe(400);
    const re = await mgr.post(`/api/tickets/${t.id}/assign`, { assigneeId: fx.agent2.id });
    expect(re.status).toBe(200);
    expect(re.body.data.assignee.id).toBe(fx.agent2.id);
    const assignments = await prisma.ticketAssignment.findMany({ where: { ticketId: t.id }, orderBy: { assignedAt: 'asc' } });
    expect(assignments).toHaveLength(2);
    expect(assignments[0].endedAt).not.toBeNull();
    expect(await prisma.notification.count({ where: { userId: fx.agent2.id, type: 'TICKET_ASSIGNED' } })).toBe(1);
  });

  it('moving to another team clears an assignee who is not a member', async () => {
    const t = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, assigneeId: fx.agent.id, status: 'ASSIGNED' });
    const mgr = await Client.as(fx.admin);
    const res = await mgr.post(`/api/tickets/${t.id}/assign`, { teamId: fx.otherTeam.id });
    expect(res.body.data.team.id).toBe(fx.otherTeam.id);
    expect(res.body.data.assignee).toBeNull();
    expect(res.body.data.status).toBe('OPEN');
  });
});

describe('status transitions', () => {
  it('enforces the workflow and resolution notes', async () => {
    const t = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, assigneeId: fx.agent.id, status: 'ASSIGNED' });
    const c = await Client.as(fx.agent);
    expect((await c.post(`/api/tickets/${t.id}/status`, { status: 'CLOSED' })).status).toBe(422);
    expect((await c.post(`/api/tickets/${t.id}/status`, { status: 'IN_PROGRESS' })).status).toBe(200);
    const noNotes = await c.post(`/api/tickets/${t.id}/status`, { status: 'RESOLVED' });
    expect(noNotes.status).toBe(422);
    expect(noNotes.body.error.code).toBe('INVALID_TRANSITION');
    const resolved = await c.post(`/api/tickets/${t.id}/status`, { status: 'RESOLVED', resolutionNotes: 'Cleared the cache' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.resolvedAt).toBeTruthy();
    expect(resolved.body.data.resolutionNotes).toBe('Cleared the cache');
    expect((await c.post(`/api/tickets/${t.id}/status`, { status: 'IN_PROGRESS' })).status).toBe(422);
    const history = await c.get(`/api/tickets/${t.id}/history`);
    expect(history.body.data.filter((h: { action: string }) => h.action === 'STATUS_CHANGED').map((h: { newValue: string }) => h.newValue)).toEqual(['IN_PROGRESS', 'RESOLVED']);
    // requester was notified about resolution
    expect(await prisma.notification.count({ where: { userId: fx.customer.id, type: 'TICKET_RESOLVED' } })).toBe(1);
  });

  it('starting work on an unassigned ticket auto-accepts it', async () => {
    const t = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id });
    const res = await (await Client.as(fx.agent)).post(`/api/tickets/${t.id}/status`, { status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
    expect(res.body.data.assignee.id).toBe(fx.agent.id);
  });

  it('customers cannot change status except closing their resolved ticket', async () => {
    const t = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, assigneeId: fx.agent.id, status: 'IN_PROGRESS' });
    const c = await Client.as(fx.customer);
    expect((await c.post(`/api/tickets/${t.id}/status`, { status: 'RESOLVED', resolutionNotes: 'x' })).status).toBe(403);
    await prisma.ticket.update({ where: { id: t.id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolutionNotes: 'done' } });
    const closed = await c.post(`/api/tickets/${t.id}/status`, { status: 'CLOSED' });
    expect(closed.status).toBe(200);
    expect(closed.body.data.closedAt).toBeTruthy();
  });

  it('pending-customer pauses SLA and a requester reply resumes work', async () => {
    const due = new Date(Date.now() + 2 * 86_400_000);
    const t = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, assigneeId: fx.agent.id, status: 'IN_PROGRESS', resolutionDueAt: due });
    const agent = await Client.as(fx.agent);
    const pending = await agent.post(`/api/tickets/${t.id}/comments`, { body: 'Can you send a screenshot?', status: 'PENDING_CUSTOMER' });
    expect(pending.status).toBe(201);
    const paused = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(paused.status).toBe('PENDING_CUSTOMER');
    expect(paused.slaPausedAt).not.toBeNull();
    await prisma.ticket.update({ where: { id: t.id }, data: { slaPausedAt: new Date(Date.now() - 3 * 86_400_000) } });
    const reply = await (await Client.as(fx.customer)).post(`/api/tickets/${t.id}/comments`, { body: 'Here it is' });
    expect(reply.status).toBe(201);
    const resumed = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(resumed.status).toBe('IN_PROGRESS');
    expect(resumed.slaPausedAt).toBeNull();
    expect(resumed.resolutionDueAt!.getTime()).toBeGreaterThan(due.getTime()); // deadline extended by paused business time
  });

  it('priority change recalculates SLA and notifies', async () => {
    const c = await Client.as(fx.customer);
    const created = (await createAs(c, { priority: 'LOW' })).body.data;
    const mgr = await Client.as(fx.manager);
    const agent = await Client.as(fx.agent);
    expect((await agent.post(`/api/tickets/${created.id}/priority`, { priority: 'CRITICAL' })).status).toBe(403);
    const res = await mgr.post(`/api/tickets/${created.id}/priority`, { priority: 'CRITICAL' });
    expect(res.status).toBe(200);
    expect(new Date(res.body.data.sla.resolution.dueAt).getTime()).toBeLessThan(new Date(created.sla.resolution.dueAt).getTime());
    expect(await prisma.notification.count({ where: { userId: fx.customer.id, type: 'PRIORITY_CHANGED' } })).toBe(1);
  });

  it('escalation raises the level and notifies supervisors', async () => {
    const t = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, assigneeId: fx.agent.id, status: 'IN_PROGRESS' });
    expect((await (await Client.as(fx.agent)).post(`/api/tickets/${t.id}/escalate`, { reason: 'Customer is blocked' })).status).toBe(403);
    const res = await (await Client.as(fx.manager)).post(`/api/tickets/${t.id}/escalate`, { reason: 'Customer is blocked' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ESCALATED');
    expect(res.body.data.escalationLevel).toBe(1);
    expect(await prisma.notification.count({ where: { type: 'TICKET_ESCALATED', userId: fx.agent.id } })).toBe(1);
  });
});

describe('reopen and feedback', () => {
  it('requester may reopen a resolved ticket within the window, not a closed one', async () => {
    const t = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, assigneeId: fx.agent.id, status: 'RESOLVED', resolvedAt: new Date(), resolutionNotes: 'done' });
    const c = await Client.as(fx.customer);
    const res = await c.post(`/api/tickets/${t.id}/reopen`, { reason: 'Still broken after update' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_PROGRESS');
    expect(res.body.data.reopenCount).toBe(1);
    expect(res.body.data.resolvedAt).toBeNull();

    const old = await insertTicket({ requesterId: fx.customer.id, status: 'RESOLVED', resolvedAt: new Date(Date.now() - 30 * 86_400_000), resolutionNotes: 'done' });
    expect((await c.post(`/api/tickets/${old.id}/reopen`, { reason: 'Please reopen this' })).status).toBe(403);
    const closed = await insertTicket({ requesterId: fx.customer.id, status: 'CLOSED', resolvedAt: new Date(), resolutionNotes: 'done' });
    expect((await c.post(`/api/tickets/${closed.id}/reopen`, { reason: 'Please reopen this' })).status).toBe(403);
    const mgr = await Client.as(fx.admin);
    expect((await mgr.post(`/api/tickets/${closed.id}/reopen`, { reason: 'Customer called back' })).status).toBe(200);
  });

  it('only the requester rates once, after resolution', async () => {
    const t = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, status: 'IN_PROGRESS', assigneeId: fx.agent.id });
    const c = await Client.as(fx.customer);
    expect((await c.post(`/api/tickets/${t.id}/feedback`, { rating: 5 })).status).toBe(400);
    await prisma.ticket.update({ where: { id: t.id }, data: { status: 'CLOSED', resolvedAt: new Date(), closedAt: new Date() } });
    expect((await c.post(`/api/tickets/${t.id}/feedback`, { rating: 6 })).status).toBe(422);
    expect((await (await Client.as(fx.agent)).post(`/api/tickets/${t.id}/feedback`, { rating: 5 })).status).toBe(403);
    expect((await c.post(`/api/tickets/${t.id}/feedback`, { rating: 4, comment: 'Thanks' })).status).toBe(201);
    expect((await c.post(`/api/tickets/${t.id}/feedback`, { rating: 5 })).status).toBe(409);
  });

  it('closed tickets keep their history and reject public replies', async () => {
    const t = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, status: 'CLOSED', resolvedAt: new Date(), resolutionNotes: 'x' });
    const c = await Client.as(fx.customer);
    expect((await c.post(`/api/tickets/${t.id}/comments`, { body: 'hello?' })).status).toBe(400);
    expect((await c.get(`/api/tickets/${t.id}/history`)).status).toBe(200);
  });
});

describe('listing, filtering and bulk updates', () => {
  it('searches, filters, sorts and paginates', async () => {
    for (let i = 0; i < 12; i++) {
      await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, priority: i % 3 === 0 ? 'CRITICAL' : 'LOW', subject: i === 5 ? 'Printer on fire' : `Routine request ${i}`, createdAt: new Date(Date.now() - i * 60_000) });
    }
    const c = await Client.as(fx.manager);
    const page1 = await c.get('/api/tickets?pageSize=5&page=1&sort=createdAt&order=desc');
    expect(page1.body.data).toHaveLength(5);
    expect(page1.body.meta).toMatchObject({ page: 1, pageSize: 5, total: 12, totalPages: 3 });
    const page3 = await c.get('/api/tickets?pageSize=5&page=3');
    expect(page3.body.data).toHaveLength(2);
    expect((await c.get('/api/tickets?search=printer')).body.data.map((t: { subject: string }) => t.subject)).toEqual(['Printer on fire']);
    expect((await c.get('/api/tickets?priority=CRITICAL')).body.meta.total).toBe(4);
    expect((await c.get('/api/tickets?priority=CRITICAL,LOW&status=OPEN')).body.meta.total).toBe(12);
    const byPriority = (await c.get('/api/tickets?sort=priority&order=desc&pageSize=1')).body.data[0];
    expect(byPriority.priority).toBe('CRITICAL');
    expect((await c.get('/api/tickets?pageSize=1000')).status).toBe(422);
    expect((await c.get(`/api/tickets?from=${new Date(Date.now() + 86_400_000).toISOString()}`)).body.meta.total).toBe(0);
  });

  it('bulk updates are all-or-nothing', async () => {
    const a = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id });
    const b = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id });
    const closed = await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, status: 'CLOSED', resolvedAt: new Date(), resolutionNotes: 'x' });
    const c = await Client.as(fx.manager);
    const ok = await c.post('/api/tickets/bulk', { ticketIds: [a.id, b.id], assigneeId: fx.agent.id });
    expect(ok.status).toBe(200);
    expect(await prisma.ticket.count({ where: { assigneeId: fx.agent.id, status: 'ASSIGNED' } })).toBe(2);
    const bad = await c.post('/api/tickets/bulk', { ticketIds: [a.id, closed.id], status: 'IN_PROGRESS' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toContain(closed.number);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('ASSIGNED'); // rolled back
    expect((await (await Client.as(fx.agent)).post('/api/tickets/bulk', { ticketIds: [a.id], status: 'IN_PROGRESS' })).status).toBe(403);
  });
});
