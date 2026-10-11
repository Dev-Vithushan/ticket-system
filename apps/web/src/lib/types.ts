export type TicketStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'PENDING_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TicketSource = 'WEB' | 'EMAIL' | 'PHONE' | 'INTERNAL';
export type SlaState = 'none' | 'on_track' | 'warning' | 'breached' | 'met' | 'paused';

export const STATUSES: TicketStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED'];
export const PRIORITIES: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const SOURCES: TicketSource[] = ['WEB', 'EMAIL', 'PHONE', 'INTERNAL'];

export interface UserRef {
  id: string;
  name: string;
  email?: string;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  jobTitle: string | null;
  phone: string | null;
  organization: string | null;
  emailNotifications: boolean;
  lastLoginAt: string | null;
  role: { id: string; key: string; name: string; isStaff: boolean };
  permissions: string[];
  department: { id: string; name: string } | null;
  teams: { id: string; name: string; role: 'MEMBER' | 'LEAD' }[];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface SlaTarget {
  dueAt: string | null;
  completedAt: string | null;
  state: SlaState;
  percentElapsed: number | null;
}

export interface TicketListItem {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  requester: UserRef;
  assignee: UserRef | null;
  team: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  subcategory: { id: string; name: string } | null;
  tags: Tag[];
  dueAt: string | null;
  escalationLevel: number;
  commentCount: number;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
  sla: { firstResponse: SlaTarget; resolution: SlaTarget };
}

export interface TicketCapabilities {
  canEdit: boolean;
  canAssign: boolean;
  canAccept: boolean;
  canChangeStatus: boolean;
  allowedTransitions: TicketStatus[];
  canChangePriority: boolean;
  canEscalate: boolean;
  canReopen: boolean;
  canReply: boolean;
  canAddInternalNote: boolean;
  canLogTime: boolean;
  canAttach: boolean;
  canRate: boolean;
  canLink: boolean;
}

export interface TicketDetail extends Omit<TicketListItem, 'sla' | 'commentCount' | 'attachmentCount' | 'requester' | 'team'> {
  description: string;
  requester: UserRef & { phone: string | null; organization: string | null; createdAt: string };
  createdBy: UserRef;
  team: { id: string; name: string; department: { id: string; name: string } } | null;
  resolutionNotes: string | null;
  escalatedAt: string | null;
  reopenCount: number;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  sla: {
    policy: { name: string; firstResponseMinutes: number; resolutionMinutes: number; useBusinessHours: boolean; warningThresholdPercent: number } | null;
    firstResponse: SlaTarget;
    resolution: SlaTarget;
    pausedAt: string | null;
  };
  feedback: { rating: number; comment: string | null; createdAt: string } | null;
  related: { id: string; number: string; subject: string; status: TicketStatus }[];
  counts: { comments: number; attachments: number };
  timeSpentMinutes?: number;
  capabilities: TicketCapabilities;
}

export interface Attachment {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  isInternal: boolean;
  createdAt: string;
  commentId: string | null;
  uploadedBy: UserRef;
}

export interface Comment {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: { id: string; name: string; isStaff: boolean; roleName: string };
  attachments: Attachment[];
}

export interface HistoryEntry {
  id: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  isInternal: boolean;
  metadata: Record<string, unknown> | null;
  actor: { id: string | null; name: string };
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  parentId: string | null;
  defaultTeamId: string | null;
  children: Omit<Category, 'children' | 'defaultTeam'>[];
  defaultTeam: { id: string; name: string } | null;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  email: string | null;
  isActive: boolean;
  departmentId: string;
  department: { id: string; name: string };
  members: { userId: string; role: 'MEMBER' | 'LEAD'; user: { id: string; name: string; email: string; isActive: boolean; role: { key: string; name: string } } }[];
  _count: { tickets: number };
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  _count: { teams: number; users: number };
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  jobTitle: string | null;
  phone: string | null;
  organization: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  role: { id: string; key: string; name: string; isStaff: boolean };
  department: { id: string; name: string } | null;
  teams: { id: string; name: string; role: 'MEMBER' | 'LEAD' }[];
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isStaff: boolean;
  userCount: number;
  permissions: string[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  ticket: { id: string; number: string } | null;
}

export interface Summary {
  total: number;
  open: number;
  assigned: number;
  inProgress: number;
  pending: number;
  escalated: number;
  resolved: number;
  closed: number;
  overdue: number;
  slaMet: number;
  slaBreached: number;
  slaCompliancePercent: number | null;
  reopened: number;
  reopenRatePercent: number | null;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  csatAverage: number | null;
  csatResponses: number;
}

export interface SlaPolicy {
  id: string;
  name: string;
  priority: TicketPriority;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  useBusinessHours: boolean;
  warningThresholdPercent: number;
  escalateOnBreach: boolean;
  isActive: boolean;
}
