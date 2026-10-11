import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Lock, MessageSquare, Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FilePicker } from '@/components/tickets/FilePicker';
import { STATUS_LABEL } from '@/components/tickets/badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { Avatar, EmptyState, ErrorState } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { api, errorMessage } from '@/lib/api';
import type { Attachment, Comment, TicketDetail, TicketStatus } from '@/lib/types';
import { cn, formatBytes, formatDate, relative } from '@/lib/utils';

export function downloadAttachment(ticketId: string, a: Attachment) {
  api.download(`/tickets/${ticketId}/attachments/${a.id}/download`).catch((e) => toast.error(errorMessage(e)));
}

export function ConversationTab({ ticket }: { ticket: TicketDetail }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const caps = ticket.capabilities;
  const isRequester = ticket.requester.id === user?.id;
  const comments = useQuery({
    queryKey: ['ticket', ticket.id, 'comments'],
    queryFn: () => api.get<{ data: Comment[] }>(`/tickets/${ticket.id}/comments`).then((r) => r.data),
  });
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [nextStatus, setNextStatus] = useState<TicketStatus | ''>('');

  const send = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('body', body);
      fd.append('isInternal', String(internal));
      if (nextStatus) fd.append('status', nextStatus);
      files.forEach((f) => fd.append('files', f));
      return api.post(`/tickets/${ticket.id}/comments`, fd);
    },
    onSuccess: () => {
      toast.success(internal ? 'Internal note added' : 'Reply sent');
      setBody('');
      setFiles([]);
      setNextStatus('');
      qc.invalidateQueries({ queryKey: ['ticket', ticket.id] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const replyStatuses = ticket.capabilities.allowedTransitions.filter((s) => s === 'PENDING_CUSTOMER' || s === 'IN_PROGRESS');
  const canWrite = caps.canReply || caps.canAddInternalNote;

  return (
    <div className="space-y-4">
      {comments.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : comments.isError ? (
        <ErrorState error={comments.error} onRetry={() => comments.refetch()} />
      ) : comments.data!.length === 0 ? (
        <Card>
          <EmptyState icon={MessageSquare} title="No messages yet" description="Replies from the support team and the requester will appear here." />
        </Card>
      ) : (
        <ol className="space-y-3" aria-label="Conversation">
          {comments.data!.map((c) => (
            <li key={c.id}>
              <article
                className={cn(
                  'rounded-lg border p-4',
                  c.isInternal ? 'border-amber-400/60 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10' : c.author.isStaff ? 'bg-card' : 'bg-muted/40',
                )}
                aria-label={c.isInternal ? 'Internal note' : 'Public reply'}
              >
                <header className="mb-2 flex flex-wrap items-center gap-2">
                  <Avatar name={c.author.name} className="h-7 w-7" />
                  <span className="text-sm font-medium">{c.author.name}</span>
                  <span className="text-xs text-muted-foreground">{c.author.roleName}</span>
                  {c.isInternal && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-200/70 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                      <Lock className="h-3 w-3" /> Internal note — not visible to requester
                    </span>
                  )}
                  <time className="ml-auto text-xs text-muted-foreground" dateTime={c.createdAt} title={formatDate(c.createdAt)}>
                    {relative(c.createdAt)}
                  </time>
                </header>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{c.body}</p>
                {c.attachments.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {c.attachments.map((a) => (
                      <li key={a.id}>
                        <button type="button" onClick={() => downloadAttachment(ticket.id, a)} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent">
                          <Download className="h-3.5 w-3.5" /> {a.originalName} <span className="text-muted-foreground">({formatBytes(a.size)})</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </li>
          ))}
        </ol>
      )}

      {canWrite ? (
        <Card className={cn(internal && 'border-amber-400/60')}>
          <CardContent className="space-y-3 p-4 pt-4 sm:p-4 sm:pt-4">
            {caps.canAddInternalNote && (
              <div className="inline-flex rounded-md border p-0.5 text-sm" role="radiogroup" aria-label="Message type">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!internal}
                  disabled={!caps.canReply}
                  onClick={() => setInternal(false)}
                  className={cn('rounded px-3 py-1 font-medium disabled:opacity-50', !internal ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
                >
                  Public reply
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={internal}
                  onClick={() => setInternal(true)}
                  className={cn('inline-flex items-center gap-1 rounded px-3 py-1 font-medium', internal ? 'bg-amber-500 text-white' : 'text-muted-foreground')}
                >
                  <Lock className="h-3.5 w-3.5" /> Internal note
                </button>
              </div>
            )}
            <label htmlFor="reply" className="sr-only">
              {internal ? 'Internal note' : 'Reply'}
            </label>
            <Textarea
              id="reply"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={internal ? 'Visible to support staff only…' : isRequester ? 'Write a message to the support team…' : 'Write a reply to the requester…'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) send.mutate();
              }}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              {caps.canAttach ? <FilePicker files={files} onChange={setFiles} /> : <span />}
              <div className="flex flex-wrap items-center gap-2">
                {!internal && replyStatuses.length > 0 && (
                  <Select
                    className="w-52"
                    aria-label="Set status with reply"
                    value={nextStatus}
                    onValueChange={(v) => setNextStatus(v as TicketStatus)}
                    placeholder="Keep current status"
                    options={replyStatuses.map((s) => ({ value: s, label: `Set to ${STATUS_LABEL[s]}` }))}
                  />
                )}
                <Button disabled={!body.trim()} loading={send.isPending} onClick={() => send.mutate()} className={cn(internal && 'bg-amber-600 hover:bg-amber-600/90')}>
                  <Send /> {internal ? 'Add note' : 'Send reply'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          This ticket is {ticket.status === 'CLOSED' ? 'closed' : 'not accepting replies'}.{ticket.capabilities.canReopen ? ' Reopen it to continue the conversation.' : ''}
        </p>
      )}
    </div>
  );
}
