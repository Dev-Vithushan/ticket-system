import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../helpers/db';
import { Client, insertTicket, standardFixture } from '../helpers/factories';

// 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

let fx: Awaited<ReturnType<typeof standardFixture>>;
let ticketId: string;
beforeEach(async () => {
  await resetDb();
  fx = await standardFixture();
  ticketId = (await insertTicket({ requesterId: fx.customer.id, teamId: fx.team.id, assigneeId: fx.agent.id, status: 'IN_PROGRESS' })).id;
});

describe('attachments', () => {
  it('uploads validated files and serves them only to authorised users', async () => {
    const c = await Client.as(fx.customer);
    const up = await c.upload(`/api/tickets/${ticketId}/attachments`).attach('files', PNG, 'screenshot.png').attach('files', PDF, 'report.pdf');
    expect(up.status).toBe(201);
    expect(up.body.data).toHaveLength(2);
    const png = up.body.data.find((a: { originalName: string }) => a.originalName === 'screenshot.png');
    expect(png.mimeType).toBe('image/png');
    expect(png).not.toHaveProperty('storageKey');

    const dl = await c.get(`/api/tickets/${ticketId}/attachments/${png.id}/download`).buffer(true);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(Buffer.compare(dl.body as Buffer, PNG)).toBe(0);

    expect((await (await Client.as(fx.agent)).get(`/api/tickets/${ticketId}/attachments/${png.id}/download`)).status).toBe(200);
    expect((await (await Client.as(fx.customer2)).get(`/api/tickets/${ticketId}/attachments/${png.id}/download`)).status).toBe(404);
    expect((await (await Client.as(fx.outsider)).get(`/api/tickets/${ticketId}/attachments/${png.id}/download`)).status).toBe(404);
    expect((await (await Client.anonymous()).get(`/api/tickets/${ticketId}/attachments/${png.id}/download`)).status).toBe(401);
  });

  it('rejects disallowed or disguised content', async () => {
    const c = await Client.as(fx.customer);
    const html = await c.upload(`/api/tickets/${ticketId}/attachments`).attach('files', Buffer.from('<html><script>alert(1)</script></html>'), 'invoice.png');
    expect(html.status).toBe(422);
    const exe = await c.upload(`/api/tickets/${ticketId}/attachments`).attach('files', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]), 'tool.pdf');
    expect(exe.status).toBe(422);
    const empty = await c.upload(`/api/tickets/${ticketId}/attachments`);
    expect(empty.status).toBe(400);
  });

  it('keeps attachments of internal notes away from customers', async () => {
    const agent = await Client.as(fx.agent);
    const note = await agent.upload(`/api/tickets/${ticketId}/comments`).field('body', 'log file').field('isInternal', 'true').attach('files', Buffer.from('stack trace line 1\nline 2\n'), 'server.log.txt');
    expect(note.status).toBe(201);
    const staffList = await agent.get(`/api/tickets/${ticketId}/attachments`);
    expect(staffList.body.data).toHaveLength(1);
    const id = staffList.body.data[0].id;
    const customer = await Client.as(fx.customer);
    expect((await customer.get(`/api/tickets/${ticketId}/attachments`)).body.data).toHaveLength(0);
    expect((await customer.get(`/api/tickets/${ticketId}/attachments/${id}/download`)).status).toBe(404);
    expect((await customer.delete(`/api/tickets/${ticketId}/attachments/${id}`)).status).toBe(404);
  });

  it('soft-deletes attachments with an audit trail', async () => {
    const c = await Client.as(fx.customer);
    const up = await c.upload(`/api/tickets/${ticketId}/attachments`).attach('files', PNG, 'a.png');
    const id = up.body.data[0].id;
    expect((await (await Client.as(fx.customer2)).delete(`/api/tickets/${ticketId}/attachments/${id}`)).status).toBe(404);
    expect((await c.delete(`/api/tickets/${ticketId}/attachments/${id}`)).status).toBe(200);
    expect((await c.get(`/api/tickets/${ticketId}/attachments`)).body.data).toHaveLength(0);
    const history = (await c.get(`/api/tickets/${ticketId}/history`)).body.data.map((h: { action: string }) => h.action);
    expect(history).toEqual(expect.arrayContaining(['ATTACHMENT_ADDED', 'ATTACHMENT_REMOVED']));
  });
});
