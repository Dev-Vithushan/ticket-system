import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Hand, Pencil, RotateCcw, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PriorityBadge, STATUS_LABEL, StatusBadge } from '@/components/tickets/badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ErrorState } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { TicketDetail, TicketStatus } from '@/lib/types';
import { formatDate, relative } from '@/lib/utils';
import { ActivityTab } from './detail/ActivityTab';
import { AttachmentsTab } from './detail/AttachmentsTab';
import { ConversationTab } from './detail/ConversationTab';
import { EditTicketDialog } from './detail/EditTicketDialog';
import { RelatedTab } from './detail/RelatedTab';
import { TicketSidebar } from './detail/TicketSidebar';

export function useTicketMutation(ticketId: string) {
  const qc = useQueryClient();
  return (successMessage?: string) => ({
    onSuccess: (res: unknown) => {
      const data = (res as { data?: TicketDetail })?.data;
      if (data && 'capabilities' in data) qc.setQueryData(['ticket', ticketId], data);
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      if (successMessage) toast.success(successMessage);
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
}

export function TicketDetailPage() {
  const { id = '' } = useParams();
  const ticket = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.get<{ data: TicketDetail }>(`/tickets/${id}`).then((r) => r.data),
  });

  if (ticket.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading ticket">
        <Skeleton className="h-8 w-2/3" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }
  if (ticket.isError) {
    const notFound = ticket.error instanceof ApiError && ticket.error.status === 404;
    return (
      <Card>
        {notFound ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Ticket not found</p>
            <p className="text-sm text-muted-foreground">It doesn’t exist or you don’t have access to it.</p>
            <Button asChild variant="outline" className="mt-2">
              <Link to="/tickets">Back to tickets</Link>
            </Button>
          </div>
        ) : (
          <ErrorState error={ticket.error} onRetry={() => ticket.refetch()} />
        )}
      </Card>
    );
  }
  const t = ticket.data!;
  return <TicketView t={t} />;
}

