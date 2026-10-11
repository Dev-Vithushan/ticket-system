import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Star, Timer, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/tickets/badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { api, errorMessage } from '@/lib/api';
import type { TicketDetail } from '@/lib/types';
import { cn, formatDate, formatDuration } from '@/lib/utils';
import { useTicketMutation } from '../TicketDetailPage';

export function RelatedTab({ ticket }: { ticket: TicketDetail }) {
  const caps = ticket.capabilities;
  return (
    <div className="space-y-4">
      <RelatedTickets ticket={ticket} />
      {caps.canLogTime && <TimeTracking ticket={ticket} />}
      {(ticket.feedback || caps.canRate) && <Feedback ticket={ticket} />}
    </div>
  );
}

function RelatedTickets({ ticket }: { ticket: TicketDetail }) {
  const [ref, setRef] = useState('');
  const opts = useTicketMutation(ticket.id);
  const link = useMutation({ mutationFn: () => api.post<{ data: TicketDetail }>(`/tickets/${ticket.id}/links`, { ticket: ref.trim() }), ...opts('Ticket linked') });
  const unlink = useMutation({ mutationFn: (other: string) => api.delete<{ data: TicketDetail }>(`/tickets/${ticket.id}/links/${other}`), ...opts('Link removed') });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-4 w-4" /> Related tickets
        </CardTitle>
        <CardDescription>Duplicates, follow-ups and tickets caused by the same incident.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {ticket.related.length === 0 ? (
          <p className="text-sm text-muted-foreground">No related tickets.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {ticket.related.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <Link to={`/tickets/${r.id}`} className="font-mono text-xs text-primary hover:underline">
                  {r.number}
                </Link>
                <span className="min-w-0 flex-1 truncate">{r.subject}</span>
                <StatusBadge status={r.status} />
                {ticket.capabilities.canLink && (
                  <Button variant="ghost" size="icon" aria-label={`Unlink ${r.number}`} onClick={() => unlink.mutate(r.id)}>
                    <X />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {ticket.capabilities.canLink && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (ref.trim()) link.mutate(undefined, { onSuccess: () => setRef('') });
            }}
          >
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Ticket number, e.g. TKT-2026-00042" aria-label="Ticket number to link" />
            <Button type="submit" variant="outline" disabled={!ref.trim()} loading={link.isPending}>
              Link
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

interface TimeEntry {
  id: string;
  minutes: number;
  note: string | null;
  workDate: string;
  user: { id: string; name: string };
}

function TimeTracking({ ticket }: { ticket: TicketDetail }) {
  const qc = useQueryClient();
  const entries = useQuery({
    queryKey: ['ticket', ticket.id, 'time'],
    queryFn: () => api.get<{ data: TimeEntry[] }>(`/tickets/${ticket.id}/time-entries`).then((r) => r.data),
  });
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const n = Number(minutes);
  const valid = Number.isInteger(n) && n >= 1 && n <= 1440;
  const log = useMutation({
    mutationFn: () => api.post(`/tickets/${ticket.id}/time-entries`, { minutes: n, note: note.trim() || undefined }),
    onSuccess: () => {
      toast.success('Time logged');
      setMinutes('');
      setNote('');
      qc.invalidateQueries({ queryKey: ['ticket', ticket.id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Timer className="h-4 w-4" /> Time tracking
        </CardTitle>
        <CardDescription>Total logged: {formatDuration(ticket.timeSpentMinutes ?? 0)} · internal only</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="grid gap-2 sm:grid-cols-[8rem_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) log.mutate();
          }}
        >
          <Input type="number" min={1} max={1440} inputMode="numeric" placeholder="Minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutes spent" aria-invalid={minutes !== '' && !valid} />
          <Input placeholder="What did you work on? (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} aria-label="Time entry note" />
          <Button type="submit" variant="outline" disabled={!valid} loading={log.isPending}>
            Log time
          </Button>
        </form>
        {entries.data && entries.data.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {entries.data.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 px-3 py-2">
                <span className="w-16 font-medium tabular-nums">{formatDuration(e.minutes)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.note ?? '—'}</span>
                <span className="text-xs text-muted-foreground">
                  {e.user.name} · {formatDate(e.workDate, 'MMM d')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Feedback({ ticket }: { ticket: TicketDetail }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const qc = useQueryClient();
  const submit = useMutation({
    mutationFn: () => api.post(`/tickets/${ticket.id}/feedback`, { rating, comment: comment.trim() || undefined }),
    onSuccess: () => {
      toast.success('Thanks for your feedback!');
      qc.invalidateQueries({ queryKey: ['ticket', ticket.id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (ticket.feedback) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Customer satisfaction</CardTitle>
        </CardHeader>
        <CardContent>
          <Stars value={ticket.feedback.rating} />
          {ticket.feedback.comment && <p className="mt-2 text-sm">“{ticket.feedback.comment}”</p>}
          <p className="mt-1 text-xs text-muted-foreground">Submitted {formatDate(ticket.feedback.createdAt)}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>How did we do?</CardTitle>
        <CardDescription>Rate the support you received on this ticket.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div role="radiogroup" aria-label="Rating" className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setRating(n)} className="rounded p-1 hover:bg-accent">
              <Star className={cn('h-6 w-6', n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground')} />
            </button>
          ))}
        </div>
        <Field label="Comments (optional)" htmlFor="fb-comment">
          <Textarea id="fb-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
        </Field>
        <Button disabled={!rating} loading={submit.isPending} onClick={() => submit.mutate()}>
          Submit feedback
        </Button>
      </CardContent>
    </Card>
  );
}

export function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn('h-4 w-4', n <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} aria-hidden />
      ))}
    </span>
  );
}
