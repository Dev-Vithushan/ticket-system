import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Table = ({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) => (
  <div className="relative w-full overflow-x-auto">
    <table className={cn('w-full caption-bottom text-sm', className)} {...p} />
  </div>
);
export const THead = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className={cn('[&_tr]:border-b bg-muted/40', className)} {...p} />;
export const TBody = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className={cn('[&_tr:last-child]:border-0', className)} {...p} />;
export const TR = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-primary/5', className)} {...p} />
);
export const TH = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn('h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground', className)} {...p} />
);
export const TD = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('px-3 py-2.5 align-middle', className)} {...p} />;

/** Sortable column header with aria-sort. */
export function SortableTH<K extends string>({
  label,
  sortKey,
  sort,
  order,
  onSort,
  className,
}: {
  label: string;
  sortKey: K;
  sort: string;
  order: 'asc' | 'desc';
  onSort: (key: K) => void;
  className?: string;
}) {
  const active = sort === sortKey;
  return (
    <TH className={className} aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-foreground" onClick={() => onSort(sortKey)}>
        {label}
        {active ? order === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </TH>
  );
}
