import type { NextFunction, Request, Response } from 'express';
import { CSRF_COOKIE, CSRF_HEADER } from '../lib/cookies';
import { AppError } from '../lib/errors';
import { safeEqual } from '../lib/tokens';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF protection: every state-changing request must echo the readable CSRF cookie
 * in the X-CSRF-Token header. Combined with SameSite=Lax cookies and a strict CORS allow-list.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (typeof cookie !== 'string' || !cookie || !header || !safeEqual(cookie, header)) {
    return next(new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token'));
  }
  next();
}
