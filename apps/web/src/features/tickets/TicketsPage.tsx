import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, FilterX, Paperclip, Plus, MessageSquare } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PriorityBadge, SlaBadge, STATUS_LABEL, StatusBadge } from '@/components/tickets/badges';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { EmptyState, ErrorState, PageHeader, Pagination } from '@/components/ui/misc';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SortableTH, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { P, useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { useCategories, useStaff, useTeams } from '@/hooks/useLookups';
import { api, errorMessage, type Page } from '@/lib/api';
import { PRIORITIES, STATUSES, type TicketListItem, type TicketPriority, type TicketStatus } from '@/lib/types';
import { cn, formatDate, humanize, relative } from '@/lib/utils';

type SortKey = 'createdAt' | 'updatedAt' | 'priority' | 'status' | 'number' | 'resolutionDueAt' | 'subject';
const DEFAULTS = { sort: 'createdAt', order: 'desc', page: '1' };

function useFilters() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const list = (k: string) => (params.get(k) ? params.get(k)!.split(',') : []);
  const set = (patch: Record<string, string | string[] | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      const s = Array.isArray(v) ? v.join(',') : v;
      if (!s) next.delete(k);
      else next.set(k, s);
    }
    if (resetPage && !('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  return { params, get, list, set, clear: () => setParams(new URLSearchParams(), { replace: true }) };
}

export function TicketsPage() {
  const { user, can } = useAuth();
  const staff = !!user?.role.isStaff;
  const f = useFilters();
  const navigate = useNavigate();
  const [search, setSearch] = useState(f.get('search'));
  const debounced = useDebounce(search, 350);
  useEffect(() => {
    if (debounced !== f.get('search')) f.set({ search: debounced || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => setSearch(f.get('search')), [f.params.get('search')]); // eslint-disable-line react-hooks/exhaustive-deps

  const sort = (f.get('sort') || DEFAULTS.sort) as SortKey;
  const order = (f.get('order') || DEFAULTS.order) as 'asc' | 'desc';
  const page = Number(f.get('page') || DEFAULTS.page);
  const view = f.get('view') || 'all';

  const query = {
    page,
    pageSize: 20,
    search: f.get('search'),
    status: f.list('status'),
    priority: f.list('priority'),
    assigneeId: f.get('assigneeId'),
    teamId: f.get('teamId'),
    categoryId: f.get('categoryId'),
    from: f.get('from') ? new Date(f.get('from')).toISOString() : undefined,
    to: f.get('to') ? new Date(`${f.get('to')}T23:59:59`).toISOString() : undefined,
    overdue: f.get('overdue') === 'true' || undefined,
    slaBreached: f.get('slaBreached') === 'true' || undefined,
    view: view === 'all' ? undefined : view,
    sort,
    order,
  };
  const tickets = useQuery({
    queryKey: ['tickets', query],
    queryFn: () => api.get<Page<TicketListItem>>('/tickets', query),
    placeholderData: keepPreviousData,
  });
  const teams = useTeams();
  const categories = useCategories();
  const agents = useStaff();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [tickets.data]);
  const rows = tickets.data?.data ?? [];
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const canBulk = can(P.TICKET_BULK_UPDATE);
  const hasFilters = [...f.params.keys()].some((k) => !['sort', 'order', 'page', 'view'].includes(k));

  const onSort = (key: SortKey) => f.set({ sort: key, order: sort === key && order === 'desc' ? 'asc' : 'desc' });
  const views = staff
    ? [
        { value: 'all', label: 'All visible' },
        { value: 'mine', label: 'Assigned to me' },
        { value: 'unassigned', label: 'Unassigned' },
        ...(user!.teams.length ? [{ value: 'my_teams', label: 'My teams' }] : []),
      ]
    : [];

  return (
    <div>
      <PageHeader
        title={staff ? 'Tickets' : 'My tickets'}
        description={staff ? 'Search, filter and work the queue.' : 'Track the status of your support requests.'}
        actions={
          <>
            {can(P.REPORT_VIEW) && (
              <Button
                variant="outline"
                onClick={() =>
                  api
                    .download('/reports/export', { report: 'tickets', from: query.from ?? new Date(Date.now() - 90 * 86_400_000).toISOString(), to: query.to, teamId: query.teamId })
                    .catch((e) => toast.error(errorMessage(e)))
                }
              >
                <Download /> Export CSV
              </Button>
            )}
            {can(P.TICKET_CREATE) && (
              <Button onClick={() => navigate('/tickets/new')}>
                <Plus /> New ticket
              </Button>
            )}
          </>
        }
      />

      {views.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1 border-b" role="tablist" aria-label="Ticket views">
          {views.map((v) => (
            <button
              key={v.value}
              role="tab"
              aria-selected={view === v.value}
              onClick={() => f.set({ view: v.value === 'all' ? null : v.value })}
              className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', view === v.value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number, subject, requester…" className="w-full sm:w-64" aria-label="Search tickets" />
          <MultiSelect label="Status" value={f.list('status')} onChange={(v) => f.set({ status: v })} options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
          <MultiSelect label="Priority" value={f.list('priority')} onChange={(v) => f.set({ priority: v })} options={PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />
          {staff && (
            <>
              <Combobox
                className="w-44"
                value={f.get('assigneeId') || null}
                onChange={(v) => f.set({ assigneeId: v })}
                placeholder="Any agent"
                options={[{ value: 'me', label: 'Me' }, { value: 'unassigned', label: 'Unassigned' }, ...(agents.data ?? []).map((a) => ({ value: a.id, label: a.name, description: a.role.name }))]}
              />
              <Combobox className="w-40" value={f.get('teamId') || null} onChange={(v) => f.set({ teamId: v })} placeholder="Any team" options={(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
            </>
          )}
          <Combobox
            className="w-44"
            value={f.get('categoryId') || null}
            onChange={(v) => f.set({ categoryId: v })}
            placeholder="Any category"
            options={(categories.data ?? []).flatMap((c) => [{ value: c.id, label: c.name }, ...c.children.map((s) => ({ value: s.id, label: `${c.name} › ${s.name}` }))])}
          />
          <div className="flex items-center gap-1">
            <Input type="date" aria-label="Created from" className="w-[9.5rem]" value={f.get('from')} max={f.get('to') || undefined} onChange={(e) => f.set({ from: e.target.value || null })} />
            <span className="text-muted-foreground">–</span>
            <Input type="date" aria-label="Created to" className="w-[9.5rem]" value={f.get('to')} min={f.get('from') || undefined} onChange={(e) => f.set({ to: e.target.value || null })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={f.get('overdue') === 'true'} onCheckedChange={(c) => f.set({ overdue: c ? 'true' : null })} /> Overdue
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={f.get('slaBreached') === 'true'} onCheckedChange={(c) => f.set({ slaBreached: c ? 'true' : null })} /> SLA breached
          </label>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); f.clear(); }}>
              <FilterX /> Reset
            </Button>
          )}
        </div>

        {canBulk && selected.size > 0 && <BulkBar ids={[...selected]} onDone={() => setSelected(new Set())} />}

        {tickets.isError ? (
          <ErrorState error={tickets.error} onRetry={() => tickets.refetch()} />
        ) : tickets.isLoading ? (
          <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading tickets">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No tickets match these filters' : 'No tickets yet'}
            description={hasFilters ? 'Try widening the date range or clearing filters.' : can(P.TICKET_CREATE) ? 'Create a ticket to get started.' : undefined}
            action={hasFilters ? <Button variant="outline" onClick={() => f.clear()}>Clear filters</Button> : can(P.TICKET_CREATE) ? <Button onClick={() => navigate('/tickets/new')}><Plus /> New ticket</Button> : undefined}
          />
        ) : (
          <div className={cn(tickets.isFetching && 'opacity-70 transition-opacity')}>
            <Table>
              <THead>
                <tr>
                  {canBulk && (
                    <TH className="w-10">
                      <Checkbox
                        aria-label="Select all on this page"
                        checked={allChecked ? true : selected.size > 0 ? 'indeterminate' : false}
                        onCheckedChange={(c) => setSelected(c ? new Set(rows.map((r) => r.id)) : new Set())}
                      />
                    </TH>
                  )}
                  <SortableTH label="Ticket" sortKey="number" sort={sort} order={order} onSort={onSort} />
                  <SortableTH label="Subject" sortKey="subject" sort={sort} order={order} onSort={onSort} className="min-w-[16rem]" />
                  <SortableTH label="Status" sortKey="status" sort={sort} order={order} onSort={onSort} />
                  <SortableTH label="Priority" sortKey="priority" sort={sort} order={order} onSort={onSort} />
                  {staff && <TH>Requester</TH>}
                  {staff && <TH>Assignee</TH>}
                  <TH className="hidden xl:table-cell">Team</TH>
                  <SortableTH label="SLA" sortKey="resolutionDueAt" sort={sort} order={order} onSort={onSort} />
                  <SortableTH label="Updated" sortKey="updatedAt" sort={sort} order={order} onSort={onSort} />
                </tr>
              </THead>
              <TBody>
                {rows.map((t) => (
                  <TR key={t.id} data-state={selected.has(t.id) ? 'selected' : undefined} className="cursor-pointer" onClick={() => navigate(`/tickets/${t.id}`)}>
                    {canBulk && (
                      <TD onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select ${t.number}`}
                          checked={selected.has(t.id)}
                          onCheckedChange={(c) =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (c) n.add(t.id);
                              else n.delete(t.id);
                              return n;
                            })
                          }
                        />
                      </TD>
                    )}
                    <TD className="whitespace-nowrap font-mono text-xs">
                      <Link to={`/tickets/${t.id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                        {t.number}
                      </Link>
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        {t.escalationLevel > 0 && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Escalated" />}
                        <span className="line-clamp-1 font-medium">{t.subject}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {t.category && <span className="truncate">{t.category.name}{t.subcategory ? ` › ${t.subcategory.name}` : ''}</span>}
                        {t.commentCount > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare className="h-3 w-3" aria-hidden />{t.commentCount}</span>}
                        {t.attachmentCount > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" aria-hidden />{t.attachmentCount}</span>}
                        {t.tags.slice(0, 2).map((tag) => (
                          <span key={tag.id} className="rounded px-1 text-[10px] font-medium" style={{ backgroundColor: `${tag.color}22`, color: tag.color }}>
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    </TD>
                    <TD><StatusBadge status={t.status} /></TD>
                    <TD><PriorityBadge priority={t.priority} /></TD>
                    {staff && <TD className="max-w-[10rem] truncate">{t.requester.name}</TD>}
                    {staff && <TD className="max-w-[10rem] truncate">{t.assignee?.name ?? <span className="text-muted-foreground">Unassigned</span>}</TD>}
                    <TD className="hidden max-w-[10rem] truncate xl:table-cell">{t.team?.name ?? '—'}</TD>
                    <TD>{['RESOLVED', 'CLOSED'].includes(t.status) && t.sla.resolution.state === 'none' ? '—' : <SlaBadge sla={t.sla} compact />}</TD>
                    <TD className="whitespace-nowrap text-xs text-muted-foreground" title={formatDate(t.updatedAt)}>{relative(t.updatedAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {tickets.data && <Pagination {...tickets.data.meta} onPage={(p) => f.set({ page: String(p) }, false)} />}
          </div>
        )}
      </Card>
    </div>
  );
}

function BulkBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const agents = useStaff();
  const teams = useTeams();
  const [assignee, setAssignee] = useState<string | null>(null);
  const [status, setStatus] = useState<TicketStatus | ''>('');
  const [priority, setPriority] = useState<TicketPriority | ''>('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [team, setTeam] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ data: { updated: number } }>('/tickets/bulk', { ticketIds: ids, ...body }),
    onSuccess: (r) => {
      toast.success(`Updated ${r.data.updated} ticket${r.data.updated === 1 ? '' : 's'}`);
      setAssignee(null);
      setStatus('');
      setPriority('');
      setTeam(null);
      setNotes('');
      setNotesOpen(false);
      onDone();
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const agentOptions = useMemo(() => (agents.data ?? []).map((a) => ({ value: a.id, label: a.name, description: a.teams.map((t) => t.name).join(', ') })), [agents.data]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-3 py-2 text-sm" role="region" aria-label="Bulk actions">
      <span className="font-medium">{ids.length} selected</span>
      {can(P.TICKET_ASSIGN) && (
        <>
          <Combobox className="w-48" value={assignee} onChange={setAssignee} options={agentOptions} placeholder="Assign to agent…" />
          <Button size="sm" variant="outline" disabled={!assignee} loading={mutation.isPending} onClick={() => mutation.mutate({ assigneeId: assignee })}>
            Assign
          </Button>
          <Combobox className="w-40" value={team} onChange={setTeam} options={(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))} placeholder="Move to team…" />
          <Button size="sm" variant="outline" disabled={!team} loading={mutation.isPending} onClick={() => mutation.mutate({ teamId: team })}>
            Move
          </Button>
        </>
      )}
      <Select className="w-44" value={status} onValueChange={(v) => setStatus(v as TicketStatus)} placeholder="Set status…" options={STATUSES.filter((s) => s !== 'ESCALATED').map((s) => ({ value: s, label: STATUS_LABEL[s] }))} aria-label="Bulk status" />
      <Button
        size="sm"
        variant="outline"
        disabled={!status}
        loading={mutation.isPending}
        onClick={() => (status === 'RESOLVED' || status === 'CLOSED' ? setNotesOpen(true) : mutation.mutate({ status }))}
      >
        Apply status
      </Button>
      <Select className="w-36" value={priority} onValueChange={(v) => setPriority(v as TicketPriority)} placeholder="Set priority…" options={PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} aria-label="Bulk priority" />
      <Button size="sm" variant="outline" disabled={!priority} loading={mutation.isPending} onClick={() => mutation.mutate({ priority })}>
        Apply priority
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Clear
      </Button>
      <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolution notes required</DialogTitle>
            <DialogDescription>These notes will be recorded on all {ids.length} selected tickets.</DialogDescription>
          </DialogHeader>
          <Field label="Resolution notes" htmlFor="bulk-notes" required>
            <Textarea id="bulk-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotesOpen(false)}>Cancel</Button>
            <Button disabled={!notes.trim()} loading={mutation.isPending} onClick={() => mutation.mutate({ status, resolutionNotes: notes })}>
              Update {ids.length} tickets
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
