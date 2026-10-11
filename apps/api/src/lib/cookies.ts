import type { CookieOptions, Response } from 'express';
import { config } from '../config/env';

export const ACCESS_COOKIE = 'tms_access';
export const REFRESH_COOKIE = 'tms_refresh';
export const CSRF_COOKIE = 'tms_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const base = (): CookieOptions => ({
  secure: config.cookieSecure,
  sameSite: 'lax',
  domain: config.COOKIE_DOMAIN,
});

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...base(),
    httpOnly: true,
    path: '/api',
    maxAge: config.ACCESS_TOKEN_TTL_MINUTES * 60_000,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base(),
    httpOnly: true,
    path: '/api/auth', // only sent to refresh/logout endpoints
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...base(), httpOnly: true, path: '/api' });
  res.clearCookie(REFRESH_COOKIE, { ...base(), httpOnly: true, path: '/api/auth' });
}

export function setCsrfCookie(res: Response, token: string) {
  // Readable by the SPA (double-submit pattern); the SPA echoes it in the X-CSRF-Token header.
  res.cookie(CSRF_COOKIE, token, { ...base(), httpOnly: false, path: '/' });
}
