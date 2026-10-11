import { Router } from 'express';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { defineRoute } from '../../lib/route';
import { idParams, z } from '../../lib/zod';
import { audit } from '../../services/audit';
import { PERMISSION_CATALOGUE, PERMISSIONS, ROLE_KEYS, SUPER_ADMIN_LOCKED } from '../auth/permissions';

const router = Router();
const M = '/roles';
const tags = ['Roles & Permissions'];

const roleInclude = { permissions: { include: { permission: true } }, _count: { select: { users: true } } } as const;
type RoleRow = Awaited<ReturnType<typeof loadRole>>;
const loadRole = (id: string) => prisma.role.findUniqueOrThrow({ where: { id }, include: roleInclude });
const toDto = (r: NonNullable<RoleRow>) => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  isSystem: r.isSystem,
  isStaff: r.isStaff,
  userCount: r._count.users,
  permissions: r.permissions.map((p) => p.permission.key).sort(),
});

const validKeys = new Set<string>(PERMISSION_CATALOGUE.map((p) => p.key));
const permissionList = z
  .array(z.string())
  .max(100)
  .refine((keys) => keys.every((k) => validKeys.has(k)), 'Unknown permission key');

async function setPermissions(roleId: string, keys: string[]) {
  const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) }),
  ]);
}

defineRoute(router, M, {
  method: 'get',
  path: '/',
  tags,
  summary: 'List roles with their permissions',
  anyPermission: [PERMISSIONS.ROLE_MANAGE, PERMISSIONS.USER_MANAGE],
  handler: async () => {
    const roles = await prisma.role.findMany({ include: roleInclude, orderBy: { name: 'asc' } });
    return { data: roles.map(toDto) };
  },
});

defineRoute(router, M, {
  method: 'get',
  path: '/permissions',
  tags,
  summary: 'Permission catalogue',
  anyPermission: [PERMISSIONS.ROLE_MANAGE, PERMISSIONS.USER_MANAGE],
  handler: () => ({ data: PERMISSION_CATALOGUE }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/',
  tags,
  summary: 'Create a custom role',
  permissions: [PERMISSIONS.ROLE_MANAGE],
  body: z.object({
    key: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,40}$/, 'Use UPPER_SNAKE_CASE'),
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(300).optional(),
    isStaff: z.boolean().default(true),
    permissions: permissionList.default([]),
  }),
  responses: { 201: 'Created', 409: 'Key exists' },
  handler: async ({ req, res, body }) => {
    if (await prisma.role.findUnique({ where: { key: body.key } })) throw conflict('Role key already exists');
    const role = await prisma.role.create({
      data: { key: body.key, name: body.name, description: body.description, isStaff: body.isStaff },
    });
    await setPermissions(role.id, body.permissions);
    await audit({ req, action: 'role.create', entityType: 'Role', entityId: role.id, metadata: { permissions: body.permissions } });
    res.status(201);
    return { data: toDto(await loadRole(role.id)) };
  },
});

defineRoute(router, M, {
  method: 'patch',
  path: '/:id',
  tags,
  summary: 'Update a role and its permission set',
  permissions: [PERMISSIONS.ROLE_MANAGE],
  params: idParams,
  body: z.object({
    name: z.string().trim().min(2).max(60).optional(),
    description: z.string().trim().max(300).nullable().optional(),
    permissions: permissionList.optional(),
  }),
  handler: async ({ req, params, body }) => {
    const role = await prisma.role.findUnique({ where: { id: params.id } });
    if (!role) throw notFound('Role');
    if (body.permissions && role.key === ROLE_KEYS.SUPER_ADMIN) {
      const missing = SUPER_ADMIN_LOCKED.filter((k) => !body.permissions!.includes(k));
      if (missing.length) throw badRequest(`Super Admin must keep: ${missing.join(', ')}`);
    }
    await prisma.role.update({ where: { id: role.id }, data: { name: body.name, description: body.description } });
    if (body.permissions) await setPermissions(role.id, body.permissions);
    await audit({ req, action: 'role.update', entityType: 'Role', entityId: role.id, metadata: body });
    return { data: toDto(await loadRole(role.id)) };
  },
});

defineRoute(router, M, {
  method: 'delete',
  path: '/:id',
  tags,
  summary: 'Delete a custom role with no users',
  permissions: [PERMISSIONS.ROLE_MANAGE],
  params: idParams,
  handler: async ({ req, params }) => {
    const role = await prisma.role.findUnique({ where: { id: params.id }, include: { _count: { select: { users: true } } } });
    if (!role) throw notFound('Role');
    if (role.isSystem) throw badRequest('System roles cannot be deleted');
    if (role._count.users > 0) throw conflict('Reassign users before deleting this role');
    await prisma.role.delete({ where: { id: role.id } });
    await audit({ req, action: 'role.delete', entityType: 'Role', entityId: role.id, metadata: { key: role.key } });
    return { data: { deleted: true } };
  },
});

export default router;
