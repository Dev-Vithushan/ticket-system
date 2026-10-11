import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCategories, useDepartments, useStaff, useTags, useTeams } from '@/hooks/useLookups';
import { api, errorMessage } from '@/lib/api';
import type { Category, Department, Team } from '@/lib/types';

function useSave(keys: string[][], message: string, onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ method, url, body }: { method: 'post' | 'patch' | 'put' | 'delete'; url: string; body?: unknown }) =>
      method === 'delete' ? api.delete(url) : api[method](url, body),
    onSuccess: () => {
      toast.success(message);
      keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      onDone?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

const ActiveBadge = ({ active }: { active: boolean }) => (active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>);

export function OrganizationPage() {
  return (
    <div>
      <PageHeader title="Organization" description="Departments, teams, ticket categories and tags. Items are deactivated rather than deleted so history stays intact." />
      <Tabs defaultValue="teams">
        <TabsList>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
        </TabsList>
        <TabsContent value="teams"><TeamsTab /></TabsContent>
        <TabsContent value="departments"><DepartmentsTab /></TabsContent>
        <TabsContent value="categories"><CategoriesTab /></TabsContent>
        <TabsContent value="tags"><TagsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ───────────── Departments ─────────────
function DepartmentsTab() {
  const depts = useDepartments(true);
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  if (depts.isError) return <ErrorState error={depts.error} onRetry={() => depts.refetch()} />;
  return (
    <Card>
      <div className="flex justify-end border-b p-3"><Button size="sm" onClick={() => setEditing('new')}><Plus /> Add department</Button></div>
      {depts.isLoading ? <Skeleton className="m-3 h-32" /> : !depts.data!.length ? <EmptyState title="No departments yet" /> : (
        <Table>
          <THead><tr><TH>Name</TH><TH>Description</TH><TH className="text-right">Teams</TH><TH className="text-right">Users</TH><TH>Status</TH><TH /></tr></THead>
          <TBody>
            {depts.data!.map((d) => (
              <TR key={d.id}>
                <TD className="font-medium">{d.name}</TD>
                <TD className="max-w-sm truncate text-muted-foreground">{d.description ?? '—'}</TD>
                <TD className="text-right tabular-nums">{d._count.teams}</TD>
                <TD className="text-right tabular-nums">{d._count.users}</TD>
                <TD><ActiveBadge active={d.isActive} /></TD>
                <TD className="text-right"><Button variant="ghost" size="icon" aria-label={`Edit ${d.name}`} onClick={() => setEditing(d)}><Pencil /></Button></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {editing && <DepartmentDialog dept={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function DepartmentDialog({ dept, onClose }: { dept: Department | null; onClose: () => void }) {
  const [name, setName] = useState(dept?.name ?? '');
  const [description, setDescription] = useState(dept?.description ?? '');
  const [isActive, setActive] = useState(dept?.isActive ?? true);
  const save = useSave([['departments']], dept ? 'Department updated' : 'Department created', onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{dept ? 'Edit department' : 'New department'}</DialogTitle></DialogHeader>
        <Field label="Name" htmlFor="d-name" required error={name && name.trim().length < 2 ? 'At least 2 characters' : undefined}><Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description" htmlFor="d-desc"><Textarea id="d-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {dept && <label className="flex items-center gap-2 text-sm"><Switch checked={isActive} onCheckedChange={setActive} /> Active</label>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate({ method: dept ? 'patch' : 'post', url: dept ? `/departments/${dept.id}` : '/departments', body: { name, description: description || null, ...(dept && { isActive }) } })}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Teams ─────────────
function TeamsTab() {
  const teams = useTeams(true);
  const [editing, setEditing] = useState<Team | 'new' | null>(null);
  const [members, setMembers] = useState<Team | null>(null);
  if (teams.isError) return <ErrorState error={teams.error} onRetry={() => teams.refetch()} />;
  return (
    <Card>
      <div className="flex justify-end border-b p-3"><Button size="sm" onClick={() => setEditing('new')}><Plus /> Add team</Button></div>
      {teams.isLoading ? <Skeleton className="m-3 h-32" /> : !teams.data!.length ? <EmptyState title="No teams yet" description="Create a department first, then add teams to it." /> : (
        <Table>
          <THead><tr><TH>Team</TH><TH>Department</TH><TH>Members</TH><TH className="text-right">Tickets</TH><TH>Status</TH><TH /></tr></THead>
          <TBody>
            {teams.data!.map((t) => (
              <TR key={t.id}>
                <TD><p className="font-medium">{t.name}</p>{t.email && <p className="text-xs text-muted-foreground">{t.email}</p>}</TD>
                <TD>{t.department.name}</TD>
                <TD className="max-w-xs text-sm">
                  {t.members.length ? t.members.map((m) => `${m.user.name}${m.role === 'LEAD' ? ' (lead)' : ''}`).join(', ') : <span className="text-muted-foreground">No members</span>}
                </TD>
                <TD className="text-right tabular-nums">{t._count.tickets}</TD>
                <TD><ActiveBadge active={t.isActive} /></TD>
                <TD className="whitespace-nowrap text-right">
                  <Button variant="ghost" size="icon" aria-label={`Manage members of ${t.name}`} onClick={() => setMembers(t)}><Users /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil /></Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {editing && <TeamDialog team={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {members && <MembersDialog team={members} onClose={() => setMembers(null)} />}
    </Card>
  );
}

function TeamDialog({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const depts = useDepartments();
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [email, setEmail] = useState(team?.email ?? '');
  const [departmentId, setDept] = useState(team?.departmentId ?? '');
  const [isActive, setActive] = useState(team?.isActive ?? true);
  const save = useSave([['teams']], team ? 'Team updated' : 'Team created', onClose);
  const emailOk = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{team ? 'Edit team' : 'New team'}</DialogTitle></DialogHeader>
        <Field label="Name" htmlFor="t-name" required><Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Department" htmlFor="t-dept" required><Select id="t-dept" value={departmentId} onValueChange={setDept} placeholder="Select department" options={(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))} /></Field>
        <Field label="Team email" htmlFor="t-email" error={emailOk ? undefined : 'Enter a valid email'}><Input id="t-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Description" htmlFor="t-desc"><Textarea id="t-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {team && <label className="flex items-center gap-2 text-sm"><Switch checked={isActive} onCheckedChange={setActive} /> Active</label>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={name.trim().length < 2 || !departmentId || !emailOk}
            loading={save.isPending}
            onClick={() => save.mutate({ method: team ? 'patch' : 'post', url: team ? `/teams/${team.id}` : '/teams', body: { name, departmentId, description: description || null, email: email || null, ...(team && { isActive }) } })}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MembersDialog({ team, onClose }: { team: Team; onClose: () => void }) {
  const staff = useStaff();
  const [list, setList] = useState(team.members.map((m) => ({ userId: m.userId, name: m.user.name, role: m.role })));
  const [adding, setAdding] = useState<string | null>(null);
  const save = useSave([['teams'], ['staff'], ['users']], 'Team members updated', onClose);
  const available = (staff.data ?? []).filter((u) => !list.some((m) => m.userId === u.id));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Members of {team.name}</DialogTitle>
          <DialogDescription>Team leads receive escalation and SLA notifications for the team.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Combobox className="flex-1" value={adding} onChange={setAdding} placeholder="Add staff member…" options={available.map((u) => ({ value: u.id, label: u.name, description: u.role.name }))} />
          <Button
            variant="outline"
            disabled={!adding}
            onClick={() => {
              const u = staff.data!.find((x) => x.id === adding)!;
              setList((l) => [...l, { userId: u.id, name: u.name, role: 'MEMBER' }]);
              setAdding(null);
            }}
          >
            Add
          </Button>
        </div>
        {list.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No members.</p> : (
          <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
            {list.map((m) => (
              <li key={m.userId} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1">{m.name}</span>
                <Select className="h-8 w-28" value={m.role} aria-label={`Role of ${m.name}`} onValueChange={(v) => setList((l) => l.map((x) => (x.userId === m.userId ? { ...x, role: (v || 'MEMBER') as 'MEMBER' | 'LEAD' } : x)))} options={[{ value: 'MEMBER', label: 'Member' }, { value: 'LEAD', label: 'Lead' }]} />
                <Button variant="ghost" size="icon" aria-label={`Remove ${m.name}`} onClick={() => setList((l) => l.filter((x) => x.userId !== m.userId))}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate({ method: 'put', url: `/teams/${team.id}/members`, body: { members: list.map(({ userId, role }) => ({ userId, role })) } })}>Save members</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Categories ─────────────
function CategoriesTab() {
  const cats = useCategories(true);
  const [editing, setEditing] = useState<{ category: Category | Category['children'][number] | null; parent: Category | null } | null>(null);
  if (cats.isError) return <ErrorState error={cats.error} onRetry={() => cats.refetch()} />;
  return (
    <Card>
      <div className="flex justify-end border-b p-3"><Button size="sm" onClick={() => setEditing({ category: null, parent: null })}><Plus /> Add category</Button></div>
      {cats.isLoading ? <Skeleton className="m-3 h-32" /> : !cats.data!.length ? <EmptyState title="No categories yet" /> : (
        <ul className="divide-y">
          {cats.data!.map((c) => (
            <li key={c.id} className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                <ActiveBadge active={c.isActive} />
                {c.defaultTeam && <span className="text-xs text-muted-foreground">→ routes to {c.defaultTeam.name}</span>}
                <div className="ml-auto flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ category: null, parent: c })}><Plus /> Subcategory</Button>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${c.name}`} onClick={() => setEditing({ category: c, parent: null })}><Pencil /></Button>
                </div>
              </div>
              {c.children.length > 0 && (
                <ul className="ml-4 mt-2 space-y-1 border-l pl-4">
                  {c.children.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-sm">
                      <span>{s.name}</span>
                      {!s.isActive && <Badge variant="secondary">Inactive</Badge>}
                      <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" aria-label={`Edit ${s.name}`} onClick={() => setEditing({ category: s, parent: c })}><Pencil /></Button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <CategoryDialog {...editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function CategoryDialog({ category, parent, onClose }: { category: Category | Category['children'][number] | null; parent: Category | null; onClose: () => void }) {
  const teams = useTeams();
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [defaultTeamId, setTeam] = useState<string | null>(category?.defaultTeamId ?? null);
  const [isActive, setActive] = useState(category?.isActive ?? true);
  const save = useSave([['categories']], category ? 'Category updated' : 'Category created', onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? 'Edit category' : parent ? `New subcategory of ${parent.name}` : 'New category'}</DialogTitle>
        </DialogHeader>
        <Field label="Name" htmlFor="c-name" required><Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description" htmlFor="c-desc"><Textarea id="c-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Default team" htmlFor="c-team" hint={parent ? 'Overrides the parent category’s team when set.' : 'New tickets in this category are routed here.'}>
          <Combobox id="c-team" value={defaultTeamId} onChange={setTeam} placeholder="No default team" options={(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
        </Field>
        {category && <label className="flex items-center gap-2 text-sm"><Switch checked={isActive} onCheckedChange={setActive} /> Active (inactive categories can’t be chosen for new tickets)</label>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={name.trim().length < 2}
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                category
                  ? { method: 'patch', url: `/categories/${category.id}`, body: { name, description: description || null, defaultTeamId, isActive } }
                  : { method: 'post', url: '/categories', body: { name, description: description || null, defaultTeamId, parentId: parent?.id ?? null } },
              )
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Tags ─────────────
function TagsTab() {
  const tags = useTags();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const create = useSave([['tags']], 'Tag created', () => setName(''));
  const remove = useSave([['tags']], 'Tag deleted');
  const valid = /^[a-z0-9][a-z0-9 _-]*$/i.test(name.trim());
  if (tags.isError) return <ErrorState error={tags.error} onRetry={() => tags.refetch()} />;
  return (
    <Card>
      <form
        className="flex flex-wrap items-end gap-2 border-b p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) create.mutate({ method: 'post', url: '/tags', body: { name: name.trim().toLowerCase(), color } });
        }}
      >
        <Field label="New tag" htmlFor="tag-name" className="flex-1"><Input id="tag-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. billing-dispute" maxLength={40} /></Field>
        <Field label="Color" htmlFor="tag-color"><Input id="tag-color" type="color" className="w-16 p-1" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
        <Button type="submit" disabled={!valid} loading={create.isPending}><Plus /> Add</Button>
      </form>
      {tags.isLoading ? <Skeleton className="m-3 h-24" /> : !tags.data!.length ? <EmptyState title="No tags yet" /> : (
        <ul className="flex flex-wrap gap-2 p-3">
          {tags.data!.map((t) => (
            <li key={t.id} className="flex items-center gap-1 rounded-md border py-1 pl-2 pr-1 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} aria-hidden />
              {t.name}
              <span className="text-xs text-muted-foreground">({t._count.tickets})</span>
              <ConfirmDialog
                trigger={<Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Delete tag ${t.name}`}><Trash2 className="!size-3.5" /></Button>}
                title={`Delete tag “${t.name}”?`}
                description={`It will be removed from ${t._count.tickets} ticket(s). Ticket history keeps a record of past tag changes.`}
                destructive
                confirmLabel="Delete tag"
                onConfirm={() => remove.mutateAsync({ method: 'delete', url: `/tags/${t.id}` })}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
