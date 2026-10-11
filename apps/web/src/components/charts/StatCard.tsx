import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function StatCard({ label, value, hint, icon: Icon, tone, to, loading }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ElementType; tone?: 'danger' | 'warning' | 'success'; to?: string; loading?: boolean }) {
  const body = (
    <Card className={cn('h-full p-4 transition-colors', to && 'hover:border-primary/50')}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && <Icon className={cn('h-4 w-4 text-muted-foreground', tone === 'danger' && 'text-destructive', tone === 'warning' && 'text-warning', tone === 'success' && 'text-success')} aria-hidden />}
      </div>
      {loading ? <Skeleton className="mt-2 h-7 w-16" /> : <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>}
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-lg focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}
