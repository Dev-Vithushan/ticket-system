import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface Range {
  from: string;
  to: string;
  preset: string;
}

const day = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const PRESETS = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '365d', label: '12 months', days: 365 },
];

export function presetRange(key = '30d'): Range {
  const p = PRESETS.find((x) => x.key === key) ?? PRESETS[1];
  const to = new Date();
  return { from: iso(new Date(to.getTime() - (p.days - 1) * day)), to: iso(to), preset: p.key };
}

export function useDateRange(initial = '30d') {
  const [range, setRange] = useState<Range>(() => presetRange(initial));
  const query = useMemo(
    () => ({ from: new Date(`${range.from}T00:00:00`).toISOString(), to: new Date(`${range.to}T23:59:59.999`).toISOString() }),
    [range],
  );
  const days = Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / day) + 1;
  const interval: 'day' | 'week' | 'month' = days <= 45 ? 'day' : days <= 200 ? 'week' : 'month';
  return { range, setRange, query, interval };
}

/** Preset buttons + custom date inputs, in one row above the charts. */
export function DateRangePicker({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Date range presets">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={range.preset === p.key}
            onClick={() => onChange(presetRange(p.key))}
            className={cn('rounded px-2.5 py-1 text-sm font-medium', range.preset === p.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Input type="date" className="h-8 w-[9.5rem]" aria-label="From date" value={range.from} max={range.to} onChange={(e) => e.target.value && onChange({ ...range, from: e.target.value, preset: 'custom' })} />
        <span className="text-muted-foreground">–</span>
        <Input type="date" className="h-8 w-[9.5rem]" aria-label="To date" value={range.to} min={range.from} onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value, preset: 'custom' })} />
      </div>
    </div>
  );
}
