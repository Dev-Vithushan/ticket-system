import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { pageMeta } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { defineRoute } from '../../lib/route';
import { pagination, uuid, z } from '../../lib/zod';
import { PERMISSIONS } from '../auth/permissions';

const router = Router();

defineRoute(router, '/audit-logs', {
  method: 'get',
  path: '/',
  tags: ['Audit'],
  summary: 'System audit log (security and administrative actions)',
  permissions: [PERMISSIONS.AUDIT_VIEW],
  query: z.object({
    ...pagination,
    action: z.string().trim().max(60).optional(),
    entityType: z.string().trim().max(60).optional(),
    actorId: uuid.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }),
  handler: async ({ query }) => {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action && { action: { contains: query.action, mode: 'insensitive' } }),
      ...(query.entityType && { entityType: query.entityType }),
      ...(query.actorId && { actorId: query.actorId }),
      ...((query.from || query.to) && { createdAt: { ...(query.from && { gte: query.from }), ...(query.to && { lte: query.to }) } }),
    };
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { data: rows, meta: pageMeta(query.page, query.pageSize, total) };
  },
});

export default router;
