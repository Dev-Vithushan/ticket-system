import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setSessionExpiredHandler } from '@/lib/api';
import type { Me } from '@/lib/types';

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  register: (input: { email: string; name: string; password: string; organization?: string }) => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ data: Me }>('/auth/me');
      setUser(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null);
      else throw err;
    }
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      qc.clear();
    });
  }, [qc]);

  const value = useMemo<AuthState>(() => {
    const perms = new Set(user?.permissions ?? []);
    return {
      user,
      loading,
      async login(email, password) {
        const res = await api.auth<{ data: Me }>('/auth/login', { email, password });
        qc.clear();
        setUser(res.data);
        return res.data;
      },
      async register(input) {
        const res = await api.auth<{ data: Me }>('/auth/register', input);
        qc.clear();
        setUser(res.data);
        return res.data;
      },
      async logout() {
        await api.auth('/auth/logout').catch(() => undefined);
        qc.clear();
        setUser(null);
      },
      refresh,
      can: (p) => perms.has(p),
      canAny: (...ps) => ps.some((p) => perms.has(p)),
    };
  }, [user, loading, qc, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const P = {
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
  TICKET_BULK_UPDATE: 'ticket.bulk_update',
  REPORT_VIEW: 'report.view',
} as const;
