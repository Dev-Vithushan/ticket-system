/**
 * Canonical permission catalogue. Roles are stored in the database and map to these keys,
 * so Super Admins can tailor roles at runtime; the backend always checks keys, never role names.
 */
export const PERMISSIONS = {
  USER_VIEW: 'user.view',
  USER_MANAGE: 'user.manage',
  ROLE_MANAGE: 'role.manage',
  ORG_MANAGE: 'org.manage',
  SLA_MANAGE: 'sla.manage',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_VIEW: 'audit.view',
  TICKET_VIEW_ALL: 'ticket.view_all',
  TICKET_VIEW_TEAM: 'ticket.view_team',
  TICKET_CREATE: 'ticket.create',
  TICKET_CREATE_ON_BEHALF: 'ticket.create_on_behalf',
  TICKET_UPDATE: 'ticket.update',
  TICKET_ASSIGN: 'ticket.assign',
  TICKET_ACCEPT: 'ticket.accept',
  TICKET_CHANGE_STATUS: 'ticket.change_status',
  TICKET_CHANGE_PRIORITY: 'ticket.change_priority',
  TICKET_ESCALATE: 'ticket.escalate',
  TICKET_BULK_UPDATE: 'ticket.bulk_update',
  TICKET_INTERNAL_NOTES: 'ticket.internal_notes',
  TICKET_LOG_TIME: 'ticket.log_time',
  TICKET_REOPEN_ANY: 'ticket.reopen_any',
  REPORT_VIEW: 'report.view',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_CATALOGUE: { key: PermissionKey; group: string; description: string }[] = [
  { key: PERMISSIONS.USER_VIEW, group: 'Users', description: 'View staff directory (for assignment)' },
  { key: PERMISSIONS.USER_MANAGE, group: 'Users', description: 'Create, update and deactivate users' },
  { key: PERMISSIONS.ROLE_MANAGE, group: 'Users', description: 'Manage roles and their permissions' },
  { key: PERMISSIONS.ORG_MANAGE, group: 'Organisation', description: 'Manage departments, teams, categories and tags' },
  { key: PERMISSIONS.SLA_MANAGE, group: 'Organisation', description: 'Configure SLA policies, business hours and holidays' },
  { key: PERMISSIONS.SETTINGS_MANAGE, group: 'System', description: 'Configure system settings' },
  { key: PERMISSIONS.AUDIT_VIEW, group: 'System', description: 'View the system audit log' },
  { key: PERMISSIONS.TICKET_VIEW_ALL, group: 'Tickets', description: 'View every ticket in the system' },
  { key: PERMISSIONS.TICKET_VIEW_TEAM, group: 'Tickets', description: "View tickets of the user's teams and assigned tickets" },
  { key: PERMISSIONS.TICKET_CREATE, group: 'Tickets', description: 'Create tickets' },
  { key: PERMISSIONS.TICKET_CREATE_ON_BEHALF, group: 'Tickets', description: 'Create tickets on behalf of a requester' },
  { key: PERMISSIONS.TICKET_UPDATE, group: 'Tickets', description: 'Edit ticket fields, category, tags and resolution' },
  { key: PERMISSIONS.TICKET_ASSIGN, group: 'Tickets', description: 'Assign tickets to any agent or team' },
  { key: PERMISSIONS.TICKET_ACCEPT, group: 'Tickets', description: 'Accept (self-assign) tickets' },
  { key: PERMISSIONS.TICKET_CHANGE_STATUS, group: 'Tickets', description: 'Change ticket status' },
  { key: PERMISSIONS.TICKET_CHANGE_PRIORITY, group: 'Tickets', description: 'Change ticket priority' },
  { key: PERMISSIONS.TICKET_ESCALATE, group: 'Tickets', description: 'Escalate tickets' },
  { key: PERMISSIONS.TICKET_BULK_UPDATE, group: 'Tickets', description: 'Bulk assign and bulk status updates' },
  { key: PERMISSIONS.TICKET_INTERNAL_NOTES, group: 'Tickets', description: 'Read and write internal notes' },
  { key: PERMISSIONS.TICKET_LOG_TIME, group: 'Tickets', description: 'Log time spent on tickets' },
  { key: PERMISSIONS.TICKET_REOPEN_ANY, group: 'Tickets', description: 'Reopen resolved or closed tickets' },
  { key: PERMISSIONS.REPORT_VIEW, group: 'Reports', description: 'View dashboards, reports and exports' },
];

export const ROLE_KEYS = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  SUPPORT_MANAGER: 'SUPPORT_MANAGER',
  SUPPORT_AGENT: 'SUPPORT_AGENT',
  CUSTOMER: 'CUSTOMER',
} as const;

const P = PERMISSIONS;
export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  SUPER_ADMIN: PERMISSION_CATALOGUE.map((p) => p.key),
  SUPPORT_MANAGER: [
    P.USER_VIEW, P.TICKET_VIEW_TEAM, P.TICKET_CREATE, P.TICKET_CREATE_ON_BEHALF, P.TICKET_UPDATE, P.TICKET_ASSIGN,
    P.TICKET_ACCEPT, P.TICKET_CHANGE_STATUS, P.TICKET_CHANGE_PRIORITY, P.TICKET_ESCALATE, P.TICKET_BULK_UPDATE,
    P.TICKET_INTERNAL_NOTES, P.TICKET_LOG_TIME, P.TICKET_REOPEN_ANY, P.REPORT_VIEW,
  ],
  SUPPORT_AGENT: [
    P.USER_VIEW, P.TICKET_VIEW_TEAM, P.TICKET_CREATE, P.TICKET_CREATE_ON_BEHALF, P.TICKET_UPDATE, P.TICKET_ACCEPT,
    P.TICKET_CHANGE_STATUS, P.TICKET_INTERNAL_NOTES, P.TICKET_LOG_TIME, P.REPORT_VIEW,
  ],
  CUSTOMER: [P.TICKET_CREATE],
};

/** Permissions the Super Admin role must always keep, to avoid locking everyone out. */
export const SUPER_ADMIN_LOCKED: PermissionKey[] = [P.USER_MANAGE, P.ROLE_MANAGE, P.SETTINGS_MANAGE];
