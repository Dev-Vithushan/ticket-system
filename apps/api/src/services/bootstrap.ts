import type { TicketPriority } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_CATALOGUE, ROLE_KEYS } from '../modules/auth/permissions';

const SYSTEM_ROLES = [
  { key: ROLE_KEYS.SUPER_ADMIN, name: 'Super Admin', description: 'Full system administration', isStaff: true },
  { key: ROLE_KEYS.SUPPORT_MANAGER, name: 'Support Manager', description: 'Supervises teams, SLAs and assignments', isStaff: true },
  { key: ROLE_KEYS.SUPPORT_AGENT, name: 'Support Agent', description: 'Works on assigned and team tickets', isStaff: true },
  { key: ROLE_KEYS.CUSTOMER, name: 'Customer', description: 'Requester who raises and tracks own tickets', isStaff: false },
];

export const DEFAULT_SLA: { priority: TicketPriority; name: string; fr: number; res: number; biz: boolean }[] = [
  { priority: 'CRITICAL', name: 'Critical — 24×7', fr: 30, res: 4 * 60, biz: false },
  { priority: 'HIGH', name: 'High', fr: 2 * 60, res: 8 * 60, biz: true },
  { priority: 'MEDIUM', name: 'Medium', fr: 4 * 60, res: 3 * 8 * 60, biz: true },
  { priority: 'LOW', name: 'Low', fr: 8 * 60, res: 5 * 8 * 60, biz: true },
];

/**
 * Idempotently ensures the permission catalogue, system roles, default SLA policies and business hours exist.
 * Safe to run on every deploy: existing role customisations are preserved (only missing roles get defaults),
 * except Super Admin which always receives the full catalogue.
 */
export async function syncReferenceData() {
  for (const p of PERMISSION_CATALOGUE) {
    await prisma.permission.upsert({ where: { key: p.key }, create: p, update: { description: p.description, group: p.group } });
  }
  const perms = await prisma.permission.findMany();
  const idOf = new Map(perms.map((p) => [p.key, p.id]));
  for (const r of SYSTEM_ROLES) {
    const existing = await prisma.role.findUnique({ where: { key: r.key } });
    const role = existing ?? (await prisma.role.create({ data: { ...r, isSystem: true } }));
    if (!existing || r.key === ROLE_KEYS.SUPER_ADMIN) {
      await prisma.rolePermission.createMany({
        data: DEFAULT_ROLE_PERMISSIONS[r.key].map((k) => ({ roleId: role.id, permissionId: idOf.get(k)! })),
        skipDuplicates: true,
      });
    }
  }
  for (const s of DEFAULT_SLA) {
    await prisma.slaPolicy.upsert({
      where: { priority: s.priority },
      create: { priority: s.priority, name: s.name, firstResponseMinutes: s.fr, resolutionMinutes: s.res, useBusinessHours: s.biz },
      update: {},
    });
  }
  if ((await prisma.businessHours.count()) === 0) {
    await prisma.businessHours.createMany({
      data: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dayOfWeek: d, isWorkingDay: d <= 5, startMinute: 540, endMinute: 1020 })),
    });
  }
}
