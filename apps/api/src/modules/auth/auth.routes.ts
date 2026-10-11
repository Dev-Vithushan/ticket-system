import { Router, type Request } from 'express';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies, setCsrfCookie, CSRF_COOKIE } from '../../lib/cookies';
import { unauthorized } from '../../lib/errors';
import { passwordSchema } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import { defineRoute } from '../../lib/route';
import { randomToken } from '../../lib/tokens';
import { z } from '../../lib/zod';
import { authLimiter } from '../../middleware/rateLimit';
import { getSettings } from '../../services/settings';
import * as auth from './auth.service';

const router = Router();
const M = '/auth';
const tags = ['Auth'];
const meta = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') });

defineRoute(router, M, {
  method: 'get',
  path: '/csrf',
  auth: false,
  tags,
  summary: 'Issue a CSRF token',
  description: 'Sets the readable `tms_csrf` cookie. Send its value in the `X-CSRF-Token` header on state-changing requests.',
  handler: ({ req, res }) => {
    const existing = req.cookies?.[CSRF_COOKIE];
    const token = typeof existing === 'string' && existing.length >= 32 ? existing : randomToken(32);
    setCsrfCookie(res, token);
    return { data: { csrfToken: token } };
  },
});

defineRoute(router, M, {
  method: 'get',
  path: '/config',
  auth: false,
  tags,
  summary: 'Public authentication configuration',
  handler: async () => {
    const s = await getSettings();
    return { data: { organizationName: s.organizationName, allowSelfRegistration: s.allowSelfRegistration } };
  },
});

defineRoute(router, M, {
  method: 'post',
  path: '/login',
  auth: false,
  tags,
  summary: 'Log in with email and password',
  description: 'Sets HttpOnly access and refresh cookies. Rate limited and protected by account lockout.',
  middleware: [authLimiter],
  body: z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) }),
  responses: { 200: 'Logged in', 401: 'Invalid credentials', 423: 'Account locked', 429: 'Rate limited' },
  handler: async ({ req, res, body }) => {
    const { accessToken, refreshToken, userId } = await auth.login(body.email, body.password, meta(req));
    setAuthCookies(res, accessToken, refreshToken);
    return { data: await auth.getProfile(userId) };
  },
});

defineRoute(router, M, {
  method: 'post',
  path: '/register',
  auth: false,
  tags,
  summary: 'Self-register as a customer (when enabled in settings)',
  middleware: [authLimiter],
  body: z.object({
    email: z.string().trim().email().max(254),
    name: z.string().trim().min(2).max(120),
    password: passwordSchema,
    organization: z.string().trim().max(120).optional(),
  }),
  responses: { 201: 'Registered', 403: 'Registration disabled', 409: 'Email in use' },
  handler: async ({ req, res, body }) => {
    const { accessToken, refreshToken, userId } = await auth.registerCustomer(body, meta(req));
    setAuthCookies(res, accessToken, refreshToken);
    res.status(201);
    return { data: await auth.getProfile(userId) };
  },
});

defineRoute(router, M, {
  method: 'post',
  path: '/refresh',
  auth: false,
  tags,
  summary: 'Rotate the refresh token and issue a new access token',
  middleware: [authLimiter],
  handler: async ({ req, res }) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (typeof raw !== 'string' || !raw) throw unauthorized('No session');
    try {
      const { accessToken, refreshToken } = await auth.refresh(raw, meta(req));
      setAuthCookies(res, accessToken, refreshToken);
      return { data: { refreshed: true } };
    } catch (err) {
      clearAuthCookies(res);
      throw err;
    }
  },
});

defineRoute(router, M, {
  method: 'post',
  path: '/logout',
  auth: false,
  tags,
  summary: 'Log out and revoke the current refresh token',
  handler: async ({ req, res }) => {
    await auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res);
    return { data: { loggedOut: true } };
  },
});

defineRoute(router, M, {
  method: 'get',
  path: '/me',
  tags,
  summary: 'Current user profile, role, permissions and teams',
  handler: async ({ auth: a }) => ({ data: await auth.getProfile(a.user.id) }),
});

defineRoute(router, M, {
  method: 'patch',
  path: '/me',
  tags,
  summary: 'Update own profile',
  body: z.object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    jobTitle: z.string().trim().max(120).nullable().optional(),
    emailNotifications: z.boolean().optional(),
  }),
  handler: async ({ auth: a, body }) => {
    await prisma.user.update({ where: { id: a.user.id }, data: body });
    return { data: await auth.getProfile(a.user.id) };
  },
});

defineRoute(router, M, {
  method: 'post',
  path: '/change-password',
  tags,
  summary: 'Change own password (revokes all other sessions)',
  middleware: [authLimiter],
  body: z
    .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
    .refine((b) => b.currentPassword !== b.newPassword, { message: 'New password must differ', path: ['newPassword'] }),
  handler: async ({ req, res, auth: a, body }) => {
    const { accessToken, refreshToken } = await auth.changePassword(a.user.id, body.currentPassword, body.newPassword, meta(req));
    setAuthCookies(res, accessToken, refreshToken);
    return { data: { changed: true } };
  },
});

export default router;
