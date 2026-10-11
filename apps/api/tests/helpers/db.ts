import { prisma } from '../../src/lib/prisma';
import { syncReferenceData } from '../../src/services/bootstrap';
import { invalidateSettingsCache } from '../../src/services/settings';
import { invalidateCalendarCache } from '../../src/modules/sla/sla.service';

/** Empties every table and restores reference data (roles, permissions, SLA policies, hours). */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  invalidateSettingsCache();
  invalidateCalendarCache();
  await syncReferenceData();
}
