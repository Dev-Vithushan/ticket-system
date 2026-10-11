import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, errorMessage } from '@/lib/api';
import { passwordRule } from '@/lib/validation';
import { AuthShell, useAuthConfig } from './LoginPage';

const schema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name').max(120),
    email: z.string().trim().email('Enter a valid email address'),
    organization: z.string().trim().max(120).optional(),
    password: passwordRule,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
type Values = z.infer<typeof schema>;

export function RegisterPage() {
  const { user, register: signUp } = useAuth();
  const cfg = useAuthConfig();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState, setError: setFieldError } = useForm<Values>({ resolver: zodResolver(schema) });
  if (user) return <Navigate to="/" replace />;
  if (cfg.data && !cfg.data.allowSelfRegistration) return <Navigate to="/login" replace />;
  const e = formState.errors;
  return (
    <AuthShell title="Create an account" subtitle="Raise and track support requests with {org}">
      <form
        className="space-y-4"
        noValidate
        onSubmit={handleSubmit(async ({ confirm: _c, ...v }) => {
          setError(null);
          try {
            await signUp({ ...v, organization: v.organization || undefined });
            navigate('/', { replace: true });
          } catch (err) {
            if (err instanceof ApiError && err.field('password')) setFieldError('password', { message: err.field('password') });
            else setError(errorMessage(err));
          }
        })}
      >
        {error && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <Field label="Full name" htmlFor="name" error={e.name?.message} required>
          <Input id="name" autoComplete="name" {...register('name')} aria-invalid={!!e.name} />
        </Field>
        <Field label="Work email" htmlFor="email" error={e.email?.message} required>
          <Input id="email" type="email" autoComplete="email" {...register('email')} aria-invalid={!!e.email} />
        </Field>
        <Field label="Organization" htmlFor="organization" error={e.organization?.message}>
          <Input id="organization" autoComplete="organization" {...register('organization')} />
        </Field>
        <Field label="Password" htmlFor="password" error={e.password?.message} hint="10+ characters with upper, lower case and a digit" required>
          <Input id="password" type="password" autoComplete="new-password" {...register('password')} aria-invalid={!!e.password} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={e.confirm?.message} required>
          <Input id="confirm" type="password" autoComplete="new-password" {...register('confirm')} aria-invalid={!!e.confirm} />
        </Field>
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Create account
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
