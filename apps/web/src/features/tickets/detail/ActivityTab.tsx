import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowRightLeft, CheckCircle2, Clock, FileText, Link2, Lock, MessageSquare, Paperclip, RotateCcw, Star, Tag, Timer, UserPlus } from 'lucide-react';
import { STATUS_LABEL } from '@/components/tickets/badges';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import type { HistoryEntry, TicketDetail, TicketStatus } from '@/lib/types';
import { formatDate, humanize, relative } from '@/lib/utils';

const st = (v: string | null) => (v && v in STATUS_LABEL ? STATUS_LABEL[v as TicketStatus] : (v ?? '—'));

export function describe(h: HistoryEntry): { icon: React.ElementType; text: string; tone?: string } {
  const auto = h.metadata && (h.metadata as { automatic?: boolean }).automatic;
  switch (h.action) {
    case 'CREATED':
      return { icon: FileText, text: 'created the ticket' };
    case 'STATUS_CHANGED':
      return { icon: ArrowRightLeft, text: `${auto ? 'automatically ' : ''}changed status from ${st(h.oldValue)} to ${st(h.newValue)}` };
    case 'PRIORITY_CHANGED':
      return { icon: AlertTriangle, text: `changed priority from ${humanize(h.oldValue ?? '')} to ${humanize(h.newValue ?? '')}` };
    case 'ASSIGNED':
      return { icon: UserPlus, text: h.newValue ? `assigned the ticket${h.oldValue ? ` (was ${h.oldValue})` : ''}${h.newValue.length < 40 && !/^[0-9a-f-]{36}$/.test(h.newValue) ? ` to ${h.newValue}` : ''}` : 'assigned the ticket' };
    case 'UNASSIGNED':
      return { icon: UserPlus, text: `unassigned ${h.oldValue ?? 'the agent'}` };
    case 'TEAM_CHANGED':
      return { icon: ArrowRightLeft, text: `moved the ticket from ${h.oldValue ?? 'no team'} to ${h.newValue ?? 'no team'}` };
    case 'ESCALATED':
      return { icon: AlertTriangle, text: `escalated to level ${h.newValue}${h.metadata && (h.metadata as { reason?: string }).reason ? ` — ${(h.metadata as { reason: string }).reason}` : ''}`, tone: 'text-destructive' };
    case 'REOPENED':
      return { icon: RotateCcw, text: `reopened the ticket (${st(h.oldValue)} → ${st(h.newValue)})` };
    case 'COMMENT_ADDED':
      return { icon: MessageSquare, text: 'posted a reply' };
    case 'INTERNAL_NOTE_ADDED':
      return { icon: Lock, text: 'added an internal note' };
    case 'ATTACHMENT_ADDED':
      return { icon: Paperclip, text: `attached ${h.newValue}` };
    case 'ATTACHMENT_REMOVED':
      return { icon: Paperclip, text: `removed attachment ${h.oldValue}` };
    case 'TIME_LOGGED':
      return { icon: Timer, text: `logged ${h.newValue} minutes` };
    case 'SLA_WARNING':
      return { icon: Clock, text: `SLA warning: ${h.field === 'firstResponse' ? 'first response' : 'resolution'} target approaching`, tone: 'text-warning' };
    case 'SLA_BREACHED':
      return { icon: AlertTriangle, text: `SLA breached: ${h.field === 'firstResponse' ? 'first response' : 'resolution'} target missed`, tone: 'text-destructive' };
    case 'FEEDBACK_SUBMITTED':
      return { icon: Star, text: `rated support ${h.newValue}/5` };
    case 'LINKED':
      return { icon: Link2, text: `linked related ticket ${h.newValue}` };
    case 'UNLINKED':
      return { icon: Link2, text: `removed link to ${h.oldValue}` };
    case 'UPDATED':
      if (h.field === 'tags') return { icon: Tag, text: `updated tags: ${h.newValue ?? 'none'}` };
      if (h.field === 'description') return { icon: FileText, text: 'edited the description' };
      if (h.field === 'resolutionNotes') return { icon: CheckCircle2, text: 'updated the resolution notes' };
      return { icon: FileText, text: `changed ${humanize(h.field ?? 'a field').toLowerCase()}${h.newValue && !/^[0-9a-f-]{36}$/.test(h.newValue) ? ` to “${h.newValue}”` : ''}` };
    default:
      return { icon: Activity, text: humanize(h.action).toLowerCase() };
  }
}

export function ActivityTab({ ticket }: { ticket: TicketDetail }) {
  const history = useQuery({
    queryKey: ['ticket', ticket.id, 'history'],
    queryFn: () => api.get<{ data: HistoryEntry[] }>(`/tickets/${ticket.id}/history`).then((r) => r.data),
  });
  if (history.isLoading) return <Skeleton className="h-64" />;
  if (history.isError) return <ErrorState error={history.error} onRetry={() => history.refetch()} />;
  if (!history.data!.length) return <EmptyState title="No activity yet" />;
  return (
    <Card className="p-4">
      <ol className="relative space-y-4 border-l pl-6" aria-label="Ticket history">
        {[...history.data!].reverse().map((h) => {
          const d = describe(h);
          return (
            <li key={h.id} className="relative">
              <span className="absolute -left-[33px] flex h-6 w-6 items-center justify-center rounded-full border bg-background">
                <d.icon className={`h-3.5 w-3.5 ${d.tone ?? 'text-muted-foreground'}`} aria-hidden />
              </span>
              <p className="text-sm">
                <span className="font-medium">{h.actor.name}</span> <span className={d.tone}>{d.text}</span>
                {h.isInternal && <Lock className="ml-1 inline h-3 w-3 text-muted-foreground" aria-label="internal" />}
              </p>
              <time className="text-xs text-muted-foreground" dateTime={h.createdAt} title={formatDate(h.createdAt)}>
                {formatDate(h.createdAt)} · {relative(h.createdAt)}
              </time>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
