import { addDays } from '../../lib/time';
import { config } from '../../config/env';
import { AppError, conflict, forbidden, unauthorized } from '../../lib/errors';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import { randomToken, sha256, signAccessToken } from '../../lib/tokens';
import type { RequestMeta } from '../../lib/types';
import { audit } from '../../services/audit';
import { getSettings } from '../../services/settings';
import { ROLE_KEYS } from './permissions';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

const passwordVersion = (d: Date | null) => (d ? Math.floor(d.getTime() / 1000) : 0);

async function issueTokens(user: { id: string; passwordChangedAt: Date | null }, meta: RequestMeta, familyId?: string) {
  const refreshToken = randomToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      familyId: familyId ?? randomToken(16),
      expiresAt: addDays(new Date(), config.REFRESH_TOKEN_TTL_DAYS),
      userAgent: meta.userAgent?.slice(0, 500),
      ipAddress: meta.ip,
    },
  });
  return { accessToken: signAccessToken({ sub: user.id, pv: passwordVersion(user.passwordChangedAt) }), refreshToken };
}

export async function login(emailRaw: string, password: string, meta: RequestMeta): Promise<IssuedTokens & { userId: string }> {
  const email = emailRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await burnPasswordCheck(password);
    await audit({ action: 'auth.login_failed', entityType: 'User', metadata: { email, reason: 'unknown_email' } });
    throw unauthorized('Invalid email or password');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await audit({ actorId: user.id, action: 'auth.login_locked', entityType: 'User', entityId: user.id });
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Account temporarily locked due to repeated failed logins. Try again later.');
  }
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    const attempts = user.failedLoginCount + 1;
    const lock = attempts >= config.LOGIN_MAX_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : attempts,
        lockedUntil: lock ? new Date(Date.now() + config.LOGIN_LOCK_MINUTES * 60_000) : undefined,
      },
    });
    await audit({
      actorId: user.id,
      action: lock ? 'auth.account_locked' : 'auth.login_failed',
      entityType: 'User',
      entityId: user.id,
      metadata: { attempts },
    });
    throw unauthorized('Invalid email or password');
  }
  if (!user.isActive) {
    throw forbidden('This account has been deactivated. Contact your administrator.');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await audit({ actorId: user.id, action: 'auth.login', entityType: 'User', entityId: user.id, metadata: { ip: meta.ip } });
  return { ...(await issueTokens(user, meta)), userId: user.id };
}

/** Rotates a refresh token. Reuse of an already-rotated token revokes the whole token family. */
export async function refresh(rawToken: string, meta: RequestMeta): Promise<IssuedTokens> {
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) }, include: { user: true } });
  if (!existing) throw unauthorized('Invalid session');
  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({ where: { familyId: existing.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({ actorId: existing.userId, action: 'auth.refresh_reuse_detected', entityType: 'User', entityId: existing.userId });
    throw unauthorized('Session expired');
  }
  if (existing.expiresAt < new Date() || !existing.user.isActive) throw unauthorized('Session expired');
  const revoked = await prisma.refreshToken.updateMany({
    where: { id: existing.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (revoked.count === 0) throw unauthorized('Session expired'); // concurrent rotation
  return issueTokens(existing.user, meta, existing.familyId);
}

export async function logout(rawToken: string | undefined) {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string) {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function changePassword(userId: string, current: string, next: string, meta: RequestMeta) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(user.passwordHash, current))) {
    throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
  }
  // second precision so tokens issued in the same second as the change are still invalidated
  const changedAt = new Date(Math.ceil(Date.now() / 1000) * 1000);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(next), passwordChangedAt: changedAt },
  });
  await revokeAllSessions(userId);
  await audit({ actorId: userId, action: 'auth.password_changed', entityType: 'User', entityId: userId });
  return issueTokens(updated, meta);
}

export async function registerCustomer(input: { email: string; name: string; password: string; organization?: string }, meta: RequestMeta) {
  const settings = await getSettings();
  if (!settings.allowSelfRegistration) throw forbidden('Self-registration is disabled');
  const email = input.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw conflict('An account with this email already exists');
  const role = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.CUSTOMER } });
  const user = await prisma.user.create({
    data: {
      email,
      name: input.name,
      organization: input.organization,
      passwordHash: await hashPassword(input.password),
      roleId: role.id,
    },
  });
  await audit({ actorId: user.id, action: 'auth.registered', entityType: 'User', entityId: user.id });
  return { ...(await issueTokens(user, meta)), userId: user.id };
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      department: { select: { id: true, name: true } },
      teamMemberships: { include: { team: { select: { id: true, name: true } } } },
    },
  });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    jobTitle: user.jobTitle,
    phone: user.phone,
    organization: user.organization,
    emailNotifications: user.emailNotifications,
    lastLoginAt: user.lastLoginAt,
    role: { id: user.role.id, key: user.role.key, name: user.role.name, isStaff: user.role.isStaff },
    permissions: user.role.permissions.map((p) => p.permission.key).sort(),
    department: user.department,
    teams: user.teamMemberships.map((m) => ({ id: m.team.id, name: m.team.name, role: m.role })),
  };
}
