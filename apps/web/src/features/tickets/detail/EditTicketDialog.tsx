import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { MultiSelect } from '@/components/ui/multi-select';
import { useCategories, useTags } from '@/hooks/useLookups';
import { api } from '@/lib/api';
import type { TicketDetail } from '@/lib/types';
import { useTicketMutation } from '../TicketDetailPage';

const schema = z.object({
  subject: z.string().trim().min(5, 'At least 5 characters').max(200),
  description: z.string().trim().min(10, 'At least 10 characters').max(20000),
  categoryId: z.string().nullable(),
  subcategoryId: z.string().nullable(),
  tagIds: z.array(z.string()),
  dueAt: z.string().optional(),
});
type Values = z.infer<typeof schema>;

const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export function EditTicketDialog({ ticket, open, onOpenChange }: { ticket: TicketDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const categories = useCategories();
  const tags = useTags();
  const opts = useTicketMutation(ticket.id);
  const { register, control, handleSubmit, watch, setValue, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      subject: ticket.subject,
      description: ticket.description,
      categoryId: ticket.category?.id ?? null,
      subcategoryId: ticket.subcategory?.id ?? null,
      tagIds: ticket.tags.map((t) => t.id),
      dueAt: toLocalInput(ticket.dueAt),
    },
  });
  const save = useMutation({
    mutationFn: (v: Values) =>
      api.patch<{ data: TicketDetail }>(`/tickets/${ticket.id}`, { ...v, dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : null }),
    ...opts('Ticket updated'),
  });
  const subs = categories.data?.find((c) => c.id === watch('categoryId'))?.children ?? [];
  const e = formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {ticket.number}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" noValidate onSubmit={handleSubmit((v) => save.mutate(v, { onSuccess: () => onOpenChange(false) }))}>
          <Field label="Subject" htmlFor="e-subject" error={e.subject?.message} required>
            <Input id="e-subject" {...register('subject')} aria-invalid={!!e.subject} />
          </Field>
          <Field label="Description" htmlFor="e-desc" error={e.description?.message} required>
            <Textarea id="e-desc" rows={6} {...register('description')} aria-invalid={!!e.description} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="e-cat">
              <Controller control={control} name="categoryId" render={({ field }) => <Combobox id="e-cat" value={field.value} onChange={(v) => { field.onChange(v); setValue('subcategoryId', null); }} options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} placeholder="None" />} />
            </Field>
            <Field label="Subcategory" htmlFor="e-sub">
              <Controller control={control} name="subcategoryId" render={({ field }) => <Combobox id="e-sub" value={field.value} onChange={field.onChange} options={subs.map((s) => ({ value: s.id, label: s.name }))} placeholder="None" disabled={!subs.length} />} />
            </Field>
            <Field label="Tags">
              <Controller control={control} name="tagIds" render={({ field }) => <MultiSelect label="Tags" value={field.value} onChange={field.onChange} options={(tags.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />} />
            </Field>
            <Field label="Due date" htmlFor="e-due">
              <Input id="e-due" type="datetime-local" {...register('dueAt')} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
