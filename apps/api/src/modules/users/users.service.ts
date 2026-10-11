import type { Prisma } from '@prisma/client';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { pageMeta } from '../../lib/http';
import { hashPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import type { AuthContext } from '../../lib/types';
import { audit } from '../../services/audit';
import type { Request } from 'express';
import { revokeAllSessions } from '../auth/auth.service';
import { ROLE_KEYS } from '../auth/permissions';

export const userSelect = {
  id: true,
  email: true,
  name: true,
  jobTitle: true,
  phone: true,
  organization: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  deactivatedAt: true,
  role: { select: { id: true, key: true, name: true, isStaff: true } },
  department: { select: { id: true, name: true } },
  teamMemberships: { select: { role: true, team: { select: { id: true, name: true } } } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;
export const toUserDto = ({ teamMemberships, ...u }: UserRow) => ({
  ...u,
  teams: teamMemberships.map((m) => ({ ...m.team, role: m.role })),
});

export interface ListUsersQuery {
  page: number;
  pageSize: number;
  search?: string;
  roleKey?: string[];
  isActive?: boolean;
  isStaff?: boolean;
  teamId?: string;
  departmentId?: string;
  sort: 'name' | 'email' | 'createdAt' | 'lastLoginAt';
  order: 'asc' | 'desc';
}

export async function listUsers(q: ListUsersQuery) {
  const where: Prisma.UserWhereInput = {
    ...(q.search && {
      OR: [
        { name: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { organization: { contains: q.search, mode: 'insensitive' } },
      ],
    }),
    ...(q.roleKey?.length && { role: { key: { in: q.roleKey } } }),
    ...(q.isStaff !== undefined && { role: { ...(q.roleKey?.length ? { key: { in: q.roleKey } } : {}), isStaff: q.isStaff } }),
    ...(q.isActive !== undefined && { isActive: q.isActive }),
    ...(q.teamId && { teamMemberships: { some: { teamId: q.teamId } } }),
    ...(q.departmentId && { departmentId: q.departmentId }),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { [q.sort]: q.order },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { data: rows.map(toUserDto), meta: pageMeta(q.page, q.pageSize, total) };
}

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: userSelect });
  if (!user) throw notFound('User');
  return toUserDto(user);
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  roleId: string;
  departmentId?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  organization?: string | null;
  teamIds?: string[];
}

export async function createUser(input: CreateUserInput, req: Request) {
  const email = input.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw conflict('A user with this email already exists');
  await prisma.role.findUniqueOrThrow({ where: { id: input.roleId } }).catch(() => {
    throw badRequest('Unknown role');
  });
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        roleId: input.roleId,
        departmentId: input.departmentId ?? null,
        jobTitle: input.jobTitle,
        phone: input.phone,
        organization: input.organization,
        teamMemberships: input.teamIds?.length ? { create: input.teamIds.map((teamId) => ({ teamId })) } : undefined,
      },
      select: userSelect,
    });
    await audit({ req, action: 'user.create', entityType: 'User', entityId: u.id, metadata: { email, roleId: input.roleId } }, tx);
    return u;
  });
  return toUserDto(user);
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  roleId?: string;
  departmentId?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  organization?: string | null;
  teamIds?: string[];
}

async function assertNotLastSuperAdmin(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true } });
  if (user.role.key !== ROLE_KEYS.SUPER_ADMIN) return;
  const count = await prisma.user.count({ where: { isActive: true, role: { key: ROLE_KEYS.SUPER_ADMIN } } });
  if (count <= 1) throw badRequest('Cannot remove or deactivate the last active Super Admin');
}

export async function updateUser(id: string, input: UpdateUserInput, req: Request, actor: AuthContext) {
  const existing = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!existing) throw notFound('User');
  if (input.roleId && input.roleId !== existing.roleId) {
    if (id === actor.user.id) throw badRequest('You cannot change your own role');
    await assertNotLastSuperAdmin(id);
  }
  if (input.email && input.email.toLowerCase() !== existing.email) {
    if (await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } })) throw conflict('Email already in use');
  }
  const { teamIds, ...fields } = input;
  const user = await prisma.$transaction(async (tx) => {
    if (teamIds) {
      await tx.teamMembership.deleteMany({ where: { userId: id, teamId: { notIn: teamIds } } });
      const current = await tx.teamMembership.findMany({ where: { userId: id }, select: { teamId: true } });
      const have = new Set(current.map((c) => c.teamId));
      const add = teamIds.filter((t) => !have.has(t));
      if (add.length) await tx.teamMembership.createMany({ data: add.map((teamId) => ({ teamId, userId: id })) });
    }
    const u = await tx.user.update({
      where: { id },
      data: { ...fields, email: fields.email?.toLowerCase() },
      select: userSelect,
    });
    await audit(
      {
        req,
        action: input.roleId && input.roleId !== existing.roleId ? 'user.role_changed' : 'user.update',
        entityType: 'User',
        entityId: id,
        metadata: { changes: Object.keys(input), fromRole: existing.role.key, toRoleId: input.roleId },
      },
      tx,
    );
    return u;
  });
  if (input.roleId && input.roleId !== existing.roleId) await revokeAllSessions(id);
  return toUserDto(user);
}

export async function setUserActive(id: string, isActive: boolean, req: Request, actor: AuthContext) {
  if (id === actor.user.id && !isActive) throw badRequest('You cannot deactivate your own account');
  if (!isActive) await assertNotLastSuperAdmin(id);
  const user = await prisma.user.update({
    where: { id },
    data: { isActive, deactivatedAt: isActive ? null : new Date(), failedLoginCount: 0, lockedUntil: null },
    select: userSelect,
  });
  if (!isActive) {
    await revokeAllSessions(id);
    // Unassign open tickets is a manager decision; we only clear sessions. Tickets keep history.
  }
  await audit({ req, action: isActive ? 'user.activate' : 'user.deactivate', entityType: 'User', entityId: id });
  return toUserDto(user);
}

export async function resetPassword(id: string, password: string, req: Request) {
  const changedAt = new Date(Math.ceil(Date.now() / 1000) * 1000);
  await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(password), passwordChangedAt: changedAt, failedLoginCount: 0, lockedUntil: null },
  });
  await revokeAllSessions(id);
  await audit({ req, action: 'user.password_reset', entityType: 'User', entityId: id });
}
