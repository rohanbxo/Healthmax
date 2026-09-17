import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const spinnerVariants = cva(
  'inline-block shrink-0 animate-spin rounded-full border-current border-t-transparent motion-reduce:animate-none',
  {
    variants: {
      size: {
        sm: 'size-3.5 border-2',
        md: 'size-4 border-2',
        lg: 'size-6 border-2',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export type SpinnerProps = React.ComponentPropsWithoutRef<'span'> &
  VariantProps<typeof spinnerVariants> & {
    /** Announced to assistive technology; visually hidden. */
    label?: string;
  };

/**
 * Inline activity indicator. Announced as a status region, and static for
 * users who asked for reduced motion.
 */
export const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { className, size, label = 'Loading', ...props },
  ref,
) {
  return (
    <span ref={ref} role="status" className={cn('inline-flex items-center', className)} {...props}>
      <span className={cn(spinnerVariants({ size }))} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
});

export { spinnerVariants };
