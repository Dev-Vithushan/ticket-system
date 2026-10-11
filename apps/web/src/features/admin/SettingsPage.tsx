import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ErrorState, PageHeader } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api, ApiError, errorMessage } from '@/lib/api';

interface AdminSettings {
  organizationName: string;
  timezone: string;
  ticketNumberPrefix: string;
  ticketNumberPadding: number;
  ticketNumberIncludeYear: boolean;
  allowSelfRegistration: boolean;
  reopenWindowDays: number;
  autoCloseResolvedAfterDays: number;
  emailNotificationsEnabled: boolean;
  allowedAttachmentTypes: string[];
  maxAttachmentMb: number;
  emailDelivery: { configured: boolean };
  storageDriver: string;
  serverMaxUploadMb: number;
}

const TYPE_LABELS: Record<string, string> = {
  'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/gif': 'GIF', 'image/webp': 'WebP', 'application/pdf': 'PDF', 'text/plain': 'Text / logs', 'text/csv': 'CSV', 'application/zip': 'ZIP',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word (.docx)', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel (.xlsx)',
};

const timezones = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

export function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings', 'admin'], queryFn: () => api.get<{ data: AdminSettings }>('/settings').then((r) => r.data) });
  const [d, setD] = useState<AdminSettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (settings.data) setD(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => {
      const { emailDelivery: _e, storageDriver: _s, serverMaxUploadMb: _m, ...body } = d!;
      return api.patch('/settings', body);
    },
    onSuccess: () => {
      setErrors({});
      toast.success('Settings saved');
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['auth-config'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.details?.fieldErrors) setErrors(Object.fromEntries(Object.entries(e.details.fieldErrors).map(([k, v]) => [k, v[0]])));
      toast.error(errorMessage(e));
    },
  });
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;
  if (!d) return <Skeleton className="h-96" />;
  const set = <K extends keyof AdminSettings>(k: K, v: AdminSettings[K]) => setD({ ...d, [k]: v });
  const preview = `${d.ticketNumberPrefix}-${d.ticketNumberIncludeYear ? `${new Date().getFullYear()}-` : ''}${'1'.padStart(d.ticketNumberPadding, '0')}`;
  return (
    <div className="space-y-5">
      <PageHeader title="System settings" description="Organization-wide configuration. Every change is recorded in the audit log." actions={<Button loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button>} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>General</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Organization name" htmlFor="s-org" error={errors.organizationName}><Input id="s-org" value={d.organizationName} onChange={(e) => set('organizationName', e.target.value)} /></Field>
            <Field label="Time zone" htmlFor="s-tz" hint="Used for business hours, holidays and report buckets." error={errors.timezone}>
              <Input id="s-tz" list="tz-list" value={d.timezone} onChange={(e) => set('timezone', e.target.value)} />
              <datalist id="tz-list">{timezones.map((t) => <option key={t} value={t} />)}</datalist>
            </Field>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span><span className="font-medium">Allow customer self-registration</span><span className="block text-xs text-muted-foreground">Shows a sign-up link on the login page.</span></span>
              <Switch checked={d.allowSelfRegistration} onCheckedChange={(c) => set('allowSelfRegistration', c)} />
            </label>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ticket numbering</CardTitle>
            <CardDescription>Next format preview: <code className="font-mono">{preview}</code>. Existing tickets keep their numbers.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Prefix" htmlFor="s-prefix" hint="1–10 upper-case letters/digits" error={errors.ticketNumberPrefix}><Input id="s-prefix" value={d.ticketNumberPrefix} maxLength={10} onChange={(e) => set('ticketNumberPrefix', e.target.value.toUpperCase())} /></Field>
            <Field label="Digits" htmlFor="s-pad" error={errors.ticketNumberPadding}><Input id="s-pad" type="number" min={3} max={10} value={d.ticketNumberPadding} onChange={(e) => set('ticketNumberPadding', Number(e.target.value))} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={d.ticketNumberIncludeYear} onCheckedChange={(c) => set('ticketNumberIncludeYear', c)} /> Include year (numbering restarts each year)</label>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Ticket lifecycle</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Reopen window (days)" htmlFor="s-reopen" hint="How long requesters may reopen resolved tickets." error={errors.reopenWindowDays}><Input id="s-reopen" type="number" min={0} max={365} value={d.reopenWindowDays} onChange={(e) => set('reopenWindowDays', Number(e.target.value))} /></Field>
            <Field label="Auto-close resolved after (days)" htmlFor="s-close" hint="0 disables auto-close." error={errors.autoCloseResolvedAfterDays}><Input id="s-close" type="number" min={0} max={365} value={d.autoCloseResolvedAfterDays} onChange={(e) => set('autoCloseResolvedAfterDays', Number(e.target.value))} /></Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>
              Email delivery: {d.emailDelivery.configured ? <Badge variant="success">SMTP configured</Badge> : <Badge variant="secondary">Not configured (set SMTP_* environment variables)</Badge>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span><span className="font-medium">Send email notifications</span><span className="block text-xs text-muted-foreground">In-app notifications are always on. Users can opt out of email in their profile.</span></span>
              <Switch checked={d.emailNotificationsEnabled} onCheckedChange={(c) => set('emailNotificationsEnabled', c)} />
            </label>
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Attachments</CardTitle>
            <CardDescription>Storage driver: <code>{d.storageDriver}</code>. Server hard limit: {d.serverMaxUploadMb} MB per file (MAX_UPLOAD_MB). File contents are verified, not just extensions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Maximum file size (MB)" htmlFor="s-max" error={errors.maxAttachmentMb} className="max-w-xs"><Input id="s-max" type="number" min={0.1} max={d.serverMaxUploadMb} step={0.5} value={d.maxAttachmentMb} onChange={(e) => set('maxAttachmentMb', Number(e.target.value))} /></Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Allowed file types</legend>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {Object.entries(TYPE_LABELS).map(([mime, label]) => (
                  <label key={mime} className="flex items-center gap-2 text-sm">
                    <Switch checked={d.allowedAttachmentTypes.includes(mime)} onCheckedChange={(c) => set('allowedAttachmentTypes', c ? [...d.allowedAttachmentTypes, mime] : d.allowedAttachmentTypes.filter((x) => x !== mime))} />
                    {label}
                  </label>
                ))}
              </div>
              {errors.allowedAttachmentTypes && <p className="mt-1 text-xs text-destructive">{errors.allowedAttachmentTypes}</p>}
            </fieldset>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
