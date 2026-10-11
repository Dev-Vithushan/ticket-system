import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, PageHeader, Pagination } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useDebounce } from '@/hooks/useDebounce';
import { api, type Page } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
}

const ENTITY_TYPES = ['User', 'Role', 'Team', 'Department', 'TicketCategory', 'Tag', 'SlaPolicy', 'BusinessHours', 'Holiday', 'SystemSetting'];

export function AuditLogPage() {
  const [action, setAction] = useState('');
  const debounced = useDebounce(action);
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const q = { page, pageSize: 30, action: debounced || undefined, entityType: entityType || undefined };
  const logs = useQuery({ queryKey: ['audit', q], queryFn: () => api.get<Page<AuditRow>>('/audit-logs', q), placeholderData: keepPreviousData });
  return (
    <div>
      <PageHeader title="Audit log" description="Security-relevant and administrative actions: logins, lockouts, user and role changes, configuration changes." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Input className="w-full sm:w-64" placeholder="Filter by action, e.g. auth.login" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Filter by action" />
          <Select className="w-48" value={entityType} onValueChange={(v) => { setEntityType(v); setPage(1); }} placeholder="All entity types" aria-label="Entity type" options={ENTITY_TYPES.map((t) => ({ value: t, label: t }))} />
        </div>
        {logs.isError ? <ErrorState error={logs.error} onRetry={() => logs.refetch()} /> : logs.isLoading ? <Skeleton className="m-3 h-64" /> : !logs.data!.data.length ? <EmptyState title="No audit entries match" /> : (
          <>
            <Table>
              <THead><tr><TH>When</TH><TH>Actor</TH><TH>Action</TH><TH>Entity</TH><TH>Details</TH><TH>IP</TH></tr></THead>
              <TBody>
                {logs.data!.data.map((l) => (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap text-xs">{formatDate(l.createdAt, 'MMM d, yyyy HH:mm:ss')}</TD>
                    <TD className="whitespace-nowrap">{l.actor?.name ?? <span className="text-muted-foreground">System / anonymous</span>}</TD>
                    <TD><code className={`text-xs ${/failed|locked|reuse/.test(l.action) ? 'text-destructive' : ''}`}>{l.action}</code></TD>
                    <TD className="whitespace-nowrap text-xs">{l.entityType}{l.entityId ? <span className="text-muted-foreground"> · {l.entityId.slice(0, 8)}</span> : ''}</TD>
                    <TD className="max-w-md truncate font-mono text-xs text-muted-foreground" title={l.metadata ? JSON.stringify(l.metadata) : ''}>{l.metadata ? JSON.stringify(l.metadata) : '—'}</TD>
                    <TD className="text-xs text-muted-foreground">{l.ipAddress ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination {...logs.data!.meta} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
