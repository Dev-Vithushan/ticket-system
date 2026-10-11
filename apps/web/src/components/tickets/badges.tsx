import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronsUp, Clock, Minus, PauseCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import type { SlaTarget, TicketPriority, TicketStatus } from '@/lib/types';
import { cn, formatDate, humanize, relative } from '@/lib/utils';

const STATUS_STYLE: Record<TicketStatus, string> = {
  OPEN: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  ASSIGNED: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  IN_PROGRESS: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  PENDING_CUSTOMER: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  ESCALATED: 'bg-red-500/10 text-red-700 dark:text-red-300',
  RESOLVED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  CLOSED: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
};

export const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  PENDING_CUSTOMER: 'Pending customer',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export function StatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn('border-transparent', STATUS_STYLE[status], className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

const PRIORITY: Record<TicketPriority, { icon: React.ElementType; cls: string }> = {
  LOW: { icon: ArrowDown, cls: 'text-slate-600 dark:text-slate-300' },
  MEDIUM: { icon: Minus, cls: 'text-blue-700 dark:text-blue-300' },
  HIGH: { icon: ArrowUp, cls: 'text-orange-700 dark:text-orange-300' },
  CRITICAL: { icon: ChevronsUp, cls: 'text-red-700 dark:text-red-300 font-semibold' },
};

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const { icon: Icon, cls } = PRIORITY[priority];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', cls)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {humanize(priority)}
    </span>
  );
}

/** Compact SLA indicator for the nearest outstanding target. */
export function SlaBadge({ sla, compact }: { sla: { firstResponse: SlaTarget; resolution: SlaTarget }; compact?: boolean }) {
  const target = sla.firstResponse.state !== 'met' && sla.firstResponse.state !== 'none' ? { ...sla.firstResponse, kind: 'First response' } : { ...sla.resolution, kind: 'Resolution' };
  if (target.state === 'none') return <span className="text-xs text-muted-foreground">—</span>;
  const map = {
    on_track: { icon: Clock, variant: 'secondary' as const, label: `Due ${relative(target.dueAt)}` },
    warning: { icon: AlertTriangle, variant: 'warning' as const, label: `At risk · ${relative(target.dueAt)}` },
    breached: { icon: AlertTriangle, variant: 'destructive' as const, label: 'SLA breached' },
    met: { icon: CheckCircle2, variant: 'success' as const, label: 'SLA met' },
    paused: { icon: PauseCircle, variant: 'secondary' as const, label: 'SLA paused' },
    none: { icon: Clock, variant: 'secondary' as const, label: '—' },
  }[target.state];
  return (
    <Tooltip content={`${target.kind} target: ${formatDate(target.dueAt)}`}>
      <Badge variant={map.variant} className="cursor-default">
        <map.icon className="h-3 w-3" aria-hidden />
        {compact && target.state === 'on_track' ? relative(target.dueAt).replace('in ', '') : map.label}
      </Badge>
    </Tooltip>
  );
}
