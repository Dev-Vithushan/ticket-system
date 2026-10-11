import { Router } from 'express';
import { passwordSchema } from '../../lib/password';
import { defineRoute } from '../../lib/route';
import { boolQuery, csvEnum, idParams, pagination, uuid, z } from '../../lib/zod';
import { sensitiveLimiter } from '../../middleware/rateLimit';
import { PERMISSIONS } from '../auth/permissions';
import * as svc from './users.service';

const router = Router();
const M = '/users';
const tags = ['Users'];

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

defineRoute(router, M, {
  method: 'get',
  path: '/',
  tags,
  summary: 'List users (search, filter, paginate)',
  anyPermission: [PERMISSIONS.USER_VIEW, PERMISSIONS.USER_MANAGE],
  query: z.object({
    ...pagination,
    search: z.string().trim().max(100).optional(),
    roleKey: csvEnum(['SUPER_ADMIN', 'SUPPORT_MANAGER', 'SUPPORT_AGENT', 'CUSTOMER']),
    isActive: boolQuery,
    isStaff: boolQuery,
    teamId: uuid.optional(),
    departmentId: uuid.optional(),
    sort: z.enum(['name', 'email', 'createdAt', 'lastLoginAt']).default('name'),
    order: z.enum(['asc', 'desc']).default('asc'),
  }),
  handler: ({ query }) => svc.listUsers(query),
});

defineRoute(router, M, {
  method: 'get',
  path: '/:id',
  tags,
  summary: 'Get a user',
  anyPermission: [PERMISSIONS.USER_VIEW, PERMISSIONS.USER_MANAGE],
  params: idParams,
  handler: async ({ params }) => ({ data: await svc.getUser(params.id) }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/',
  tags,
  summary: 'Create a user',
  permissions: [PERMISSIONS.USER_MANAGE],
  middleware: [sensitiveLimiter],
  body: z.object({
    email: z.string().trim().email().max(254),
    name: z.string().trim().min(2).max(120),
    password: passwordSchema,
    roleId: uuid,
    departmentId: uuid.nullable().optional(),
    jobTitle: optionalText(120),
    phone: optionalText(40),
    organization: optionalText(120),
    teamIds: z.array(uuid).max(50).optional(),
  }),
  responses: { 201: 'Created', 409: 'Email already exists' },
  handler: async ({ req, res, body }) => {
    res.status(201);
    return { data: await svc.createUser(body, req) };
  },
});

defineRoute(router, M, {
  method: 'patch',
  path: '/:id',
  tags,
  summary: 'Update a user (profile, role, department, teams)',
  permissions: [PERMISSIONS.USER_MANAGE],
  params: idParams,
  body: z.object({
    email: z.string().trim().email().max(254).optional(),
    name: z.string().trim().min(2).max(120).optional(),
    roleId: uuid.optional(),
    departmentId: uuid.nullable().optional(),
    jobTitle: optionalText(120),
    phone: optionalText(40),
    organization: optionalText(120),
    teamIds: z.array(uuid).max(50).optional(),
  }),
  handler: async ({ req, params, body, auth }) => ({ data: await svc.updateUser(params.id, body, req, auth) }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/deactivate',
  tags,
  summary: 'Deactivate a user (history is preserved; sessions revoked)',
  permissions: [PERMISSIONS.USER_MANAGE],
  params: idParams,
  handler: async ({ req, params, auth }) => ({ data: await svc.setUserActive(params.id, false, req, auth) }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/activate',
  tags,
  summary: 'Reactivate a user',
  permissions: [PERMISSIONS.USER_MANAGE],
  params: idParams,
  handler: async ({ req, params, auth }) => ({ data: await svc.setUserActive(params.id, true, req, auth) }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/reset-password',
  tags,
  summary: "Set a new password for a user (revokes the user's sessions)",
  permissions: [PERMISSIONS.USER_MANAGE],
  middleware: [sensitiveLimiter],
  params: idParams,
  body: z.object({ password: passwordSchema }),
  handler: async ({ req, params, body }) => {
    await svc.resetPassword(params.id, body.password, req);
    return { data: { reset: true } };
  },
});

export default router;
