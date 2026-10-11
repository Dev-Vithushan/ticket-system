import { Command } from 'cmdk';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface ComboOption {
  value: string;
  label: string;
  description?: string;
}

interface ComboboxProps {
  value: string | null;
  onChange: (value: string | null) => void;
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** For server-side search: called as the user types. */
  onSearch?: (q: string) => void;
  loading?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Label to show when the selected value is not in the current options (server search). */
  selectedLabel?: string;
}

/** Searchable dropdown (agents, teams, categories, requesters). Keyboard accessible via cmdk. */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results',
  onSearch,
  loading,
  clearable = true,
  disabled,
  id,
  className,
  selectedLabel,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? (value ? selectedLabel : undefined);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className={cn('relative', className)}>
        <Popover.Trigger asChild disabled={disabled}>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className={cn('truncate', !label && 'text-muted-foreground')}>{label ?? placeholder}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </Popover.Trigger>
        {clearable && value && !disabled && (
          <button
            type="button"
            aria-label="Clear selection"
            className="absolute right-8 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => onChange(null)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[14rem] rounded-md border bg-popover p-0 text-popover-foreground shadow-md">
          <Command shouldFilter={!onSearch} className="flex flex-col">
            <div className="flex items-center border-b px-2">
              <Command.Input placeholder={searchPlaceholder} onValueChange={onSearch} className="h-9 w-full bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground" />
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <Command.List className="max-h-64 overflow-y-auto p-1">
              <Command.Empty className="px-2 py-4 text-center text-sm text-muted-foreground">{loading ? 'Searching…' : emptyText}</Command.Empty>
              {options.map((o) => (
                <Command.Item
                  key={o.value}
                  value={`${o.label} ${o.description ?? ''} ${o.value}`}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm aria-selected:bg-accent"
                >
                  <Check className={cn('h-4 w-4 shrink-0', o.value === value ? 'opacity-100' : 'opacity-0')} />
                  <div className="min-w-0">
                    <div className="truncate">{o.label}</div>
                    {o.description && <div className="truncate text-xs text-muted-foreground">{o.description}</div>}
                  </div>
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
