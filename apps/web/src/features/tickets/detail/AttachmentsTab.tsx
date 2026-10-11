import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileIcon, Lock, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FilePicker } from '@/components/tickets/FilePicker';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState, ErrorState } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { api, errorMessage } from '@/lib/api';
import type { Attachment, TicketDetail } from '@/lib/types';
import { formatBytes, formatDate } from '@/lib/utils';
import { downloadAttachment } from './ConversationTab';

export function AttachmentsTab({ ticket }: { ticket: TicketDetail }) {
  const qc = useQueryClient();
  const { user, can } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const list = useQuery({
    queryKey: ['ticket', ticket.id, 'attachments'],
    queryFn: () => api.get<{ data: Attachment[] }>(`/tickets/${ticket.id}/attachments`).then((r) => r.data),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ticket', ticket.id] });
  };
  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      return api.post(`/tickets/${ticket.id}/attachments`, fd);
    },
    onSuccess: () => {
      toast.success('Files uploaded');
      setFiles([]);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = async (a: Attachment) => {
    try {
      await api.delete(`/tickets/${ticket.id}/attachments/${a.id}`);
      toast.success('Attachment removed');
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      {ticket.capabilities.canAttach && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
          <FilePicker files={files} onChange={setFiles} />
          <Button disabled={!files.length} loading={upload.isPending} onClick={() => upload.mutate()}>
            <Upload /> Upload
          </Button>
        </Card>
      )}
      {list.isLoading ? (
        <Skeleton className="h-32" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data!.length === 0 ? (
        <Card>
          <EmptyState icon={FileIcon} title="No attachments" description="Screenshots, logs and documents attached to this ticket appear here." />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y">
            {list.data!.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <FileIcon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {a.originalName} {a.isInternal && <Lock className="ml-1 inline h-3 w-3 text-amber-600" aria-label="internal" />}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(a.size)} · {a.uploadedBy.name} · {formatDate(a.createdAt)}
                  </p>
                </div>
                <Button variant="ghost" size="icon" aria-label={`Download ${a.originalName}`} onClick={() => downloadAttachment(ticket.id, a)}>
                  <Download />
                </Button>
                {ticket.status !== 'CLOSED' && (a.uploadedBy.id === user?.id || (user?.role.isStaff && can('ticket.update'))) && (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={`Remove ${a.originalName}`}>
                        <Trash2 />
                      </Button>
                    }
                    title="Remove attachment?"
                    description={`“${a.originalName}” will be removed from the ticket. The removal is recorded in the ticket history.`}
                    confirmLabel="Remove"
                    destructive
                    onConfirm={() => remove(a)}
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
