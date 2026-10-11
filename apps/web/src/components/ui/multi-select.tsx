import * as Popover from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';
import { Checkbox } from './checkbox';
import { cn } from '@/lib/utils';

/** Compact multi-select filter (e.g. status, priority). */
export function MultiSelect({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value.length && 'border-primary/50 bg-primary/5',
          )}
        >
          {label}
          {value.length > 0 && <span className="rounded bg-primary px-1.5 text-xs font-semibold text-primary-foreground">{value.length}</span>}
          <ChevronDown className="h-4 w-4 opacity-50" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <div role="group" aria-label={label}>
            {options.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
                <Checkbox checked={value.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
                {o.label}
              </label>
            ))}
          </div>
          {value.length > 0 && (
            <button type="button" className="mt-1 w-full rounded-sm border-t px-2 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange([])}>
              Clear selection
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
