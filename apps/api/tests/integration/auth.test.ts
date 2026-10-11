import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../helpers/db';
import { Client, createUser, PASSWORD } from '../helpers/factories';

beforeEach(resetDb);

const cookieNames = (res: { headers: Record<string, unknown> }) =>
  ((res.headers['set-cookie'] as string[] | undefined) ?? []).map((c) => c.split(';')[0].split('=')[0]);

describe('authentication', () => {
  it('logs in with valid credentials and sets HttpOnly cookies (no token in body)', async () => {
    const user = await createUser('SUPPORT_AGENT');
    const c = await Client.anonymous();
    const res = await c.post('/api/auth/login', { email: user.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(user.email);
    expect(res.body.data.permissions).toContain('ticket.view_team');
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken|passwordHash/);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const access = cookies.find((c) => c.startsWith('tms_access='))!;
    const refresh = cookies.find((c) => c.startsWith('tms_refresh='))!;
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=Lax/i);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/Path=\/api\/auth/);
    const me = await c.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(user.id);
  });

  it('rejects invalid credentials with a generic message', async () => {
    const user = await createUser('CUSTOMER');
    const c = await Client.anonymous();
    const wrong = await c.post('/api/auth/login', { email: user.email, password: 'nope-nope-nope' });
    const unknown = await c.post('/api/auth/login', { email: 'ghost@test.local', password: 'whatever' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks the account after repeated failures and audits it', async () => {
    const user = await createUser('CUSTOMER');
    const c = await Client.anonymous();
    for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email: user.email, password: 'bad-password' });
    const locked = await c.post('/api/auth/login', { email: user.email, password: PASSWORD });
    expect(locked.status).toBe(423);
    const logs = await prisma.auditLog.findMany({ where: { entityId: user.id } });
    expect(logs.map((l) => l.action)).toContain('auth.account_locked');
  });

  it('requires a CSRF token for state-changing requests', async () => {
    const user = await createUser('CUSTOMER');
    const c = await Client.as(user);
    const noToken = await c.agent.post('/api/tickets').send({ subject: 'Hello world', description: 'Something is broken here' });
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('CSRF_INVALID');
    const badToken = await c.agent.post('/api/tickets').set('X-CSRF-Token', 'forged').send({ subject: 'Hello world', description: 'Something is broken here' });
    expect(badToken.status).toBe(403);
  });

  it('rejects unauthenticated access to protected endpoints', async () => {
    const c = await Client.anonymous();
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await c.get('/api/tickets')).status).toBe(401);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const user = await createUser('CUSTOMER');
    const c = await Client.anonymous();
    const login = await c.post('/api/auth/login', { email: user.email, password: PASSWORD });
    const original = (login.headers['set-cookie'] as unknown as string[]).find((x) => x.startsWith('tms_refresh='))!.split(';')[0];
    const r1 = await c.post('/api/auth/refresh');
    expect(r1.status).toBe(200);
    expect(cookieNames(r1)).toContain('tms_access');
    // Replaying the old (rotated) token is detected and kills the whole session family
    const attacker = await Client.anonymous();
    const replay = await attacker.agent
      .post('/api/auth/refresh')
      .set('X-CSRF-Token', attacker.csrf)
      .set('Cookie', `${original}; tms_csrf=${attacker.csrf}`);
    expect(replay.status).toBe(401);
    const r2 = await c.post('/api/auth/refresh');
    expect(r2.status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'auth.refresh_reuse_detected' } })).toBeGreaterThanOrEqual(1);
  });

  it('logout revokes the session', async () => {
    const user = await createUser('CUSTOMER');
    const c = await Client.as(user);
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await c.post('/api/auth/refresh')).status).toBe(401);
  });

  it('deactivated users cannot log in and lose access immediately', async () => {
    const user = await createUser('SUPPORT_AGENT');
    const c = await Client.as(user);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect((await c.get('/api/auth/me')).status).toBe(401);
    const again = await Client.anonymous();
    expect((await again.post('/api/auth/login', { email: user.email, password: PASSWORD })).status).toBe(403);
  });

  it('changing password invalidates other sessions and enforces policy', async () => {
    const user = await createUser('CUSTOMER');
    const a = await Client.as(user);
    const b = await Client.as(user);
    const weak = await a.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(422);
    const ok = await a.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'An0therStrongPass' });
    expect(ok.status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain('An0therStrongPass');
  });

  it('self-registration respects the system setting', async () => {
    const c = await Client.anonymous();
    const body = { email: 'new@test.local', name: 'New Person', password: 'Val1dPassword!' };
    expect((await c.post('/api/auth/register', body)).status).toBe(403);
    await prisma.systemSetting.create({ data: { key: 'allowSelfRegistration', value: true } });
    const { invalidateSettingsCache } = await import('../../src/services/settings');
    invalidateSettingsCache();
    const res = await c.post('/api/auth/register', body);
    expect(res.status).toBe(201);
    expect(res.body.data.role.key).toBe('CUSTOMER');
  });
});
