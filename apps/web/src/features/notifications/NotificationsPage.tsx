import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, PageHeader, Pagination } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage, type Page } from '@/lib/api';
import type { Notification } from '@/lib/types';
import { cn, formatDate, humanize, relative } from '@/lib/utils';

export function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(false);
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['notifications', 'page', page, unread], queryFn: () => api.get<Page<Notification>>('/notifications', { page, pageSize: 25, unread: unread || undefined }), placeholderData: keepPreviousData });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const markAll = useMutation({ mutationFn: () => api.post<{ data: { updated: number } }>('/notifications/read-all'), onSuccess: (r) => { toast.success(`Marked ${r.data.updated} as read`); invalidate(); }, onError: (e) => toast.error(errorMessage(e)) });
  const open = async (n: Notification) => {
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    invalidate();
    if (n.ticket) navigate(`/tickets/${n.ticket.id}`);
  };
  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Assignments, replies, status changes, escalations and SLA alerts."
        actions={
          <>
            <div className="inline-flex rounded-md border p-0.5 text-sm" role="group" aria-label="Filter">
              {[false, true].map((u) => (
                <button key={String(u)} aria-pressed={unread === u} onClick={() => { setUnread(u); setPage(1); }} className={cn('rounded px-3 py-1 font-medium', unread === u ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
                  {u ? `Unread${list.data?.meta.unreadCount ? ` (${list.data.meta.unreadCount})` : ''}` : 'All'}
                </button>
              ))}
            </div>
            <Button variant="outline" disabled={!list.data?.meta.unreadCount} loading={markAll.isPending} onClick={() => markAll.mutate()}><CheckCheck /> Mark all read</Button>
          </>
        }
      />
      <Card>
        {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isLoading ? <div className="space-y-2 p-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div> : !list.data!.data.length ? (
          <EmptyState icon={Bell} title={unread ? 'No unread notifications' : 'No notifications yet'} />
        ) : (
          <>
            <ul className="divide-y">
              {list.data!.data.map((n) => (
                <li key={n.id}>
                  <button onClick={() => open(n)} className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40', !n.readAt && 'bg-primary/5')}>
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} aria-label={n.readAt ? undefined : 'Unread'} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{n.title}</span>
                        <span className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">{humanize(n.type)}</span>
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-sm text-muted-foreground">{n.body}</span>
                    </span>
                    <time className="shrink-0 text-xs text-muted-foreground" title={formatDate(n.createdAt)}>{relative(n.createdAt)}</time>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination {...list.data!.meta} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
