import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Gauge, Hourglass, Inbox, Plus, Smile, Ticket, Timer } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { BarsChart, VolumeChart } from '@/components/charts/charts';
import { DateRangePicker, useDateRange } from '@/components/charts/DateRange';
import { StatCard } from '@/components/charts/StatCard';
import { PriorityBadge, SlaBadge, STATUS_LABEL, StatusBadge } from '@/components/tickets/badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { describe } from '@/features/tickets/detail/ActivityTab';
import { P, useAuth } from '@/hooks/useAuth';
import { api, type Page } from '@/lib/api';
import type { HistoryEntry, Summary, TicketListItem, TicketStatus } from '@/lib/types';
import { formatDuration, humanize, relative } from '@/lib/utils';

export interface AgentRow {
  id: string;
  name: string;
  openAssigned: number;
  overdue: number;
  resolved: number;
  avgResolutionMinutes: number | null;
  avgFirstResponseMinutes: number | null;
  slaCompliancePercent: number | null;
  timeLoggedMinutes: number;
  csatAverage: number | null;
}

export interface Distribution {
  byPriority: { key: string; count: number }[];
  byStatus: { key: string; count: number }[];
  byCategory: { key: string; count: number }[];
  bySource: { key: string; count: number }[];
  byTeam: { key: string; count: number }[];
}

export const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

