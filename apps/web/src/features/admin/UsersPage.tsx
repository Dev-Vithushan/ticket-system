import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MoreHorizontal, Pencil, Plus, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Avatar, EmptyState, ErrorState, PageHeader, Pagination } from '@/components/ui/misc';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SortableTH, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { useDepartments, useTeams } from '@/hooks/useLookups';
import { api, ApiError, errorMessage, type Page } from '@/lib/api';
import type { Role, UserRow } from '@/lib/types';
import { formatDate, relative } from '@/lib/utils';
import { passwordRule } from '@/lib/validation';

export function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ data: Role[] }>('/roles').then((r) => r.data) });
}

export function UsersPage() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'name' | 'email' | 'createdAt' | 'lastLoginAt'>('name');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const roles = useRoles();
  const query = { page, pageSize: 20, search: debounced, roleKey: role || undefined, isActive: status === '' ? undefined : status === 'active', sort, order };
  const users = useQuery({ queryKey: ['users', query], queryFn: () => api.get<Page<UserRow>>('/users', query), placeholderData: keepPreviousData });
  const setActive = async (u: UserRow, active: boolean) => {
    try {
      await api.post(`/users/${u.id}/${active ? 'activate' : 'deactivate'}`);
      toast.success(`${u.name} ${active ? 'reactivated' : 'deactivated'}`);
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const onSort = (k: typeof sort) => {
    setOrder(sort === k && order === 'asc' ? 'desc' : 'asc');
    setSort(k);
  };

  return (
    <div>
      <PageHeader title="Users" description="Manage staff and customer accounts, roles and team membership." actions={<Button onClick={() => setEditing('new')}><Plus /> Add user</Button>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Input className="w-full sm:w-64" placeholder="Search name, email, organization…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search users" />
          <Select className="w-44" value={role} onValueChange={(v) => { setRole(v); setPage(1); }} placeholder="All roles" aria-label="Role filter" options={(roles.data ?? []).map((r) => ({ value: r.key, label: r.name }))} />
          <Select className="w-36" value={status} onValueChange={(v) => { setStatus(v); setPage(1); }} placeholder="Any status" aria-label="Status filter" options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Deactivated' }]} />
        </div>
        {users.isError ? <ErrorState error={users.error} onRetry={() => users.refetch()} /> : users.isLoading ? <div className="space-y-2 p-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div> : !users.data!.data.length ? <EmptyState title="No users found" /> : (
          <>
            <Table>
              <THead>
                <tr>
                  <SortableTH label="Name" sortKey="name" sort={sort} order={order} onSort={onSort} />
                  <TH>Role</TH>
                  <TH>Teams</TH>
                  <TH>Status</TH>
                  <SortableTH label="Last login" sortKey="lastLoginAt" sort={sort} order={order} onSort={onSort} />
                  <SortableTH label="Created" sortKey="createdAt" sort={sort} order={order} onSort={onSort} />
                  <TH className="w-10"><span className="sr-only">Actions</span></TH>
                </tr>
              </THead>
              <TBody>
                {users.data!.data.map((u) => (
                  <TR key={u.id}>
                    <TD>
                      <div className="flex items-center gap-2">
                        <Avatar name={u.name} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{u.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{u.email}{u.organization ? ` · ${u.organization}` : ''}</p>
                        </div>
                      </div>
                    </TD>
                    <TD><Badge variant={u.role.isStaff ? 'default' : 'secondary'}>{u.role.name}</Badge></TD>
                    <TD className="max-w-[14rem] truncate text-sm">{u.teams.map((t) => `${t.name}${t.role === 'LEAD' ? ' (lead)' : ''}`).join(', ') || '—'}</TD>
                    <TD>{u.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="destructive">Deactivated</Badge>}</TD>
                    <TD className="whitespace-nowrap text-xs text-muted-foreground" title={formatDate(u.lastLoginAt)}>{u.lastLoginAt ? relative(u.lastLoginAt) : 'Never'}</TD>
                    <TD className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(u.createdAt, 'MMM d, yyyy')}</TD>
                    <TD>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${u.name}`}><MoreHorizontal /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(u)}><Pencil /> Edit</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setResetting(u)}><KeyRound /> Reset password</DropdownMenuItem>
                          {u.id !== me?.id && (u.isActive ? (
                            <ConfirmDialog
                              trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive"><UserX /> Deactivate</DropdownMenuItem>}
                              title={`Deactivate ${u.name}?`}
                              description="They will be signed out immediately and can no longer log in. Their tickets and history are preserved."
                              confirmLabel="Deactivate"
                              destructive
                              onConfirm={() => setActive(u, false)}
                            />
                          ) : (
                            <DropdownMenuItem onSelect={() => setActive(u, true)}><UserCheck /> Reactivate</DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination {...users.data!.meta} onPage={setPage} />
          </>
        )}
      </Card>
      {editing && <UserDialog user={editing === 'new' ? null : editing} roles={roles.data ?? []} onClose={() => setEditing(null)} />}
      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

const userSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(120),
  email: z.string().trim().email('Enter a valid email'),
  roleId: z.string().min(1, 'Select a role'),
  departmentId: z.string().optional(),
  jobTitle: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  organization: z.string().max(120).optional(),
  teamIds: z.array(z.string()),
  password: z.string().optional(),
});
type UserValues = z.infer<typeof userSchema>;

function UserDialog({ user, roles, onClose }: { user: UserRow | null; roles: Role[]; onClose: () => void }) {
  const qc = useQueryClient();
  const teams = useTeams();
  const departments = useDepartments();
  const { register, control, handleSubmit, watch, formState, setError } = useForm<UserValues>({
    resolver: zodResolver(
      user ? userSchema : userSchema.extend({ password: passwordRule }),
    ),
    defaultValues: {
      name: user?.name ?? '',
      email: user?.email ?? '',
      roleId: user?.role.id ?? roles.find((r) => r.key === 'CUSTOMER')?.id ?? '',
      departmentId: user?.department?.id ?? '',
      jobTitle: user?.jobTitle ?? '',
      phone: user?.phone ?? '',
      organization: user?.organization ?? '',
      teamIds: user?.teams.map((t) => t.id) ?? [],
      password: '',
    },
  });
  const isStaff = roles.find((r) => r.id === watch('roleId'))?.isStaff;
  const save = useMutation({
    mutationFn: (v: UserValues) => {
      const body = {
        name: v.name,
        email: v.email,
        roleId: v.roleId,
        departmentId: v.departmentId || null,
        jobTitle: v.jobTitle || null,
        phone: v.phone || null,
        organization: v.organization || null,
        teamIds: isStaff ? v.teamIds : [],
      };
      return user ? api.patch(`/users/${user.id}`, body) : api.post('/users', { ...body, password: v.password });
    },
    onSuccess: () => {
      toast.success(user ? 'User updated' : 'User created');
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['staff'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setError('email', { message: e.message });
      else toast.error(errorMessage(e));
    },
  });
  const e = formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{user ? `Edit ${user.name}` : 'Add user'}</DialogTitle>
          <DialogDescription>Role changes take effect immediately and sign the user out of other sessions.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={handleSubmit((v) => save.mutate(v))}>
          <Field label="Full name" htmlFor="u-name" error={e.name?.message} required><Input id="u-name" {...register('name')} aria-invalid={!!e.name} /></Field>
          <Field label="Email" htmlFor="u-email" error={e.email?.message} required><Input id="u-email" type="email" {...register('email')} aria-invalid={!!e.email} /></Field>
          <Field label="Role" htmlFor="u-role" error={e.roleId?.message} required>
            <Controller control={control} name="roleId" render={({ field }) => <Select id="u-role" value={field.value} onValueChange={field.onChange} placeholder="Select role" options={roles.map((r) => ({ value: r.id, label: r.name }))} />} />
          </Field>
          <Field label="Department" htmlFor="u-dept">
            <Controller control={control} name="departmentId" render={({ field }) => <Select id="u-dept" value={field.value ?? ''} onValueChange={field.onChange} placeholder="None" options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />} />
          </Field>
          {isStaff ? (
            <Field label="Teams" className="sm:col-span-2">
              <Controller control={control} name="teamIds" render={({ field }) => <MultiSelect label={field.value.length ? 'Teams' : 'Select teams'} value={field.value} onChange={field.onChange} options={(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />} />
            </Field>
          ) : (
            <Field label="Organization" htmlFor="u-org"><Input id="u-org" {...register('organization')} /></Field>
          )}
          <Field label="Job title" htmlFor="u-title"><Input id="u-title" {...register('jobTitle')} /></Field>
          <Field label="Phone" htmlFor="u-phone"><Input id="u-phone" type="tel" {...register('phone')} /></Field>
          {!user && (
            <Field label="Initial password" htmlFor="u-pass" error={e.password?.message} hint="10+ characters with upper, lower case and a digit. Share it securely." required>
              <Input id="u-pass" type="password" autoComplete="new-password" {...register('password')} aria-invalid={!!e.password} />
            </Field>
          )}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{user ? 'Save changes' : 'Create user'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { register, handleSubmit, formState } = useForm<{ password: string }>({ resolver: zodResolver(z.object({ password: passwordRule })) });
  const save = useMutation({
    mutationFn: (v: { password: string }) => api.post(`/users/${user.id}/reset-password`, v),
    onSuccess: () => {
      toast.success('Password reset; the user’s sessions were revoked');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password for {user.name}</DialogTitle>
          <DialogDescription>All of the user’s active sessions will be signed out.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" noValidate onSubmit={handleSubmit((v) => save.mutate(v))}>
          <Field label="New password" htmlFor="rp" error={formState.errors.password?.message} required>
            <Input id="rp" type="password" autoComplete="new-password" {...register('password')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>Reset password</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
