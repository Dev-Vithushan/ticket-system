import { useMutation } from '@tanstack/react-query';
import { Building2, Mail, Phone } from 'lucide-react';
import { SlaBadge } from '@/components/tickets/badges';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { Avatar } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { useStaff, useTeams } from '@/hooks/useLookups';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { PRIORITIES, type SlaTarget, type TicketDetail, type TicketPriority } from '@/lib/types';
import { cn, formatDate, formatDuration, formatTarget, humanize, relative } from '@/lib/utils';
import { useTicketMutation } from '../TicketDetailPage';

export function TicketSidebar({ ticket: t }: { ticket: TicketDetail }) {
  const { user } = useAuth();
  const caps = t.capabilities;
  const staff = user?.role.isStaff;
  const teams = useTeams();
  const agents = useStaff();
  const opts = useTicketMutation(t.id);
  const assign = useMutation({ mutationFn: (body: { assigneeId?: string | null; teamId?: string | null }) => api.post<{ data: TicketDetail }>(`/tickets/${t.id}/assign`, body), ...opts('Assignment updated') });
  const priority = useMutation({ mutationFn: (p: TicketPriority) => api.post<{ data: TicketDetail }>(`/tickets/${t.id}/priority`, { priority: p }), ...opts('Priority updated') });
  const teamAgents = (agents.data ?? []).filter((a) => !t.team || a.teams.some((x) => x.id === t.team!.id));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Requester</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Avatar name={t.requester.name} />
            <div className="min-w-0">
              <p className="truncate font-medium">{t.requester.name}</p>
              {t.requester.organization && (
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  <Building2 className="h-3 w-3" /> {t.requester.organization}
                </p>
              )}
            </div>
          </div>
          {t.requester.email && (
            <a href={`mailto:${t.requester.email}`} className="flex items-center gap-2 truncate text-primary hover:underline">
              <Mail className="h-3.5 w-3.5 shrink-0" /> {t.requester.email}
            </a>
          )}
          {t.requester.phone && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-3.5 w-3.5" /> {t.requester.phone}
            </p>
          )}
          {t.createdBy.id !== t.requester.id && <p className="text-xs text-muted-foreground">Logged by {t.createdBy.name}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assignment & priority</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="side-team">Team</Label>
            {caps.canAssign ? (
              <Combobox id="side-team" value={t.team?.id ?? null} onChange={(v) => assign.mutate({ teamId: v })} placeholder="No team" options={(teams.data ?? []).map((x) => ({ value: x.id, label: x.name, description: x.department.name }))} />
            ) : (
              <p>{t.team?.name ?? '—'}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="side-assignee">Assignee</Label>
            {caps.canAssign ? (
              <Combobox
                id="side-assignee"
                value={t.assignee?.id ?? null}
                onChange={(v) => assign.mutate({ assigneeId: v })}
                placeholder="Unassigned"
                selectedLabel={t.assignee?.name}
                options={teamAgents.map((a) => ({ value: a.id, label: a.name, description: a.teams.map((x) => x.name).join(', ') }))}
                emptyText={t.team ? 'No agents in this team' : 'No agents'}
              />
            ) : (
              <p>{t.assignee?.name ?? <span className="text-muted-foreground">Unassigned</span>}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="side-priority">Priority</Label>
            {caps.canChangePriority ? (
              <Select id="side-priority" value={t.priority} onValueChange={(v) => v && v !== t.priority && priority.mutate(v as TicketPriority)} options={PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />
            ) : (
              <p>{humanize(t.priority)}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <SlaCard t={t} />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Category</dt>
            <dd>{t.category ? `${t.category.name}${t.subcategory ? ` › ${t.subcategory.name}` : ''}` : '—'}</dd>
            <dt className="text-muted-foreground">Source</dt>
            <dd>{humanize(t.source)}</dd>
            {t.team && (
              <>
                <dt className="text-muted-foreground">Department</dt>
                <dd>{t.team.department.name}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDate(t.createdAt)}</dd>
            <dt className="text-muted-foreground">Updated</dt>
            <dd>{formatDate(t.updatedAt)}</dd>
            {t.dueAt && (
              <>
                <dt className="text-muted-foreground">Due</dt>
                <dd className={cn(new Date(t.dueAt) < new Date() && !['RESOLVED', 'CLOSED'].includes(t.status) && 'font-medium text-destructive')}>{formatDate(t.dueAt)}</dd>
              </>
            )}
            {staff && t.timeSpentMinutes !== undefined && (
              <>
                <dt className="text-muted-foreground">Time spent</dt>
                <dd>{formatDuration(t.timeSpentMinutes)}</dd>
              </>
            )}
            {t.tags.length > 0 && (
              <>
                <dt className="text-muted-foreground">Tags</dt>
                <dd className="flex flex-wrap gap-1">
                  {t.tags.map((tag) => (
                    <span key={tag.id} className="rounded px-1.5 py-0.5 text-xs font-medium" style={{ backgroundColor: `${tag.color}22`, color: tag.color }}>
                      {tag.name}
                    </span>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function SlaRow({ label, target, createdAt }: { label: string; target: SlaTarget; createdAt: string }) {
  if (target.state === 'none') return null;
  const pct = Math.min(100, target.percentElapsed ?? 0);
  const color = { breached: 'bg-destructive', warning: 'bg-warning', met: 'bg-success', paused: 'bg-muted-foreground', on_track: 'bg-primary', none: 'bg-muted' }[target.state];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <SlaBadge sla={{ firstResponse: { ...target, state: 'met' }, resolution: target }} />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${label} elapsed`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        Target {formatDate(target.dueAt)}
        {target.completedAt ? ` · done ${formatDate(target.completedAt)} (${formatDuration((new Date(target.completedAt).getTime() - new Date(createdAt).getTime()) / 60000)})` : ` · ${relative(target.dueAt)}`}
      </p>
    </div>
  );
}

function SlaCard({ t }: { t: TicketDetail }) {
  const p = t.sla.policy;
  return (
    <Card>
      <CardHeader>
        <CardTitle>SLA timeline</CardTitle>
        {p && (
          <p className="text-xs text-muted-foreground">
            {p.name}: respond in {formatTarget(p.firstResponseMinutes, p.useBusinessHours)}, resolve in {formatTarget(p.resolutionMinutes, p.useBusinessHours)}{p.useBusinessHours ? '' : ' (24×7)'}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!p && t.sla.resolution.state === 'none' ? (
          <p className="text-sm text-muted-foreground">No SLA policy applies to this ticket.</p>
        ) : (
          <>
            <SlaRow label="First response" target={t.sla.firstResponse} createdAt={t.createdAt} />
            <SlaRow label="Resolution" target={t.sla.resolution} createdAt={t.createdAt} />
            {t.sla.pausedAt && <p className="text-xs text-muted-foreground">Paused since {formatDate(t.sla.pausedAt)} while waiting on the customer.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
