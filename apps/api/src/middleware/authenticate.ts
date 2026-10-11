import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { ACCESS_COOKIE } from '../lib/cookies';
import { verifyAccessToken } from '../lib/tokens';
import type { AuthContext } from '../lib/types';
import type { PermissionKey } from '../modules/auth/permissions';

/** The access token only ever travels in the HttpOnly cookie (never exposed to JavaScript). */
export function readAccessToken(req: Request): string | null {
  const cookie = req.cookies?.[ACCESS_COOKIE];
  return typeof cookie === 'string' && cookie ? cookie : null;
}

export async function loadAuthContext(userId: string, passwordVersion?: number): Promise<AuthContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      teamMemberships: { where: { team: { isActive: true } }, select: { teamId: true, role: true } },
    },
  });
  if (!user || !user.isActive) return null;
  if (passwordVersion !== undefined && user.passwordChangedAt) {
    const changed = Math.floor(user.passwordChangedAt.getTime() / 1000);
    if (passwordVersion < changed) return null;
  }
  const permissions = new Set(user.role.permissions.map((rp) => rp.permission.key));
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      roleKey: user.role.key,
      roleName: user.role.name,
      isStaff: user.role.isStaff,
    },
    permissions,
    teamIds: user.teamMemberships.map((m) => m.teamId),
    leadTeamIds: user.teamMemberships.filter((m) => m.role === 'LEAD').map((m) => m.teamId),
    can: (p: PermissionKey) => permissions.has(p),
  };
}

/** Populates req.auth when a valid token is present. Never rejects on its own. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = readAccessToken(req);
    if (token) {
      const payload = verifyAccessToken(token);
      if (payload) {
        const ctx = await loadAuthContext(payload.sub, payload.pv);
        if (ctx) req.auth = ctx;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}
