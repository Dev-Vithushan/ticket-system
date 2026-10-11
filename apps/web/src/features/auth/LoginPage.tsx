import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { api, errorMessage } from '@/lib/api';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type Values = z.infer<typeof schema>;

export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api.get<{ data: { organizationName: string; allowSelfRegistration: boolean } }>('/auth/config').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const cfg = useAuthConfig();
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
            <ClipboardList className="h-5 w-5 text-white" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle.replace('{org}', cfg.data?.organizationName ?? 'Support Desk')}</p>
        </div>
        <Card>
          <CardContent className="p-5 pt-5 sm:p-6 sm:pt-6">{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const cfg = useAuthConfig();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  if (user) return <Navigate to={from} replace />;

  return (
    <AuthShell title="Sign in" subtitle="Welcome to {org}">
      <form
        className="space-y-4"
        noValidate
        onSubmit={handleSubmit(async (v) => {
          setError(null);
          try {
            await login(v.email, v.password);
            navigate(from, { replace: true });
          } catch (err) {
            setError(errorMessage(err));
          }
        })}
      >
        {error && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" autoFocus aria-invalid={!!formState.errors.email} {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!formState.errors.password} {...register('password')} />
        </Field>
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Sign in
        </Button>
        {cfg.data?.allowSelfRegistration && (
          <p className="text-center text-sm text-muted-foreground">
            New here?{' '}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </p>
        )}
      </form>
    </AuthShell>
  );
}
