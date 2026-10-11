import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/db';
import { Client, insertTicket, standardFixture } from '../helpers/factories';

let fx: Awaited<ReturnType<typeof standardFixture>>;
let ticketId: string;
beforeEach(async () => {
  await resetDb();
  fx = await standardFixture();
  ticketId = (await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, assigneeId: fx.agent.id, status: 'IN_PROGRESS' })).id;
});

const SECRET = 'INTERNAL-ONLY: customer is on probation, do not offer refund';

describe('public replies vs internal notes', () => {
  it('never exposes internal notes to the requester through any endpoint', async () => {
    const agent = await Client.as(fx.agent);
    expect((await agent.post(`/api/tickets/${ticketId}/comments`, { body: SECRET, isInternal: true })).status).toBe(201);
    expect((await agent.post(`/api/tickets/${ticketId}/comments`, { body: 'We are on it!' })).status).toBe(201);

    const staffView = await agent.get(`/api/tickets/${ticketId}/comments`);
    expect(staffView.body.data).toHaveLength(2);
    expect(staffView.body.data.find((c: { isInternal: boolean }) => c.isInternal).body).toBe(SECRET);

    const customer = await Client.as(fx.customer);
    const endpoints = [`/api/tickets/${ticketId}`, `/api/tickets/${ticketId}/comments`, `/api/tickets/${ticketId}/history`, `/api/tickets/${ticketId}/attachments`, '/api/tickets', '/api/tickets/activity/recent', '/api/notifications'];
    for (const url of endpoints) {
      const res = await customer.get(url);
      expect(res.status, url).toBe(200);
      expect(JSON.stringify(res.body), url).not.toContain('probation');
    }
    const comments = (await customer.get(`/api/tickets/${ticketId}/comments`)).body.data;
    expect(comments).toHaveLength(1);
    expect(comments[0].isInternal).toBe(false);
    const detail = (await customer.get(`/api/tickets/${ticketId}`)).body.data;
    expect(detail.counts.comments).toBe(1);
    expect(detail).not.toHaveProperty('timeSpentMinutes');
    const history = (await customer.get(`/api/tickets/${ticketId}/history`)).body.data;
    expect(history.some((h: { action: string }) => h.action === 'INTERNAL_NOTE_ADDED')).toBe(false);
  });

  it('customers cannot post internal notes', async () => {
    const res = await (await Client.as(fx.customer)).post(`/api/tickets/${ticketId}/comments`, { body: 'sneaky', isInternal: true });
    expect(res.status).toBe(403);
    expect(await prisma.ticketComment.count()).toBe(0);
  });

  it('first response is recorded by the first public staff reply only', async () => {
    const agent = await Client.as(fx.agent);
    await agent.post(`/api/tickets/${ticketId}/comments`, { body: 'internal first', isInternal: true });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).firstResponseAt).toBeNull();
    await (await Client.as(fx.customer)).post(`/api/tickets/${ticketId}/comments`, { body: 'any news?' });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).firstResponseAt).toBeNull();
    await agent.post(`/api/tickets/${ticketId}/comments`, { body: 'Looking now' });
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(t.firstResponseAt).not.toBeNull();
  });

  it('notifies the right people for replies', async () => {
    await (await Client.as(fx.agent)).post(`/api/tickets/${ticketId}/comments`, { body: 'Public answer' });
    expect(await prisma.notification.count({ where: { userId: fx.customer.id, type: 'NEW_REPLY' } })).toBe(1);
    await (await Client.as(fx.customer)).post(`/api/tickets/${ticketId}/comments`, { body: 'Thanks!' });
    expect(await prisma.notification.count({ where: { userId: fx.agent.id, type: 'NEW_REPLY' } })).toBe(1);
    await (await Client.as(fx.manager)).post(`/api/tickets/${ticketId}/comments`, { body: 'note', isInternal: true });
    expect(await prisma.notification.count({ where: { userId: fx.agent.id, type: 'INTERNAL_NOTE' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: fx.customer.id, type: 'INTERNAL_NOTE' } })).toBe(0);
  });

  it('time tracking is staff-only and hidden from customers', async () => {
    const agent = await Client.as(fx.agent);
    expect((await agent.post(`/api/tickets/${ticketId}/time-entries`, { minutes: 45, note: 'debugging' })).status).toBe(201);
    expect((await agent.post(`/api/tickets/${ticketId}/time-entries`, { minutes: 0 })).status).toBe(422);
    expect((await agent.get(`/api/tickets/${ticketId}`)).body.data.timeSpentMinutes).toBe(45);
    const customer = await Client.as(fx.customer);
    expect((await customer.post(`/api/tickets/${ticketId}/time-entries`, { minutes: 5 })).status).toBe(403);
    expect((await customer.get(`/api/tickets/${ticketId}/time-entries`)).status).toBe(403);
  });
});

describe('notifications', () => {
  it('lists, counts and marks own notifications as read', async () => {
    await (await Client.as(fx.agent)).post(`/api/tickets/${ticketId}/comments`, { body: 'One' });
    await (await Client.as(fx.agent)).post(`/api/tickets/${ticketId}/comments`, { body: 'Two' });
    const c = await Client.as(fx.customer);
    expect((await c.get('/api/notifications/unread-count')).body.data.count).toBe(2);
    const list = await c.get('/api/notifications');
    expect(list.body.data[0].ticket.id).toBe(ticketId);
    expect((await c.post(`/api/notifications/${list.body.data[0].id}/read`)).status).toBe(200);
    expect((await c.get('/api/notifications/unread-count')).body.data.count).toBe(1);
    // cannot touch another user's notification
    const other = await Client.as(fx.customer2);
    expect((await other.post(`/api/notifications/${list.body.data[1].id}/read`)).status).toBe(404);
    expect((await c.post('/api/notifications/read-all')).body.data.updated).toBe(1);
  });
});
