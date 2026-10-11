import { Router } from 'express';
import { badRequest, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { defineRoute } from '../../lib/route';
import { boolQuery, idParams, uuid, z } from '../../lib/zod';
import { audit } from '../../services/audit';
import { PERMISSIONS } from '../auth/permissions';

/** Departments, teams, team membership, categories and tags. Reads are open to staff; writes need org.manage. */
const router = Router();
const ORG = PERMISSIONS.ORG_MANAGE;
const STAFF_READ = [PERMISSIONS.USER_VIEW, PERMISSIONS.ORG_MANAGE];
const desc = z.string().trim().max(500).nullable().optional();

// ───────────── Departments ─────────────
defineRoute(router, '', {
  method: 'get',
  path: '/departments',
  tags: ['Departments'],
  summary: 'List departments',
  anyPermission: STAFF_READ,
  query: z.object({ includeInactive: boolQuery }),
  handler: async ({ query }) => ({
    data: await prisma.department.findMany({
      where: query.includeInactive ? {} : { isActive: true },
      include: { _count: { select: { teams: true, users: true } } },
      orderBy: { name: 'asc' },
    }),
  }),
});

const deptBody = z.object({ name: z.string().trim().min(2).max(100), description: desc, isActive: z.boolean().optional() });

defineRoute(router, '', {
  method: 'post',
  path: '/departments',
  tags: ['Departments'],
  summary: 'Create a department',
  permissions: [ORG],
  body: deptBody,
  responses: { 201: 'Created', 409: 'Name exists' },
  handler: async ({ req, res, body }) => {
    const d = await prisma.department.create({ data: body });
    await audit({ req, action: 'department.create', entityType: 'Department', entityId: d.id });
    res.status(201);
    return { data: d };
  },
});

defineRoute(router, '', {
  method: 'patch',
  path: '/departments/:id',
  tags: ['Departments'],
  summary: 'Update or (de)activate a department',
  permissions: [ORG],
  params: idParams,
  body: deptBody.partial(),
  handler: async ({ req, params, body }) => {
    const d = await prisma.department.update({ where: { id: params.id }, data: body });
    await audit({ req, action: 'department.update', entityType: 'Department', entityId: d.id, metadata: body });
    return { data: d };
  },
});

// ───────────── Teams ─────────────
const teamInclude = {
  department: { select: { id: true, name: true } },
  members: {
    include: { user: { select: { id: true, name: true, email: true, isActive: true, role: { select: { key: true, name: true } } } } },
    orderBy: { user: { name: 'asc' } },
  },
  _count: { select: { tickets: true } },
} as const;

defineRoute(router, '', {
  method: 'get',
  path: '/teams',
  tags: ['Teams'],
  summary: 'List teams with members',
  anyPermission: STAFF_READ,
  query: z.object({ includeInactive: boolQuery, departmentId: uuid.optional() }),
  handler: async ({ query }) => ({
    data: await prisma.team.findMany({
      where: { ...(query.includeInactive ? {} : { isActive: true }), ...(query.departmentId && { departmentId: query.departmentId }) },
      include: teamInclude,
      orderBy: { name: 'asc' },
    }),
  }),
});

defineRoute(router, '', {
  method: 'get',
  path: '/teams/:id',
  tags: ['Teams'],
  summary: 'Get a team',
  anyPermission: STAFF_READ,
  params: idParams,
  handler: async ({ params }) => {
    const team = await prisma.team.findUnique({ where: { id: params.id }, include: teamInclude });
    if (!team) throw notFound('Team');
    return { data: team };
  },
});

const teamBody = z.object({
  name: z.string().trim().min(2).max(100),
  description: desc,
  email: z.string().trim().email().nullable().optional(),
  departmentId: uuid,
  isActive: z.boolean().optional(),
});

defineRoute(router, '', {
  method: 'post',
  path: '/teams',
  tags: ['Teams'],
  summary: 'Create a team',
  permissions: [ORG],
  body: teamBody,
  responses: { 201: 'Created' },
  handler: async ({ req, res, body }) => {
    const t = await prisma.team.create({ data: body, include: teamInclude });
    await audit({ req, action: 'team.create', entityType: 'Team', entityId: t.id });
    res.status(201);
    return { data: t };
  },
});

defineRoute(router, '', {
  method: 'patch',
  path: '/teams/:id',
  tags: ['Teams'],
  summary: 'Update or (de)activate a team',
  permissions: [ORG],
  params: idParams,
  body: teamBody.partial(),
  handler: async ({ req, params, body }) => {
    const t = await prisma.team.update({ where: { id: params.id }, data: body, include: teamInclude });
    await audit({ req, action: 'team.update', entityType: 'Team', entityId: t.id, metadata: body });
    return { data: t };
  },
});

defineRoute(router, '', {
  method: 'put',
  path: '/teams/:id/members',
  tags: ['Teams'],
  summary: 'Replace team membership',
  permissions: [ORG],
  params: idParams,
  body: z.object({
    members: z.array(z.object({ userId: uuid, role: z.enum(['MEMBER', 'LEAD']).default('MEMBER') })).max(500),
  }),
  handler: async ({ req, params, body }) => {
    const users = await prisma.user.findMany({
      where: { id: { in: body.members.map((m) => m.userId) } },
      include: { role: true },
    });
    if (users.length !== new Set(body.members.map((m) => m.userId)).size) throw badRequest('Unknown user in member list');
    if (users.some((u) => !u.role.isStaff)) throw badRequest('Only staff users can be team members');
    await prisma.$transaction([
      prisma.teamMembership.deleteMany({ where: { teamId: params.id } }),
      prisma.teamMembership.createMany({ data: body.members.map((m) => ({ ...m, teamId: params.id })), skipDuplicates: true }),
    ]);
    await audit({ req, action: 'team.members_updated', entityType: 'Team', entityId: params.id, metadata: { count: body.members.length } });
    return { data: await prisma.team.findUniqueOrThrow({ where: { id: params.id }, include: teamInclude }) };
  },
});

// ───────────── Categories ─────────────
defineRoute(router, '', {
  method: 'get',
  path: '/categories',
  tags: ['Categories'],
  summary: 'List categories as a tree (top-level with subcategories)',
  description: 'Available to every authenticated user (needed to create tickets).',
  query: z.object({ includeInactive: boolQuery }),
  handler: async ({ query, auth }) => {
    const showInactive = query.includeInactive && auth.can(ORG);
    const active = showInactive ? {} : { isActive: true };
    return {
      data: await prisma.ticketCategory.findMany({
        where: { parentId: null, ...active },
        include: {
          children: { where: active, orderBy: { name: 'asc' } },
          defaultTeam: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      }),
    };
  },
});

const categoryBody = z.object({
  name: z.string().trim().min(2).max(100),
  description: desc,
  parentId: uuid.nullable().optional(),
  defaultTeamId: uuid.nullable().optional(),
  isActive: z.boolean().optional(),
});

defineRoute(router, '', {
  method: 'post',
  path: '/categories',
  tags: ['Categories'],
  summary: 'Create a category or subcategory',
  permissions: [ORG],
  body: categoryBody,
  responses: { 201: 'Created' },
  handler: async ({ req, res, body }) => {
    if (body.parentId) {
      const parent = await prisma.ticketCategory.findUnique({ where: { id: body.parentId } });
      if (!parent) throw badRequest('Parent category not found');
      if (parent.parentId) throw badRequest('Only two category levels are supported');
    }
    const c = await prisma.ticketCategory.create({ data: body });
    await audit({ req, action: 'category.create', entityType: 'TicketCategory', entityId: c.id });
    res.status(201);
    return { data: c };
  },
});

defineRoute(router, '', {
  method: 'patch',
  path: '/categories/:id',
  tags: ['Categories'],
  summary: 'Update or (de)activate a category',
  permissions: [ORG],
  params: idParams,
  body: categoryBody.omit({ parentId: true }).partial(),
  handler: async ({ req, params, body }) => {
    const c = await prisma.ticketCategory.update({ where: { id: params.id }, data: body });
    await audit({ req, action: 'category.update', entityType: 'TicketCategory', entityId: c.id, metadata: body });
    return { data: c };
  },
});

// ───────────── Tags ─────────────
defineRoute(router, '', {
  method: 'get',
  path: '/tags',
  tags: ['Tags'],
  summary: 'List tags',
  anyPermission: STAFF_READ,
  handler: async () => ({
    data: await prisma.tag.findMany({ include: { _count: { select: { tickets: true } } }, orderBy: { name: 'asc' } }),
  }),
});

const tagBody = z.object({
  name: z.string().trim().toLowerCase().min(1).max(40).regex(/^[a-z0-9][a-z0-9 _-]*$/, 'Letters, digits, space, - and _'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

defineRoute(router, '', {
  method: 'post',
  path: '/tags',
  tags: ['Tags'],
  summary: 'Create a tag',
  anyPermission: [ORG, PERMISSIONS.TICKET_UPDATE],
  body: tagBody,
  responses: { 201: 'Created' },
  handler: async ({ req, res, body }) => {
    const t = await prisma.tag.create({ data: body });
    await audit({ req, action: 'tag.create', entityType: 'Tag', entityId: t.id });
    res.status(201);
    return { data: t };
  },
});

defineRoute(router, '', {
  method: 'patch',
  path: '/tags/:id',
  tags: ['Tags'],
  summary: 'Rename or recolour a tag',
  permissions: [ORG],
  params: idParams,
  body: tagBody.partial(),
  handler: async ({ req, params, body }) => {
    const t = await prisma.tag.update({ where: { id: params.id }, data: body });
    await audit({ req, action: 'tag.update', entityType: 'Tag', entityId: t.id, metadata: body });
    return { data: t };
  },
});

defineRoute(router, '', {
  method: 'delete',
  path: '/tags/:id',
  tags: ['Tags'],
  summary: 'Delete a tag (removes it from tickets; history entries keep the name)',
  permissions: [ORG],
  params: idParams,
  handler: async ({ req, params }) => {
    const t = await prisma.tag.delete({ where: { id: params.id } });
    await audit({ req, action: 'tag.delete', entityType: 'Tag', entityId: t.id, metadata: { name: t.name } });
    return { data: { deleted: true } };
  },
});

export default router;
