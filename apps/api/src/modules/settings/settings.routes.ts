import { Router } from 'express';
import { defineRoute } from '../../lib/route';
import { audit } from '../../services/audit';
import { getSettings, settingsSchema, updateSettings } from '../../services/settings';
import { PERMISSIONS } from '../auth/permissions';
import { invalidateCalendarCache } from '../sla/sla.service';
import { config } from '../../config/env';

const router = Router();
const M = '/settings';
const tags = ['Settings'];

defineRoute(router, M, {
  method: 'get',
  path: '/',
  tags,
  summary: 'Get system settings',
  handler: async ({ auth }) => {
    const s = await getSettings();
    if (auth.can(PERMISSIONS.SETTINGS_MANAGE)) {
      return { data: { ...s, emailDelivery: { configured: Boolean(config.SMTP_HOST) }, storageDriver: config.STORAGE_DRIVER, serverMaxUploadMb: config.MAX_UPLOAD_MB } };
    }
    // Non-admins only receive what the UI needs
    return {
      data: {
        organizationName: s.organizationName,
        timezone: s.timezone,
        reopenWindowDays: s.reopenWindowDays,
        maxAttachmentMb: Math.min(s.maxAttachmentMb, config.MAX_UPLOAD_MB),
        allowedAttachmentTypes: s.allowedAttachmentTypes,
      },
    };
  },
});

defineRoute(router, M, {
  method: 'patch',
  path: '/',
  tags,
  summary: 'Update system settings',
  permissions: [PERMISSIONS.SETTINGS_MANAGE],
  body: settingsSchema.partial(),
  handler: async ({ req, body, auth }) => {
    const updated = await updateSettings(body, auth.user.id);
    if (body.timezone) invalidateCalendarCache();
    await audit({ req, action: 'settings.update', entityType: 'SystemSetting', metadata: body });
    return { data: updated };
  },
});

export default router;
