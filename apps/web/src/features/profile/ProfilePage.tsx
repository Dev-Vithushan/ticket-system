import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { passwordRule } from '@/lib/validation';

const profileSchema = z.object({ name: z.string().trim().min(2, 'At least 2 characters').max(120), phone: z.string().max(40), jobTitle: z.string().max(120), emailNotifications: z.boolean() });
const pwSchema = z
  .object({ currentPassword: z.string().min(1, 'Required'), newPassword: passwordRule, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })
  .refine((v) => v.newPassword !== v.currentPassword, { message: 'New password must differ from the current one', path: ['newPassword'] });

export function ProfilePage() {
  const { user, refresh } = useAuth();
  const profile = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values: { name: user!.name, phone: user!.phone ?? '', jobTitle: user!.jobTitle ?? '', emailNotifications: user!.emailNotifications },
  });
  const pw = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const saveProfile = useMutation({
    mutationFn: (v: z.infer<typeof profileSchema>) => api.patch('/auth/me', { ...v, phone: v.phone || null, jobTitle: v.jobTitle || null }),
    onSuccess: async () => {
      await refresh();
      toast.success('Profile updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const changePw = useMutation({
    mutationFn: ({ confirm: _c, ...v }: z.infer<typeof pwSchema>) => api.post('/auth/change-password', v),
    onSuccess: () => {
      pw.reset();
      toast.success('Password changed. Other sessions were signed out.');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INVALID_PASSWORD') pw.setError('currentPassword', { message: e.message });
      else toast.error(errorMessage(e));
    },
  });
  const pe = profile.formState.errors;
  const we = pw.formState.errors;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Profile & security" />
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            {user!.email} · <Badge variant="secondary">{user!.role.name}</Badge>
            {user!.teams.length > 0 && <> · {user!.teams.map((t) => t.name).join(', ')}</>}
            {user!.lastLoginAt && <> · last sign-in {formatDate(user!.lastLoginAt)}</>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={profile.handleSubmit((v) => saveProfile.mutate(v))}>
            <Field label="Full name" htmlFor="p-name" error={pe.name?.message} required><Input id="p-name" {...profile.register('name')} /></Field>
            <Field label="Job title" htmlFor="p-title"><Input id="p-title" {...profile.register('jobTitle')} /></Field>
            <Field label="Phone" htmlFor="p-phone"><Input id="p-phone" type="tel" {...profile.register('phone')} /></Field>
            <label className="flex items-center gap-3 self-end pb-2 text-sm">
              <Switch checked={profile.watch('emailNotifications')} onCheckedChange={(c) => profile.setValue('emailNotifications', c, { shouldDirty: true })} />
              Email me about ticket updates
            </label>
            <div className="sm:col-span-2"><Button type="submit" loading={saveProfile.isPending}>Save profile</Button></div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Changing your password signs you out on all other devices.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-3" noValidate onSubmit={pw.handleSubmit((v) => changePw.mutate(v))}>
            <Field label="Current password" htmlFor="cp" error={we.currentPassword?.message} required><Input id="cp" type="password" autoComplete="current-password" {...pw.register('currentPassword')} /></Field>
            <Field label="New password" htmlFor="np" error={we.newPassword?.message} required><Input id="np" type="password" autoComplete="new-password" {...pw.register('newPassword')} /></Field>
            <Field label="Confirm new password" htmlFor="cf" error={we.confirm?.message} required><Input id="cf" type="password" autoComplete="new-password" {...pw.register('confirm')} /></Field>
            <div className="sm:col-span-3"><Button type="submit" loading={changePw.isPending}>Change password</Button></div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
