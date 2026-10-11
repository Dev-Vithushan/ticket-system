import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ErrorState, PageHeader } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api, errorMessage } from '@/lib/api';
import type { Role } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useRoles } from './UsersPage';

interface PermissionDef {
  key: string;
  group: string;
  description: string;
}

export function RolesPage() {
  const qc = useQueryClient();
  const roles = useRoles();
  const catalogue = useQuery({ queryKey: ['permissions'], queryFn: () => api.get<{ data: PermissionDef[] }>('/roles/permissions').then((r) => r.data) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const selected = roles.data?.find((r) => r.id === selectedId) ?? roles.data?.[0];
  useEffect(() => {
    if (selected) setDraft(new Set(selected.permissions));
  }, [selected]);
  const groups = useMemo(() => {
    const m = new Map<string, PermissionDef[]>();
    for (const p of catalogue.data ?? []) m.set(p.group, [...(m.get(p.group) ?? []), p]);
    return [...m.entries()];
  }, [catalogue.data]);
  const dirty = selected && (selected.permissions.length !== draft.size || selected.permissions.some((p) => !draft.has(p)));
  const save = useMutation({
    mutationFn: () => api.patch(`/roles/${selected!.id}`, { permissions: [...draft] }),
    onSuccess: () => {
      toast.success('Permissions saved');
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (roles.isError) return <ErrorState error={roles.error} onRetry={() => roles.refetch()} />;
  return (
    <div>
      <PageHeader title="Roles & permissions" description="Permissions are enforced by the API on every request. Changes apply to all users with the role immediately." actions={<Button onClick={() => setCreating(true)}><Plus /> New role</Button>} />
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card>
          <CardContent className="p-2 pt-2 sm:p-2 sm:pt-2">
            {roles.isLoading ? <Skeleton className="h-48" /> : (
              <ul className="space-y-1" role="listbox" aria-label="Roles">
                {roles.data!.map((r) => (
                  <li key={r.id}>
                    <button
                      role="option"
                      aria-selected={selected?.id === r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent', selected?.id === r.id && 'bg-accent font-medium')}
                    >
                      <span>
                        {r.name}
                        <span className="block text-xs font-normal text-muted-foreground">{r.userCount} user{r.userCount === 1 ? '' : 's'} · {r.permissions.length} permissions</span>
                      </span>
                      {r.isSystem && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="System role" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {selected && (
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">{selected.name} {selected.isStaff ? <Badge>Staff</Badge> : <Badge variant="secondary">Customer</Badge>}</CardTitle>
                <CardDescription>{selected.description ?? selected.key}</CardDescription>
              </div>
              <div className="flex gap-2">
                {!selected.isSystem && (
                  <ConfirmDialog
                    trigger={<Button variant="outline" size="sm" disabled={selected.userCount > 0}><Trash2 /> Delete</Button>}
                    title={`Delete role “${selected.name}”?`}
                    description="This cannot be undone."
                    destructive
                    confirmLabel="Delete role"
                    onConfirm={async () => {
                      try {
                        await api.delete(`/roles/${selected.id}`);
                        toast.success('Role deleted');
                        setSelectedId(null);
                        qc.invalidateQueries({ queryKey: ['roles'] });
                      } catch (e) {
                        toast.error(errorMessage(e));
                      }
                    }}
                  />
                )}
                <Button size="sm" variant="outline" disabled={!dirty} onClick={() => setDraft(new Set(selected.permissions))}>Discard</Button>
                <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save permissions</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {groups.map(([group, perms]) => (
                <fieldset key={group}>
                  <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {perms.map((p) => (
                      <label key={p.key} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/40">
                        <Checkbox
                          className="mt-0.5"
                          checked={draft.has(p.key)}
                          onCheckedChange={(c) => setDraft((d) => { const n = new Set(d); if (c) n.add(p.key); else n.delete(p.key); return n; })}
                        />
                        <span>
                          <span className="block text-sm font-medium">{p.description}</span>
                          <code className="text-xs text-muted-foreground">{p.key}</code>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
      {creating && <NewRoleDialog onClose={() => setCreating(false)} onCreated={(r) => setSelectedId(r.id)} />}
    </div>
  );
}

function NewRoleDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (r: Role) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [isStaff, setIsStaff] = useState(true);
  const validKey = /^[A-Z][A-Z0-9_]{2,40}$/.test(key);
  const create = useMutation({
    mutationFn: () => api.post<{ data: Role }>('/roles', { name, key, isStaff, permissions: [] }),
    onSuccess: (r) => {
      toast.success('Role created — now choose its permissions');
      qc.invalidateQueries({ queryKey: ['roles'] });
      onCreated(r.data);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New role</DialogTitle></DialogHeader>
        <Field label="Name" htmlFor="r-name" required>
          <Input id="r-name" value={name} onChange={(e) => { setName(e.target.value); setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')); }} />
        </Field>
        <Field label="Key" htmlFor="r-key" hint="UPPER_SNAKE_CASE identifier" error={key && !validKey ? 'Use 3–41 upper-case letters, digits or _' : undefined} required>
          <Input id="r-key" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} />
        </Field>
        <label className="flex items-center gap-2 text-sm"><Switch checked={isStaff} onCheckedChange={setIsStaff} /> Staff role (acts on behalf of the organization)</label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={name.trim().length < 2 || !validKey} loading={create.isPending} onClick={() => create.mutate()}>Create role</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