function TicketView({ t }: { t: TicketDetail }) {
  const caps = t.capabilities;
  const opts = useTicketMutation(t.id);
  const [statusTarget, setStatusTarget] = useState<TicketStatus | null>(null);
  const [notes, setNotes] = useState(t.resolutionNotes ?? '');
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [editOpen, setEditOpen] = useState(false);

  const status = useMutation({
    mutationFn: (body: { status: TicketStatus; resolutionNotes?: string }) => api.post<{ data: TicketDetail }>(`/tickets/${t.id}/status`, body),
    ...opts('Status updated'),
  });
  const accept = useMutation({ mutationFn: () => api.post<{ data: TicketDetail }>(`/tickets/${t.id}/accept`), ...opts('Ticket accepted') });
  const escalate = useMutation({ mutationFn: () => api.post<{ data: TicketDetail }>(`/tickets/${t.id}/escalate`, { reason }), ...opts('Ticket escalated') });
  const reopen = useMutation({ mutationFn: () => api.post<{ data: TicketDetail }>(`/tickets/${t.id}/reopen`, { reason }), ...opts('Ticket reopened') });

  const needsNotes = (s: TicketStatus) => s === 'RESOLVED' || (s === 'CLOSED' && t.status !== 'RESOLVED');
  const pickStatus = (s: TicketStatus) => {
    if (s === 'ESCALATED') return setEscalateOpen(true);
    if (needsNotes(s)) {
      setStatusTarget(s);
      setNotes(t.resolutionNotes ?? '');
    } else status.mutate({ status: s });
  };

  return (
    <div>
      <div className="mb-4">
        <Link to="/tickets" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Tickets
        </Link>
      </div>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-muted-foreground">{t.number}</span>
            <StatusBadge status={t.status} />
            <PriorityBadge priority={t.priority} />
            {t.escalationLevel > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> Escalation level {t.escalationLevel}
              </span>
            )}
            {t.reopenCount > 0 && <span className="text-xs text-muted-foreground">Reopened {t.reopenCount}×</span>}
          </div>
          <h1 className="mt-1 break-words text-xl font-semibold tracking-tight">{t.subject}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Opened by {t.requester.name} {relative(t.createdAt)} · updated {relative(t.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {caps.canAccept && (
            <Button variant="outline" loading={accept.isPending} onClick={() => accept.mutate()}>
              <Hand /> Accept
            </Button>
          )}
          {caps.canEdit && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil /> Edit
            </Button>
          )}
          {caps.canEscalate && (
            <Button variant="outline" onClick={() => setEscalateOpen(true)}>
              <AlertTriangle /> Escalate
            </Button>
          )}
          {caps.canReopen && (
            <Button variant="outline" onClick={() => { setReason(''); setReopenOpen(true); }}>
              <RotateCcw /> Reopen
            </Button>
          )}
          {caps.allowedTransitions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button loading={status.isPending}>
                  {caps.allowedTransitions.includes('RESOLVED') ? <CheckCircle2 /> : null}
                  Change status <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {caps.allowedTransitions.map((s) => (
                  <DropdownMenuItem key={s} onSelect={() => pickStatus(s)}>
                    <StatusBadge status={s} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{t.description}</p>
            </CardContent>
          </Card>
          {t.resolutionNotes && ['RESOLVED', 'CLOSED'].includes(t.status) && (
            <Card className="border-success/40 bg-success/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="h-4 w-4" /> Resolution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{t.resolutionNotes}</p>
                <p className="mt-2 text-xs text-muted-foreground">Resolved {formatDate(t.resolvedAt)}{t.closedAt ? ` · closed ${formatDate(t.closedAt)}` : ''}</p>
              </CardContent>
            </Card>
          )}
          <Tabs defaultValue="conversation">
            <TabsList>
              <TabsTrigger value="conversation">Conversation ({t.counts.comments})</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="attachments">Attachments ({t.counts.attachments})</TabsTrigger>
              <TabsTrigger value="related">Related & time</TabsTrigger>
            </TabsList>
            <TabsContent value="conversation">
              <ConversationTab ticket={t} />
            </TabsContent>
            <TabsContent value="activity">
              <ActivityTab ticket={t} />
            </TabsContent>
            <TabsContent value="attachments">
              <AttachmentsTab ticket={t} />
            </TabsContent>
            <TabsContent value="related">
              <RelatedTab ticket={t} />
            </TabsContent>
          </Tabs>
        </div>
        <TicketSidebar ticket={t} />
      </div>

      <Dialog open={!!statusTarget} onOpenChange={(o) => !o && setStatusTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{statusTarget === 'CLOSED' ? 'Close ticket' : 'Resolve ticket'}</DialogTitle>
            <DialogDescription>Resolution notes are shared with the requester and kept with the ticket history.</DialogDescription>
          </DialogHeader>
          <Field label="Resolution notes" htmlFor="resolution" required>
            <Textarea id="resolution" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was the cause and how was it fixed?" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={!notes.trim()}
              loading={status.isPending}
              onClick={() => status.mutate({ status: statusTarget!, resolutionNotes: notes }, { onSuccess: () => setStatusTarget(null) })}
            >
              Mark as {STATUS_LABEL[statusTarget ?? 'RESOLVED'].toLowerCase()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={escalateOpen}
        onOpenChange={setEscalateOpen}
        title="Escalate ticket"
        description="Escalation notifies team leads and managers. The reason is recorded as an internal note."
        reason={reason}
        setReason={setReason}
        loading={escalate.isPending}
        confirm="Escalate"
        onConfirm={() => escalate.mutate(undefined, { onSuccess: () => { setEscalateOpen(false); setReason(''); } })}
      />
      <ReasonDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        title="Reopen ticket"
        description="Tell the support team why the issue isn’t resolved. This message is added to the conversation."
        reason={reason}
        setReason={setReason}
        loading={reopen.isPending}
        confirm="Reopen ticket"
        onConfirm={() => reopen.mutate(undefined, { onSuccess: () => { setReopenOpen(false); setReason(''); } })}
      />
      {caps.canEdit && <EditTicketDialog ticket={t} open={editOpen} onOpenChange={setEditOpen} />}
    </div>
  );
}

function ReasonDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  reason: string;
  setReason: (s: string) => void;
  loading: boolean;
  confirm: string;
  onConfirm: () => void;
}) {
  const valid = props.reason.trim().length >= 5;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <Field label="Reason" htmlFor="reason" hint="At least 5 characters" required>
          <Textarea id="reason" rows={4} value={props.reason} onChange={(e) => props.setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid} loading={props.loading} onClick={props.onConfirm}>
            {props.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
