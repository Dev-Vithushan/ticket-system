import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { BarsChart, VolumeChart } from '@/components/charts/charts';
import { DateRangePicker, useDateRange } from '@/components/charts/DateRange';
import { StatCard } from '@/components/charts/StatCard';
import { PriorityBadge, StatusBadge } from '@/components/tickets/badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AgentTable, pct, type AgentRow, type Distribution } from '@/features/dashboard/DashboardPage';
import { Stars } from '@/features/tickets/detail/RelatedTab';
import { useTeams } from '@/hooks/useLookups';
import { api, errorMessage } from '@/lib/api';
import { PRIORITIES, type Summary, type TicketPriority, type TicketStatus } from '@/lib/types';
import { formatDate, formatDuration, humanize } from '@/lib/utils';

function useReport<T>(name: string, params: Record<string, string | undefined>, enabled = true) {
  return useQuery({ queryKey: ['reports', name, params], queryFn: () => api.get<{ data: T }>(`/reports/${name}`, params).then((r) => r.data), enabled });
}

interface TeamRow {
  id: string;
  name: string;
  created: number;
  open: number;
  resolved: number;
  avgResolutionMinutes: number | null;
  avgFirstResponseMinutes: number | null;
  slaCompliancePercent: number | null;
  reopened: number;
  reopenRatePercent: number | null;
}
interface SlaReport {
  byPriority: { priority: TicketPriority; total: number; met: number; breached: number; firstResponseBreaches: number; resolutionBreaches: number; compliancePercent: number | null; firstResponseMetPercent: number | null; avgFirstResponseMinutes: number | null }[];
  openBreaches: { id: string; number: string; subject: string; status: TicketStatus; priority: TicketPriority; resolutionDueAt: string | null; assignee: string | null }[];
}
interface Csat {
  average: number | null;
  responses: number;
  satisfiedPercent: number | null;
  distribution: { rating: number; count: number }[];
  recent: { rating: number; comment: string | null; createdAt: string; ticketId: string; number: string; requester: string }[];
}

