import { Router } from 'express';
import { notFound } from '../../lib/errors';
import { pageMeta } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { defineRoute } from '../../lib/route';
import { boolQuery, idParams, pagination, z } from '../../lib/zod';

const router = Router();
const M = '/notifications';
const tags = ['Notifications'];

defineRoute(router, M, {
  method: 'get',
  path: '/',
  tags,
  summary: 'List own notifications',
  query: z.object({ ...pagination, unread: boolQuery }),
  handler: async ({ query, auth }) => {
    const where = { userId: auth.user.id, ...(query.unread && { readAt: null }) };
    const [total, unreadCount, rows] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: auth.user.id, readAt: null } }),
      prisma.notification.findMany({
        where,
        include: { ticket: { select: { id: true, number: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { data: rows, meta: { ...pageMeta(query.page, query.pageSize, total), unreadCount } };
  },
});

defineRoute(router, M, {
  method: 'get',
  path: '/unread-count',
  tags,
  summary: 'Unread notification count',
  handler: async ({ auth }) => ({
    data: { count: await prisma.notification.count({ where: { userId: auth.user.id, readAt: null } }) },
  }),
});

defineRoute(router, M, {
  method: 'post',
  path: '/:id/read',
  tags,
  summary: 'Mark one notification as read',
  params: idParams,
  handler: async ({ params, auth }) => {
    const res = await prisma.notification.updateMany({
      where: { id: params.id, userId: auth.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (!res.count && !(await prisma.notification.findFirst({ where: { id: params.id, userId: auth.user.id } }))) throw notFound('Notification');
    return { data: { read: true } };
  },
});

defineRoute(router, M, {
  method: 'post',
  path: '/read-all',
  tags,
  summary: 'Mark all notifications as read',
  handler: async ({ auth }) => {
    const res = await prisma.notification.updateMany({ where: { userId: auth.user.id, readAt: null }, data: { readAt: new Date() } });
    return { data: { updated: res.count } };
  },
});

export default router;
