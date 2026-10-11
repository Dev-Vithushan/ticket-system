import type { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config/env';

const handler = (_req: Request, res: Response) =>
  res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later' } });

const skip = () => config.isTest;
const base = { standardHeaders: 'draft-7' as const, legacyHeaders: false, handler, skip };
const ip = (req: Request) => ipKeyGenerator(req.ip ?? 'unknown');

export const globalLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 600 });

/**
 * Credential endpoints (login/register): per IP+account to stop password guessing against one account,
 * plus a looser per-IP ceiling so a whole office behind one NAT address is not locked out.
 * Account lockout (LOGIN_MAX_ATTEMPTS) adds protection independent of IP.
 */
export const credentialLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 10,
  keyGenerator: (req) => `${ip(req)}:${String(req.body?.email ?? '').toLowerCase().slice(0, 254)}`,
});
export const credentialIpLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 200 });

/** Session refresh: high-entropy tokens, called routinely by every open tab. */
export const refreshLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 600 });

/** Password change: per authenticated user. */
export const accountLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 10, keyGenerator: (req) => req.auth?.user.id ?? ip(req) });

/** Sensitive writes such as uploads, exports and admin operations (per user). */
export const sensitiveLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 60, keyGenerator: (req) => req.auth?.user.id ?? ip(req) });
