import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';

const ISSUER = 'ticket-system';
const AUDIENCE = 'ticket-system-web';

export interface AccessTokenPayload {
  sub: string;
  /** password-changed-at epoch seconds; tokens issued before a password change are rejected */
  pv: number;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: `${config.ACCESS_TOKEN_TTL_MINUTES}m`,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof decoded !== 'object' || typeof decoded.sub !== 'string') return null;
    return { sub: decoded.sub, pv: Number((decoded as Record<string, unknown>).pv ?? 0) };
  } catch {
    return null;
  }
}

export function randomToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
