import { z } from 'zod';
import { prisma } from '../lib/prisma';

export const settingsSchema = z.object({
  organizationName: z.string().trim().min(1).max(120),
  timezone: z.string().refine((tz) => {
    try {
      Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown IANA time zone'),
  ticketNumberPrefix: z.string().trim().regex(/^[A-Z][A-Z0-9]{0,9}$/, 'Use 1–10 uppercase letters/digits'),
  ticketNumberPadding: z.number().int().min(3).max(10),
  ticketNumberIncludeYear: z.boolean(),
  allowSelfRegistration: z.boolean(),
  reopenWindowDays: z.number().int().min(0).max(365),
  autoCloseResolvedAfterDays: z.number().int().min(0).max(365), // 0 = never
  emailNotificationsEnabled: z.boolean(),
  allowedAttachmentTypes: z.array(z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/i)).min(1),
  maxAttachmentMb: z.number().min(0.1).max(100),
});

export type SystemSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: SystemSettings = {
  organizationName: 'Support Desk',
  timezone: 'UTC',
  ticketNumberPrefix: 'TKT',
  ticketNumberPadding: 5,
  ticketNumberIncludeYear: true,
  allowSelfRegistration: false,
  reopenWindowDays: 14,
  autoCloseResolvedAfterDays: 7,
  emailNotificationsEnabled: true,
  allowedAttachmentTypes: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  maxAttachmentMb: 10,
};

let cache: { value: SystemSettings; at: number } | null = null;
const TTL_MS = 10_000;

export async function getSettings(): Promise<SystemSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const rows = await prisma.systemSetting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) if (row.key in DEFAULT_SETTINGS) merged[row.key] = row.value;
  const parsed = settingsSchema.safeParse(merged);
  const value = parsed.success ? parsed.data : DEFAULT_SETTINGS;
  cache = { value, at: Date.now() };
  return value;
}

export async function updateSettings(patch: Partial<SystemSettings>, userId: string): Promise<SystemSettings> {
  await prisma.$transaction(
    Object.entries(patch).map(([key, value]) =>
      prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: value as never, updatedById: userId },
        update: { value: value as never, updatedById: userId },
      }),
    ),
  );
  invalidateSettingsCache();
  return getSettings();
}

export function invalidateSettingsCache() {
  cache = null;
}
