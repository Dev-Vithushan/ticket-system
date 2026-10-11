import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PriorityBadge } from '@/components/tickets/badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useSlaPolicies } from '@/hooks/useLookups';
import { api, errorMessage } from '@/lib/api';
import type { SlaPolicy } from '@/lib/types';
import { formatDate, formatTarget, hhmmToMinutes, minutesToHHMM } from '@/lib/utils';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function SlaPage() {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => api.post<{ data: { warnings: number; breaches: number; escalations: number; autoClosed: number; skipped?: boolean } }>('/sla/run-check'),
    onSuccess: (r) => {
      const d = r.data;
      toast.success(d.skipped ? 'Another SLA check is already running' : `SLA check complete: ${d.warnings} warnings, ${d.breaches} breaches, ${d.escalations} escalations, ${d.autoClosed} auto-closed`);
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="SLA & business hours"
        description="Targets are measured in business time unless a policy runs 24×7. Changes apply to new tickets and re-prioritised tickets. The SLA monitor runs automatically every minute."
        actions={<Button variant="outline" loading={run.isPending} onClick={() => run.mutate()}><Play /> Run SLA check now</Button>}
      />
      <PoliciesCard />
      <div className="grid gap-4 xl:grid-cols-2">
        <BusinessHoursCard />
        <HolidaysCard />
      </div>
    </div>
  );
}