export function DashboardPage() {
  const { user, can } = useAuth();
  const staff = !!user?.role.isStaff;
  const { range, setRange, query, interval } = useDateRange('30d');
  const summary = useQuery({ queryKey: ['reports', 'summary', query], queryFn: () => api.get<{ data: Summary }>('/reports/summary', query).then((r) => r.data) });
  const volume = useQuery({ queryKey: ['reports', 'volume', query, interval], queryFn: () => api.get<{ data: { period: string; created: number; resolved: number }[] }>('/reports/volume', { ...query, interval }).then((r) => r.data), enabled: staff });
  const dist = useQuery({ queryKey: ['reports', 'distribution', query], queryFn: () => api.get<{ data: Distribution }>('/reports/distribution', query).then((r) => r.data), enabled: staff });
  const agents = useQuery({ queryKey: ['reports', 'agents', query], queryFn: () => api.get<{ data: AgentRow[] }>('/reports/agents', query).then((r) => r.data), enabled: can(P.REPORT_VIEW) });
  const activity = useQuery({ queryKey: ['activity'], queryFn: () => api.get<{ data: (HistoryEntry & { ticket: { id: string; number: string; subject: string } })[] }>('/tickets/activity/recent', { limit: 12 }).then((r) => r.data) });
  const s = summary.data;
  const loading = summary.isLoading;

  if (!staff) return <CustomerDashboard summary={s} loading={loading} />;

  return (
    <div className="space-y-5">
      <PageHeader title={`Welcome back, ${user!.name.split(' ')[0]}`} description={`${user!.role.name} dashboard · figures cover tickets created in the selected period that you can access.`} actions={<DateRangePicker range={range} onChange={setRange} />} />
      {summary.isError && <ErrorState error={summary.error} onRetry={() => summary.refetch()} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Total" value={s?.total} icon={Ticket} loading={loading} to="/tickets" />
        <StatCard label="Open" value={s ? s.open + s.assigned : undefined} hint="New + assigned" icon={Inbox} loading={loading} to="/tickets?status=OPEN,ASSIGNED" />
        <StatCard label="In progress" value={s ? s.inProgress + s.escalated : undefined} hint={s ? `${s.escalated} escalated` : undefined} icon={Clock} loading={loading} to="/tickets?status=IN_PROGRESS,ESCALATED" />
        <StatCard label="Pending" value={s?.pending} hint="Waiting on customer" icon={Hourglass} loading={loading} to="/tickets?status=PENDING_CUSTOMER" />
        <StatCard label="Resolved" value={s ? s.resolved + s.closed : undefined} hint="Resolved + closed" icon={CheckCircle2} tone="success" loading={loading} to="/tickets?status=RESOLVED,CLOSED" />
        <StatCard label="Overdue" value={s?.overdue} icon={AlertTriangle} tone={s?.overdue ? 'danger' : undefined} loading={loading} to="/tickets?overdue=true" />
        <StatCard label="SLA compliance" value={pct(s?.slaCompliancePercent ?? null)} hint={s ? `${s.slaMet} met · ${s.slaBreached} breached` : undefined} icon={Gauge} tone={s && (s.slaCompliancePercent ?? 100) < 80 ? 'warning' : 'success'} loading={loading} />
        <StatCard label="CSAT" value={s?.csatAverage ? `${s.csatAverage}/5` : '—'} hint={s ? `${s.csatResponses} ratings` : undefined} icon={Smile} loading={loading} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Avg first response" value={formatDuration(s?.avgFirstResponseMinutes)} icon={Timer} loading={loading} />
        <StatCard label="Avg resolution time" value={formatDuration(s?.avgResolutionMinutes)} icon={Timer} loading={loading} />
        <StatCard label="Reopen rate" value={pct(s?.reopenRatePercent ?? null)} hint={s ? `${s.reopened} reopened` : undefined} loading={loading} />
        <StatCard label="SLA breaches" value={s?.slaBreached} icon={AlertTriangle} tone={s?.slaBreached ? 'danger' : undefined} loading={loading} to="/tickets?slaBreached=true" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Tickets created vs resolved</CardTitle>
            <CardDescription>Per {interval}</CardDescription>
          </CardHeader>
          <CardContent>{volume.isLoading ? <Skeleton className="h-[260px]" /> : volume.isError ? <ErrorState error={volume.error} /> : <VolumeChart data={volume.data!} interval={interval} />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By status</CardTitle>
          </CardHeader>
          <CardContent>{dist.isLoading ? <Skeleton className="h-[260px]" /> : <BarsChart layout="horizontal" data={(dist.data?.byStatus ?? []).map((d) => ({ ...d, label: STATUS_LABEL[d.key as TicketStatus] }))} />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By priority</CardTitle>
          </CardHeader>
          <CardContent>{dist.isLoading ? <Skeleton className="h-[240px]" /> : <BarsChart ordinal data={(dist.data?.byPriority ?? []).map((d) => ({ ...d, label: humanize(d.key) }))} />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By category</CardTitle>
          </CardHeader>
          <CardContent>{dist.isLoading ? <Skeleton className="h-[240px]" /> : <BarsChart layout="horizontal" data={(dist.data?.byCategory ?? []).slice(0, 8)} />}</CardContent>
        </Card>
        <RecentActivity loading={activity.isLoading} rows={activity.data} />
      </div>

      {can(P.REPORT_VIEW) && (
        <Card>
          <CardHeader>
            <CardTitle>Agent workload & performance</CardTitle>
            <CardDescription>Open workload is current; resolved, response and SLA figures cover the selected period.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            {agents.isLoading ? <Skeleton className="m-4 h-40" /> : agents.isError ? <ErrorState error={agents.error} /> : <AgentTable rows={agents.data!} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function AgentTable({ rows }: { rows: AgentRow[] }) {
  if (!rows.length) return <EmptyState title="No agents in scope" />;
  const max = Math.max(1, ...rows.map((r) => r.openAssigned));
  return (
    <Table>
      <THead>
        <tr>
          <TH>Agent</TH>
          <TH>Open workload</TH>
          <TH className="text-right">Overdue</TH>
          <TH className="text-right">Resolved</TH>
          <TH className="text-right">Avg 1st response</TH>
          <TH className="text-right">Avg resolution</TH>
          <TH className="text-right">SLA</TH>
          <TH className="text-right">Time logged</TH>
          <TH className="text-right">CSAT</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD className="whitespace-nowrap font-medium">
              <Link className="hover:underline" to={`/tickets?assigneeId=${r.id}&status=OPEN,ASSIGNED,IN_PROGRESS,PENDING_CUSTOMER,ESCALATED`}>
                {r.name}
              </Link>
            </TD>
            <TD>
              <div className="flex items-center gap-2">
                <div className="h-2 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${(r.openAssigned / max) * 100}%` }} />
                </div>
                <span className="tabular-nums">{r.openAssigned}</span>
              </div>
            </TD>
            <TD className={`text-right tabular-nums ${r.overdue ? 'font-medium text-destructive' : ''}`}>{r.overdue}</TD>
            <TD className="text-right tabular-nums">{r.resolved}</TD>
            <TD className="text-right tabular-nums">{formatDuration(r.avgFirstResponseMinutes)}</TD>
            <TD className="text-right tabular-nums">{formatDuration(r.avgResolutionMinutes)}</TD>
            <TD className="text-right tabular-nums">{pct(r.slaCompliancePercent)}</TD>
            <TD className="text-right tabular-nums">{formatDuration(r.timeLoggedMinutes)}</TD>
            <TD className="text-right tabular-nums">{r.csatAverage ?? '—'}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function RecentActivity({ rows, loading }: { rows?: (HistoryEntry & { ticket: { id: string; number: string; subject: string } })[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardContent className="max-h-[22rem] overflow-y-auto">
        {loading ? (
          <Skeleton className="h-60" />
        ) : !rows?.length ? (
          <EmptyState title="No recent activity" className="py-6" />
        ) : (
          <ul className="space-y-3">
            {rows.map((h) => (
              <li key={h.id} className="text-sm">
                <p className="line-clamp-2">
                  <span className="font-medium">{h.actor.name}</span> {describe(h).text} on{' '}
                  <Link to={`/tickets/${h.ticket.id}`} className="font-mono text-xs text-primary hover:underline">
                    {h.ticket.number}
                  </Link>
                </p>
                <p className="text-xs text-muted-foreground">{relative(h.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CustomerDashboard({ summary: s, loading }: { summary?: Summary; loading: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const recent = useQuery({ queryKey: ['tickets', { mine: true }], queryFn: () => api.get<Page<TicketListItem>>('/tickets', { pageSize: 6, sort: 'updatedAt', order: 'desc' }) });
  return (
    <div className="space-y-5">
      <PageHeader
        title={`Hello, ${user!.name.split(' ')[0]}`}
        description="Here’s an overview of your support requests from the last 30 days."
        actions={
          <Button onClick={() => navigate('/tickets/new')}>
            <Plus /> New ticket
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open" value={s ? s.open + s.assigned + s.inProgress + s.escalated : undefined} icon={Inbox} loading={loading} to="/tickets?status=OPEN,ASSIGNED,IN_PROGRESS,ESCALATED" />
        <StatCard label="Awaiting your reply" value={s?.pending} icon={Hourglass} tone={s?.pending ? 'warning' : undefined} loading={loading} to="/tickets?status=PENDING_CUSTOMER" />
        <StatCard label="Resolved" value={s ? s.resolved + s.closed : undefined} icon={CheckCircle2} tone="success" loading={loading} to="/tickets?status=RESOLVED,CLOSED" />
        <StatCard label="Avg resolution" value={formatDuration(s?.avgResolutionMinutes)} icon={Timer} loading={loading} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recently updated</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {recent.isLoading ? (
            <Skeleton className="m-4 h-40" />
          ) : recent.isError ? (
            <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
          ) : !recent.data!.data.length ? (
            <EmptyState title="You haven’t raised any tickets yet" description="Need help? Create a ticket and our team will get back to you." action={<Button onClick={() => navigate('/tickets/new')}><Plus /> New ticket</Button>} />
          ) : (
            <ul className="divide-y">
              {recent.data!.data.map((t) => (
                <li key={t.id}>
                  <Link to={`/tickets/${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/40">
                    <span className="font-mono text-xs text-muted-foreground">{t.number}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{t.subject}</span>
                    <PriorityBadge priority={t.priority} />
                    <StatusBadge status={t.status} />
                    {!['RESOLVED', 'CLOSED'].includes(t.status) && <SlaBadge sla={t.sla} compact />}
                    <span className="text-xs text-muted-foreground">{relative(t.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
