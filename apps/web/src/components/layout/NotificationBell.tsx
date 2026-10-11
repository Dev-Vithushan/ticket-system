import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { api, type Page } from '@/lib/api';
import type { Notification } from '@/lib/types';
import { cn, relative } from '@/lib/utils';

export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const count = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ data: { count: number } }>('/notifications/unread-count').then((r) => r.data.count),
    refetchInterval: 30_000,
  });
  const list = useQuery({
    queryKey: ['notifications', 'latest'],
    queryFn: () => api.get<Page<Notification>>('/notifications', { pageSize: 8 }),
    enabled: open,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = count.data ?? 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-[22rem] max-w-[calc(100vw-1rem)] rounded-lg border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            <Button variant="ghost" size="sm" disabled={!unread} onClick={() => markAll.mutate()}>
              <CheckCheck /> Mark all read
            </Button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {list.isLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
            {list.data?.data.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">You’re all caught up.</p>}
            {list.data?.data.map((n) => (
              <button
                key={n.id}
                className={cn('flex w-full gap-3 border-b px-3 py-2.5 text-left last:border-0 hover:bg-accent', !n.readAt && 'bg-primary/5')}
                onClick={() => {
                  if (!n.readAt) markRead.mutate(n.id);
                  setOpen(false);
                  if (n.ticket) navigate(`/tickets/${n.ticket.id}`);
                }}
              >
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{n.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{n.body}</span>
                  <span className="block text-xs text-muted-foreground">{relative(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="border-t p-2 text-center">
            <Link to="/notifications" onClick={() => setOpen(false)} className="text-sm font-medium text-primary hover:underline">
              View all notifications
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