function PoliciesCard() {
  const policies = useSlaPolicies();
  if (policies.isError) return <ErrorState error={policies.error} onRetry={() => policies.refetch()} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>SLA policies by priority</CardTitle>
        <CardDescription>First response and resolution targets, warning threshold and escalation rule.</CardDescription>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {policies.isLoading ? <Skeleton className="m-4 h-40" /> : (
          <Table>
            <THead>
              <tr>
                <TH>Priority</TH><TH>Name</TH><TH>First response (min)</TH><TH>Resolution (min)</TH><TH>Warn at %</TH><TH>Business hours</TH><TH>Escalate on breach</TH><TH>Active</TH><TH />
              </tr>
            </THead>
            <TBody>{[...policies.data!].sort((a, b) => ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(a.priority) - ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(b.priority)).map((p) => <PolicyRow key={p.id} policy={p} />)}</TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function PolicyRow({ policy }: { policy: SlaPolicy }) {
  const qc = useQueryClient();
  const [d, setD] = useState(policy);
  useEffect(() => setD(policy), [policy]);
  const dirty = JSON.stringify(d) !== JSON.stringify(policy);
  const valid = d.firstResponseMinutes >= 1 && d.resolutionMinutes >= d.firstResponseMinutes && d.warningThresholdPercent >= 1 && d.warningThresholdPercent <= 99 && d.name.trim().length >= 2;
  const save = useMutation({
    mutationFn: () => api.patch(`/sla/policies/${policy.id}`, { name: d.name, firstResponseMinutes: d.firstResponseMinutes, resolutionMinutes: d.resolutionMinutes, warningThresholdPercent: d.warningThresholdPercent, useBusinessHours: d.useBusinessHours, escalateOnBreach: d.escalateOnBreach, isActive: d.isActive }),
    onSuccess: () => {
      toast.success(`${policy.name} policy saved`);
      qc.invalidateQueries({ queryKey: ['sla-policies'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const num = (k: 'firstResponseMinutes' | 'resolutionMinutes' | 'warningThresholdPercent') => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: Number(e.target.value) });
  return (
    <TR>
      <TD><PriorityBadge priority={policy.priority} /></TD>
      <TD><Input className="h-8 w-40" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} aria-label={`${policy.priority} policy name`} /></TD>
      <TD><Input className="h-8 w-24" type="number" min={1} value={d.firstResponseMinutes} onChange={num('firstResponseMinutes')} aria-label="First response minutes" /><span className="ml-1 text-xs text-muted-foreground">{formatTarget(d.firstResponseMinutes, d.useBusinessHours)}</span></TD>
      <TD><Input className="h-8 w-24" type="number" min={1} value={d.resolutionMinutes} onChange={num('resolutionMinutes')} aria-label="Resolution minutes" aria-invalid={d.resolutionMinutes < d.firstResponseMinutes} /><span className="ml-1 text-xs text-muted-foreground">{formatTarget(d.resolutionMinutes, d.useBusinessHours)}</span></TD>
      <TD><Input className="h-8 w-20" type="number" min={1} max={99} value={d.warningThresholdPercent} onChange={num('warningThresholdPercent')} aria-label="Warning threshold percent" /></TD>
      <TD><Switch checked={d.useBusinessHours} onCheckedChange={(c) => setD({ ...d, useBusinessHours: c })} aria-label="Use business hours" /></TD>
      <TD><Switch checked={d.escalateOnBreach} onCheckedChange={(c) => setD({ ...d, escalateOnBreach: c })} aria-label="Escalate on breach" /></TD>
      <TD><Switch checked={d.isActive} onCheckedChange={(c) => setD({ ...d, isActive: c })} aria-label="Active" /></TD>
      <TD><Button size="sm" disabled={!dirty || !valid} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></TD>
    </TR>
  );
}

interface Day {
  dayOfWeek: number;
  isWorkingDay: boolean;
  startMinute: number;
  endMinute: number;
}

function BusinessHoursCard() {
  const qc = useQueryClient();
  const hours = useQuery({ queryKey: ['business-hours'], queryFn: () => api.get<{ data: { timezone: string; days: Day[] } }>('/sla/business-hours').then((r) => r.data) });
  const [days, setDays] = useState<Day[]>([]);
  useEffect(() => {
    if (hours.data) setDays(hours.data.days);
  }, [hours.data]);
  const invalid = days.some((d) => d.isWorkingDay && d.endMinute <= d.startMinute) || !days.some((d) => d.isWorkingDay);
  const save = useMutation({
    mutationFn: () => api.put('/sla/business-hours', { days }),
    onSuccess: () => {
      toast.success('Business hours saved');
      qc.invalidateQueries({ queryKey: ['business-hours'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = (i: number, patch: Partial<Day>) => setDays((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Business hours</CardTitle>
        <CardDescription>Time zone: {hours.data?.timezone ?? '…'} (change it in System settings).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {hours.isLoading ? <Skeleton className="h-60" /> : hours.isError ? <ErrorState error={hours.error} /> : (
          <>
            {days.map((d, i) => (
              <div key={d.dayOfWeek} className="flex flex-wrap items-center gap-3">
                <label className="flex w-36 items-center gap-2 text-sm">
                  <Switch checked={d.isWorkingDay} onCheckedChange={(c) => update(i, { isWorkingDay: c })} aria-label={`${DAYS[i]} is a working day`} />
                  {DAYS[i]}
                </label>
                <Input type="time" className="h-8 w-28" disabled={!d.isWorkingDay} value={minutesToHHMM(d.startMinute)} onChange={(e) => e.target.value && update(i, { startMinute: hhmmToMinutes(e.target.value) })} aria-label={`${DAYS[i]} start`} />
                <span className="text-muted-foreground">to</span>
                <Input type="time" className="h-8 w-28" disabled={!d.isWorkingDay} value={minutesToHHMM(Math.min(d.endMinute, 1439))} onChange={(e) => e.target.value && update(i, { endMinute: hhmmToMinutes(e.target.value) })} aria-label={`${DAYS[i]} end`} aria-invalid={d.isWorkingDay && d.endMinute <= d.startMinute} />
              </div>
            ))}
            {invalid && <p className="text-xs text-destructive">Each working day needs an end time after its start time, and at least one working day is required.</p>}
            <div className="pt-2"><Button disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>Save business hours</Button></div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HolidaysCard() {
  const qc = useQueryClient();
  const holidays = useQuery({ queryKey: ['holidays'], queryFn: () => api.get<{ data: { id: string; date: string; name: string }[] }>('/sla/holidays').then((r) => r.data) });
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => api.post('/sla/holidays', { date, name }),
    onSuccess: () => {
      toast.success('Holiday added');
      setDate('');
      setName('');
      qc.invalidateQueries({ queryKey: ['holidays'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Holidays & non-working days</CardTitle>
        <CardDescription>SLA clocks do not run on these dates.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (date && name.trim().length >= 2) add.mutate(); }}>
          <Field label="Date" htmlFor="h-date"><Input id="h-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Name" htmlFor="h-name" className="flex-1"><Input id="h-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Independence Day" /></Field>
          <Button type="submit" disabled={!date || name.trim().length < 2} loading={add.isPending}><Plus /> Add</Button>
        </form>
        {holidays.isLoading ? <Skeleton className="h-24" /> : !holidays.data?.length ? <EmptyState title="No holidays configured" className="py-6" /> : (
          <ul className="divide-y rounded-md border">
            {holidays.data.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-28 tabular-nums">{formatDate(`${h.date.slice(0, 10)}T12:00:00`, 'EEE, MMM d yyyy')}</span>
                <span className="flex-1">{h.name}</span>
                <ConfirmDialog
                  trigger={<Button variant="ghost" size="icon" aria-label={`Remove ${h.name}`}><Trash2 /></Button>}
                  title={`Remove “${h.name}”?`}
                  description="SLA clocks will run on this date for tickets created afterwards."
                  destructive
                  confirmLabel="Remove"
                  onConfirm={async () => {
                    try {
                      await api.delete(`/sla/holidays/${h.id}`);
                      qc.invalidateQueries({ queryKey: ['holidays'] });
                      toast.success('Holiday removed');
                    } catch (e) {
                      toast.error(errorMessage(e));
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
