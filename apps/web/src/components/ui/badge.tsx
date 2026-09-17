import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] leading-4 uppercase tracking-[0.12em] whitespace-nowrap',
  {
    variants: {
      variant: {
        /** The AT RISK badge (SPEC.md §4.6). */
        'outline-danger': 'border border-danger text-danger',
        /** The SKIPPED label (SPEC.md §4.7). */
        muted: 'bg-raised text-muted',
        success: 'bg-success/15 text-success',
        accent: 'bg-accent/15 text-accent',
      },
    },
    defaultVariants: { variant: 'muted' },
  },
);

export type BadgeProps = React.ComponentPropsWithoutRef<'span'> &
  VariantProps<typeof badgeVariants>;

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant, ...props },
  ref,
) {
  return <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />;
});

export { badgeVariants };
