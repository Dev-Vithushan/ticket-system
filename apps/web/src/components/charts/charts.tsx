import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format } from 'date-fns';
import { EmptyState } from '@/components/ui/misc';

const axis = { stroke: 'var(--chart-text)', fontSize: 12, tickLine: false, axisLine: false } as const;
const grid = <CartesianGrid stroke="var(--chart-grid)" vertical={false} />;

function ChartTooltip({ active, payload, label, labelFormatter }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; labelFormatter?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{labelFormatter ? labelFormatter(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-medium tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Created vs resolved over time (two categorical series, single y-axis, legend + crosshair tooltip). */
export function VolumeChart({ data, interval = 'day' }: { data: { period: string; created: number; resolved: number }[]; interval?: 'day' | 'week' | 'month' }) {
  if (!data.length || data.every((d) => !d.created && !d.resolved)) return <EmptyState title="No tickets in this period" className="py-8" />;
  const fmt = (p: string) => format(new Date(`${p}T00:00:00`), interval === 'month' ? 'MMM yyyy' : 'MMM d');
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        {grid}
        <XAxis dataKey="period" tickFormatter={fmt} {...axis} minTickGap={24} />
        <YAxis allowDecimals={false} {...axis} />
        <Tooltip content={<ChartTooltip labelFormatter={(l) => (interval === 'week' ? `Week of ${fmt(l)}` : fmt(l))} />} cursor={{ stroke: 'var(--chart-text)', strokeDasharray: '3 3' }} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: 'var(--chart-text)' }} />
        <Line type="linear" dataKey="created" name="Created" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }} />
        <Line type="linear" dataKey="resolved" name="Resolved" stroke="var(--series-2)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Single-series bars (magnitude by category). `ordinal` shades bars along the blue ramp (e.g. priority). */
export function BarsChart({ data, layout = 'vertical', ordinal, height = 240, name = 'Tickets' }: { data: { key: string; label?: string; count: number }[]; layout?: 'vertical' | 'horizontal'; ordinal?: boolean; height?: number; name?: string }) {
  if (!data.length || data.every((d) => !d.count)) return <EmptyState title="No data for this period" className="py-8" />;
  const rows = data.map((d) => ({ ...d, label: d.label ?? d.key }));
  const ramp = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)'];
  const horizontal = layout === 'horizontal';
  return (
    <ResponsiveContainer width="100%" height={horizontal ? Math.max(120, rows.length * 34 + 20) : height}>
      <BarChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 16, left: horizontal ? 8 : -16, bottom: 0 }} barCategoryGap={horizontal ? 6 : '20%'}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" allowDecimals={false} {...axis} />
            <YAxis type="category" dataKey="label" width={130} {...axis} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" {...axis} interval={0} />
            <YAxis allowDecimals={false} {...axis} />
          </>
        )}
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--chart-grid)' }} />
        <Bar dataKey="count" name={name} fill="var(--series-1)" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={36} stroke="hsl(var(--card))" strokeWidth={2}>
          {ordinal && rows.map((_, i) => <Cell key={i} fill={ramp[Math.min(i, ramp.length - 1)]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
