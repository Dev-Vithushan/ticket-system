import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface PublicSettings {
  organizationName: string;
  timezone: string;
  reopenWindowDays: number;
  maxAttachmentMb: number;
  allowedAttachmentTypes: string[];
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ data: PublicSettings }>('/settings').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}
