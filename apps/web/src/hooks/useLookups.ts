import { useQuery } from '@tanstack/react-query';
import { api, type Page } from '@/lib/api';
import type { Category, Department, SlaPolicy, Tag, Team, UserRow } from '@/lib/types';
import { P, useAuth } from './useAuth';

/** Shared reference-data queries (cached across pages). */
export function useCategories(includeInactive = false) {
  return useQuery({
    queryKey: ['categories', includeInactive],
    queryFn: () => api.get<{ data: Category[] }>('/categories', { includeInactive }).then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

export function useTeams(includeInactive = false) {
  const { canAny } = useAuth();
  return useQuery({
    queryKey: ['teams', includeInactive],
    queryFn: () => api.get<{ data: Team[] }>('/teams', { includeInactive }).then((r) => r.data),
    enabled: canAny(P.USER_VIEW, P.ORG_MANAGE),
    staleTime: 60_000,
  });
}

export function useDepartments(includeInactive = false) {
  const { canAny } = useAuth();
  return useQuery({
    queryKey: ['departments', includeInactive],
    queryFn: () => api.get<{ data: Department[] }>('/departments', { includeInactive }).then((r) => r.data),
    enabled: canAny(P.USER_VIEW, P.ORG_MANAGE),
    staleTime: 60_000,
  });
}

export function useTags() {
  const { canAny } = useAuth();
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get<{ data: (Tag & { _count: { tickets: number } })[] }>('/tags').then((r) => r.data),
    enabled: canAny(P.USER_VIEW, P.ORG_MANAGE),
    staleTime: 60_000,
  });
}

export function useStaff(search = '') {
  const { canAny } = useAuth();
  return useQuery({
    queryKey: ['staff', search],
    queryFn: () => api.get<Page<UserRow>>('/users', { isStaff: true, isActive: true, pageSize: 100, search }).then((r) => r.data),
    enabled: canAny(P.USER_VIEW, P.USER_MANAGE),
    staleTime: 60_000,
  });
}

export function useSlaPolicies() {
  return useQuery({
    queryKey: ['sla-policies'],
    queryFn: () => api.get<{ data: SlaPolicy[] }>('/sla/policies').then((r) => r.data),
    staleTime: 60_000,
  });
}
