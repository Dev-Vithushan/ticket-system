import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';

export function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center" aria-busy="true" aria-label="Loading">
      <div className="w-64 space-y-3">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

/** UI-level guard; the API enforces the same permissions independently. */
export function RequirePermission({ anyOf, children }: { anyOf: string[]; children: React.ReactNode }) {
  const { canAny } = useAuth();
  if (!canAny(...anyOf)) {
    return <EmptyState icon={ShieldAlert} title="Access denied" description="You don’t have permission to view this page. Contact an administrator if you need access." />;
  }
  return <>{children}</>;
}
