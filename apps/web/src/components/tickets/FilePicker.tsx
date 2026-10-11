import { Paperclip, X } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/hooks/useSettings';
import { formatBytes } from '@/lib/utils';
import { toast } from 'sonner';

const EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg,.jpeg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt,.log,.md',
  'text/csv': '.csv',
  'application/zip': '.zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

/** Client-side pre-check of size/type (the server re-validates content). */
export function FilePicker({ files, onChange, max = 5, disabled }: { files: File[]; onChange: (f: File[]) => void; max?: number; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const settings = useSettings();
  const maxBytes = (settings.data?.maxAttachmentMb ?? 10) * 1024 * 1024;
  const accept = (settings.data?.allowedAttachmentTypes ?? Object.keys(EXT)).map((t) => [t, EXT[t]].filter(Boolean).join(',')).join(',');

  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > maxBytes) {
        toast.error(`${f.name} is larger than ${settings.data?.maxAttachmentMb ?? 10} MB`);
        continue;
      }
      if (next.length >= max) {
        toast.error(`You can attach up to ${max} files at a time`);
        break;
      }
      next.push(f);
    }
    onChange(next);
    if (ref.current) ref.current.value = '';
  };

  return (
    <div className="space-y-2">
      <input ref={ref} type="file" multiple hidden accept={accept} onChange={(e) => add(e.target.files)} aria-label="Attach files" />
      <Button type="button" variant="outline" size="sm" onClick={() => ref.current?.click()} disabled={disabled || files.length >= max}>
        <Paperclip /> Attach files
      </Button>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm">
              <span className="truncate">{f.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {formatBytes(f.size)}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))} className="rounded p-0.5 hover:bg-accent">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Up to {max} files, {settings.data?.maxAttachmentMb ?? 10} MB each. Images, PDF, text, CSV, ZIP and Office documents.</p>
    </div>
  );
}
