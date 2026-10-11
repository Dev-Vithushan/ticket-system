import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary/10 text-primary',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      outline: 'text-foreground',
      destructive: 'border-transparent bg-destructive/10 text-destructive',
      warning: 'border-transparent bg-warning/15 text-warning',
      success: 'border-transparent bg-success/15 text-success',
    },
  },
  defaultVariants: { variant: 'default' },
});

export const Badge = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>>(
  ({ className, variant, ...props }, ref) => <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />,
);
Badge.displayName = 'Badge';
