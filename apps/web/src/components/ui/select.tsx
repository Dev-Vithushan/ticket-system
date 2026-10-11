import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Option {
  value: string;
  label: string;
}

/** Native-feeling single select built on Radix (keyboard accessible). Use value "" for "none". */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  id,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const NONE = '__none__';
  return (
    <SelectPrimitive.Root value={value || NONE} onValueChange={(v) => onValueChange(v === NONE ? '' : v)} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder}>{options.find((o) => o.value === value)?.label ?? placeholder}</SelectPrimitive.Value>
        <SelectPrimitive.Icon>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          <SelectPrimitive.Viewport className="p-1">
            {[{ value: NONE, label: placeholder }, ...options.filter((o) => o.value !== '')].map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-7 pr-2 text-sm outline-none focus:bg-accent data-[disabled]:opacity-50"
              >
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Check className="h-4 w-4" />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <SelectPrimitive.ItemText>{o.value === NONE ? <span className="text-muted-foreground">{o.label}</span> : o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
