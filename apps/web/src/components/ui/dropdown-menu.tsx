import * as React from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

export const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof Menu.Content>, React.ComponentPropsWithoutRef<typeof Menu.Content>>(
  ({ className, sideOffset = 4, ...props }, ref) => (
    <Menu.Portal>
      <Menu.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn('z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md', className)}
        {...props}
      />
    </Menu.Portal>
  ),
);
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof Menu.Item>, React.ComponentPropsWithoutRef<typeof Menu.Item>>(
  ({ className, ...props }, ref) => (
    <Menu.Item
      ref={ref}
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  ),
);
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuLabel = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof Menu.Label>) => (
  <Menu.Label className={cn('px-2 py-1.5 text-xs font-semibold text-muted-foreground', className)} {...p} />
);
export const DropdownMenuSeparator = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof Menu.Separator>) => (
  <Menu.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...p} />
);