export function ReportsPage() {
  const { range, setRange, query, interval } = useDateRange('30d');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [priority, setPriority] = useState('');
  const [grain, setGrain] = useState<'auto' | 'day' | 'week' | 'month'>('auto');
  const teams = useTeams();
  const params = { ...query, teamId: teamId ?? undefined, priority: priority || undefined };
  const effective = grain === 'auto' ? interval : grain;
  const summary = useReport<Summary>('summary', params);
  const volume = useReport<{ period: string; created: number; resolved: number }[]>('volume', { ...params, interval: effective });
  const dist = useReport<Distribution>('distribution', params);
  const sla = useReport<SlaReport>('sla', params);
  const teamsR = useReport<TeamRow[]>('teams', params);
  const agents = useReport<AgentRow[]>('agents', params);
  const csat = useReport<Csat>('satisfaction', params);
  const s = summary.data;

  const exportCsv = (report: string) => api.download('/reports/export', { ...params, report, interval: effective }).catch((e) => toast.error(errorMessage(e)));
  const ExportBtn = ({ report }: { report: string }) => (
    <Button variant="outline" size="sm" onClick={() => exportCsv(report)}>
      <Download /> CSV
    </Button>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" description="Operational analytics computed from live ticket data, limited to the tickets you can access." actions={<ExportBtn report="tickets" />} />
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker range={range} onChange={setRange} />
        <Combobox className="w-44" value={teamId} onChange={setTeamId} placeholder="All teams" options={(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
        <Select className="w-36" value={priority} onValueChange={setPriority} placeholder="All priorities" options={PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} aria-label="Priority filter" />
      </div>
      {summary.isError && <ErrorState error={summary.error} onRetry={() => summary.refetch()} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Tickets" value={s?.total} loading={summary.isLoading} />
        <StatCard label="SLA compliance" value={pct(s?.slaCompliancePercent ?? null)} loading={summary.isLoading} />
        <StatCard label="Avg first response" value={formatDuration(s?.avgFirstResponseMinutes)} loading={summary.isLoading} />
        <StatCard label="Avg resolution" value={formatDuration(s?.avgResolutionMinutes)} loading={summary.isLoading} />
        <StatCard label="Reopen rate" value={pct(s?.reopenRatePercent ?? null)} loading={summary.isLoading} />
        <StatCard label="CSAT" value={s?.csatAverage ? `${s.csatAverage}/5` : '—'} hint={s ? `${s.csatResponses} responses` : undefined} loading={summary.isLoading} />
      </div>

      <Tabs defaultValue="volume">
        <TabsList>
          <TabsTrigger value="volume">Volume & distribution</TabsTrigger>
          <TabsTrigger value="sla">SLA & response</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="csat">Satisfaction</TabsTrigger>
        </TabsList>

        <TabsContent value="volume" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle>Ticket volume</CardTitle>
                <CardDescription>Created and resolved per {effective}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Select className="h-8 w-28" value={grain} onValueChange={(v) => setGrain((v || 'auto') as typeof grain)} aria-label="Interval" options={[{ value: 'auto', label: 'Auto' }, { value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} />
                <ExportBtn report="volume" />
              </div>
            </CardHeader>
            <CardContent>{volume.isLoading ? <Skeleton className="h-[260px]" /> : volume.isError ? <ErrorState error={volume.error} /> : <VolumeChart data={volume.data!} interval={effective} />}</CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>By priority</CardTitle></CardHeader>
              <CardContent>{dist.data ? <BarsChart ordinal data={dist.data.byPriority.map((d) => ({ ...d, label: humanize(d.key) }))} /> : <Skeleton className="h-60" />}</CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>By category</CardTitle></CardHeader>
              <CardContent>{dist.data ? <BarsChart layout="horizontal" data={dist.data.byCategory} /> : <Skeleton className="h-60" />}</CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>By source</CardTitle></CardHeader>
              <CardContent>{dist.data ? <BarsChart data={dist.data.bySource.map((d) => ({ ...d, label: humanize(d.key) }))} /> : <Skeleton className="h-60" />}</CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="sla" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>SLA compliance by priority</CardTitle>
                <CardDescription>Compliance = met ÷ (met + breached). Open tickets still within target are excluded until decided.</CardDescription>
              </div>
              <ExportBtn report="sla" />
            </CardHeader>
            <CardContent className="p-0 sm:p-0">
              {sla.isLoading ? <Skeleton className="m-4 h-40" /> : sla.isError ? <ErrorState error={sla.error} /> : (
                <Table>
                  <THead>
                    <tr>
                      <TH>Priority</TH>
                      <TH className="text-right">Tickets</TH>
                      <TH className="text-right">Met</TH>
                      <TH className="text-right">Breached</TH>
                      <TH className="text-right">1st response breaches</TH>
                      <TH className="text-right">Resolution breaches</TH>
                      <TH className="text-right">1st response met</TH>
                      <TH className="text-right">Avg 1st response</TH>
                      <TH className="text-right">Compliance</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {sla.data!.byPriority.map((r) => (
                      <TR key={r.priority}>
                        <TD><PriorityBadge priority={r.priority} /></TD>
                        <TD className="text-right tabular-nums">{r.total}</TD>
                        <TD className="text-right tabular-nums">{r.met}</TD>
                        <TD className="text-right tabular-nums">{r.breached}</TD>
                        <TD className="text-right tabular-nums">{r.firstResponseBreaches}</TD>
                        <TD className="text-right tabular-nums">{r.resolutionBreaches}</TD>
                        <TD className="text-right tabular-nums">{pct(r.firstResponseMetPercent)}</TD>
                        <TD className="text-right tabular-nums">{formatDuration(r.avgFirstResponseMinutes)}</TD>
                        <TD className="text-right font-medium tabular-nums">{pct(r.compliancePercent)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Open tickets in breach</CardTitle>
              <CardDescription>Active tickets that have missed a first-response or resolution target.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 sm:p-0">
              {!sla.data?.openBreaches.length ? (
                <EmptyState title="No open breaches" description="Every active ticket is within its SLA." />
              ) : (
                <Table>
                  <THead><tr><TH>Ticket</TH><TH>Subject</TH><TH>Status</TH><TH>Priority</TH><TH>Assignee</TH><TH>Resolution due</TH></tr></THead>
                  <TBody>
                    {sla.data.openBreaches.map((t) => (
                      <TR key={t.id}>
                        <TD><Link to={`/tickets/${t.id}`} className="font-mono text-xs text-primary hover:underline">{t.number}</Link></TD>
                        <TD className="max-w-xs truncate">{t.subject}</TD>
                        <TD><StatusBadge status={t.status} /></TD>
                        <TD><PriorityBadge priority={t.priority} /></TD>
                        <TD>{t.assignee ?? '—'}</TD>
                        <TD className="whitespace-nowrap text-destructive">{formatDate(t.resolutionDueAt)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="teams">
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Team performance</CardTitle>
                <CardDescription>Resolution time, SLA and reopen rate by team.</CardDescription>
              </div>
              <ExportBtn report="teams" />
            </CardHeader>
            <CardContent className="p-0 sm:p-0">
              {teamsR.isLoading ? <Skeleton className="m-4 h-40" /> : teamsR.isError ? <ErrorState error={teamsR.error} /> : !teamsR.data!.length ? <EmptyState title="No team data" /> : (
                <Table>
                  <THead>
                    <tr>
                      <TH>Team</TH><TH className="text-right">Created</TH><TH className="text-right">Open now</TH><TH className="text-right">Resolved</TH>
                      <TH className="text-right">Avg 1st response</TH><TH className="text-right">Avg resolution</TH><TH className="text-right">SLA</TH><TH className="text-right">Reopen rate</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {teamsR.data!.map((t) => (
                      <TR key={t.id}>
                        <TD className="font-medium">{t.name}</TD>
                        <TD className="text-right tabular-nums">{t.created}</TD>
                        <TD className="text-right tabular-nums">{t.open}</TD>
                        <TD className="text-right tabular-nums">{t.resolved}</TD>
                        <TD className="text-right tabular-nums">{formatDuration(t.avgFirstResponseMinutes)}</TD>
                        <TD className="text-right tabular-nums">{formatDuration(t.avgResolutionMinutes)}</TD>
                        <TD className="text-right tabular-nums">{pct(t.slaCompliancePercent)}</TD>
                        <TD className="text-right tabular-nums">{pct(t.reopenRatePercent)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agents">
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Agent workload & performance</CardTitle>
              </div>
              <ExportBtn report="agents" />
            </CardHeader>
            <CardContent className="p-0 sm:p-0">{agents.isLoading ? <Skeleton className="m-4 h-40" /> : agents.isError ? <ErrorState error={agents.error} /> : <AgentTable rows={agents.data!} />}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="csat" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <CardTitle>Customer satisfaction</CardTitle>
                <ExportBtn report="satisfaction" />
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-3xl font-semibold tabular-nums">{csat.data?.average ?? '—'}<span className="text-base text-muted-foreground"> / 5</span></p>
                {csat.data?.average && <Stars value={Math.round(csat.data.average)} />}
                <p className="text-sm text-muted-foreground">{csat.data?.responses ?? 0} responses · {pct(csat.data?.satisfiedPercent ?? null)} satisfied (4–5★)</p>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Rating distribution</CardTitle></CardHeader>
              <CardContent>{csat.data ? <BarsChart name="Ratings" data={csat.data.distribution.map((d) => ({ key: String(d.rating), label: `${d.rating}★`, count: d.count }))} height={200} /> : <Skeleton className="h-48" />}</CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Recent feedback</CardTitle></CardHeader>
            <CardContent>
              {!csat.data?.recent.length ? <EmptyState title="No feedback in this period" /> : (
                <ul className="divide-y">
                  {csat.data.recent.map((r) => (
                    <li key={r.ticketId} className="flex flex-wrap items-start gap-3 py-3">
                      <Stars value={r.rating} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{r.comment ?? <span className="text-muted-foreground">No comment</span>}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.requester} · <Link className="text-primary hover:underline" to={`/tickets/${r.ticketId}`}>{r.number}</Link> · {formatDate(r.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
