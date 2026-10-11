import rateLimit from 'express-rate-limit';
import { config } from '../config/env';

const handler = (_req: unknown, res: import('express').Response) =>
  res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later' } });

const skip = () => config.isTest;

export const globalLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, handler, skip });

/** Authentication endpoints: brute-force protection (per IP). Account lockout adds per-user protection. */
export const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, handler, skip });

/** Sensitive writes such as uploads, exports and admin operations. */
export const sensitiveLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, handler, skip });
