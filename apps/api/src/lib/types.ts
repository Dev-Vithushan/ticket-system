import type { PermissionKey } from '../modules/auth/permissions';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roleKey: string;
  roleName: string;
  isStaff: boolean;
}

export interface AuthContext {
  user: AuthUser;
  permissions: Set<string>;
  /** Teams the user belongs to (any membership role). */
  teamIds: string[];
  /** Teams the user leads. */
  leadTeamIds: string[];
  can(permission: PermissionKey): boolean;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
