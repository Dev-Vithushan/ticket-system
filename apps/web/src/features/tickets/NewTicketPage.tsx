import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { FilePicker } from '@/components/tickets/FilePicker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/misc';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select } from '@/components/ui/select';
import { P, useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { useCategories, useStaff, useTags, useTeams } from '@/hooks/useLookups';
import { api, ApiError, errorMessage, type Page } from '@/lib/api';
import { PRIORITIES, SOURCES, type TicketDetail, type UserRow } from '@/lib/types';
import { humanize } from '@/lib/utils';

const schema = z.object({
  subject: z.string().trim().min(5, 'Subject must be at least 5 characters').max(200),
  description: z.string().trim().min(10, 'Please describe the issue (at least 10 characters)').max(20000),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  categoryId: z.string().nullable(),
  subcategoryId: z.string().nullable(),
  requesterId: z.string().nullable(),
  source: z.enum(['WEB', 'EMAIL', 'PHONE', 'INTERNAL']),
  teamId: z.string().nullable(),
  assigneeId: z.string().nullable(),
  tagIds: z.array(z.string()),
  dueAt: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export function NewTicketPage() {
  const { user, can } = useAuth();
  const staff = !!user?.role.isStaff;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const categories = useCategories();
  const teams = useTeams();
  const agents = useStaff();
  const tags = useTags();
  const [files, setFiles] = useState<File[]>([]);
  const [requesterSearch, setRequesterSearch] = useState('');
  const debouncedReq = useDebounce(requesterSearch, 300);
  const requesters = useQuery({
    queryKey: ['requesters', debouncedReq],
    queryFn: () => api.get<Page<UserRow>>('/users', { search: debouncedReq, isActive: true, pageSize: 20 }).then((r) => r.data),
    enabled: can(P.TICKET_CREATE_ON_BEHALF),
  });

  const { register, handleSubmit, control, watch, setValue, formState, setError } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { priority: 'MEDIUM', categoryId: null, subcategoryId: null, requesterId: null, source: staff ? 'PHONE' : 'WEB', teamId: null, assigneeId: null, tagIds: [] },
  });
  const categoryId = watch('categoryId');
  const teamId = watch('teamId');
  const subs = categories.data?.find((c) => c.id === categoryId)?.children ?? [];
  const e = formState.errors;

  const onSubmit = handleSubmit(async (v) => {
    try {
      const res = await api.post<{ data: TicketDetail }>('/tickets', {
        subject: v.subject,
        description: v.description,
        priority: v.priority,
        categoryId: v.categoryId,
        subcategoryId: v.subcategoryId,
        ...(staff && {
          requesterId: v.requesterId ?? undefined,
          source: v.source,
          teamId: v.teamId,
          assigneeId: v.assigneeId,
          tagIds: v.tagIds,
          dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : null,
        }),
      });
      const ticket = res.data;
      if (files.length) {
        const fd = new FormData();
        files.forEach((f) => fd.append('files', f));
        try {
          await api.post(`/tickets/${ticket.id}/attachments`, fd);
        } catch (err) {
          toast.error(`Ticket created, but attachments failed: ${errorMessage(err)}`);
        }
      }
      toast.success(`Ticket ${ticket.number} created`);
      qc.invalidateQueries({ queryKey: ['tickets'] });
      navigate(`/tickets/${ticket.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.details?.fieldErrors) {
        for (const [k, msgs] of Object.entries(err.details.fieldErrors)) setError(k as keyof Values, { message: msgs[0] });
      }
      toast.error(errorMessage(err));
    }
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New ticket" description={staff ? 'Log a request on behalf of a customer or colleague.' : 'Tell us what you need help with. We’ll get back to you as soon as possible.'} />
      <form onSubmit={onSubmit} noValidate className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Request details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Subject" htmlFor="subject" error={e.subject?.message} required>
              <Input id="subject" placeholder="Short summary of the issue" {...register('subject')} aria-invalid={!!e.subject} />
            </Field>
            <Field label="Description" htmlFor="description" error={e.description?.message} hint="Include steps to reproduce, error messages and business impact." required>
              <Textarea id="description" rows={9} {...register('description')} aria-invalid={!!e.description} />
            </Field>
            <Field label="Attachments">
              <FilePicker files={files} onChange={setFiles} />
            </Field>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Classification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Priority" htmlFor="priority" required>
                <Controller control={control} name="priority" render={({ field }) => <Select id="priority" value={field.value} onValueChange={(v) => field.onChange(v || 'MEDIUM')} options={PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />} />
              </Field>
              <Field label="Category" htmlFor="category" error={e.categoryId?.message}>
                <Controller
                  control={control}
                  name="categoryId"
                  render={({ field }) => (
                    <Combobox
                      id="category"
                      value={field.value}
                      onChange={(v) => {
                        field.onChange(v);
                        setValue('subcategoryId', null);
                      }}
                      placeholder="Select a category"
                      options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name, description: c.description ?? undefined }))}
                    />
                  )}
                />
              </Field>
              {subs.length > 0 && (
                <Field label="Subcategory" htmlFor="subcategory" error={e.subcategoryId?.message}>
                  <Controller control={control} name="subcategoryId" render={({ field }) => <Combobox id="subcategory" value={field.value} onChange={field.onChange} placeholder="Select a subcategory" options={subs.map((s) => ({ value: s.id, label: s.name }))} />} />
                </Field>
              )}
            </CardContent>
          </Card>

          {staff && (
            <Card>
              <CardHeader>
                <CardTitle>Routing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {can(P.TICKET_CREATE_ON_BEHALF) && (
                  <Field label="Requester" htmlFor="requester" hint="Leave empty to raise the ticket as yourself.">
                    <Controller
                      control={control}
                      name="requesterId"
                      render={({ field }) => (
                        <Combobox
                          id="requester"
                          value={field.value}
                          onChange={field.onChange}
                          onSearch={setRequesterSearch}
                          loading={requesters.isFetching}
                          placeholder="Search people…"
                          options={(requesters.data ?? []).map((u) => ({ value: u.id, label: u.name, description: [u.email, u.organization].filter(Boolean).join(' · ') }))}
                        />
                      )}
                    />
                  </Field>
                )}
                <Field label="Source" htmlFor="source">
                  <Controller control={control} name="source" render={({ field }) => <Select id="source" value={field.value} onValueChange={(v) => field.onChange(v || 'PHONE')} options={SOURCES.map((s) => ({ value: s, label: humanize(s) }))} />} />
                </Field>
                <Field label="Team" htmlFor="team" hint="Defaults to the category’s team.">
                  <Controller control={control} name="teamId" render={({ field }) => <Combobox id="team" value={field.value} onChange={(v) => { field.onChange(v); setValue('assigneeId', null); }} placeholder="Auto-route" options={(teams.data ?? []).map((t) => ({ value: t.id, label: t.name, description: t.department.name }))} />} />
                </Field>
                {(can(P.TICKET_ASSIGN) || can('ticket.accept')) && (
                  <Field label="Assignee" htmlFor="assignee">
                    <Controller
                      control={control}
                      name="assigneeId"
                      render={({ field }) => (
                        <Combobox
                          id="assignee"
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Unassigned"
                          options={(agents.data ?? [])
                            .filter((a) => (can(P.TICKET_ASSIGN) ? true : a.id === user!.id))
                            .filter((a) => !teamId || a.teams.some((t) => t.id === teamId))
                            .map((a) => ({ value: a.id, label: a.name, description: a.teams.map((t) => t.name).join(', ') }))}
                        />
                      )}
                    />
                  </Field>
                )}
                <Field label="Tags">
                  <Controller control={control} name="tagIds" render={({ field }) => <MultiSelect label={field.value.length ? 'Tags' : 'Add tags'} value={field.value} onChange={field.onChange} options={(tags.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />} />
                </Field>
                <Field label="Due date" htmlFor="dueAt" hint="Optional internal deadline in addition to the SLA.">
                  <Input id="dueAt" type="datetime-local" {...register('dueAt')} />
                </Field>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={formState.isSubmitting}>
              Submit ticket
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
