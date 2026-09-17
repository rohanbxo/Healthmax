import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';

export type CardProps = React.ComponentPropsWithoutRef<'div'> & {
  asChild?: boolean;
};

/** Surface container: `card` background, 16px radius (SPEC.md §4). */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'div';
  return <Comp ref={ref} className={cn('rounded-card bg-card text-text', className)} {...props} />;
});

export const CardHeader = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  function CardHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('flex items-center justify-between gap-3 px-4 pt-4 pb-2', className)}
        {...props}
      />
    );
  },
);

export const CardContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn('px-4 py-3', className)} {...props} />;
  },
);

export const CardFooter = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('flex items-center gap-2 px-4 pt-2 pb-4', className)}
        {...props}
      />
    );
  },
);

export type RowProps = React.ComponentPropsWithoutRef<'div'> & {
  asChild?: boolean;
};

/**
 * List row primitive: 56px minimum height, horizontal padding, content on the
 * left and controls on the right (SPEC.md §4.3–§4.5).
 */
export const Row = React.forwardRef<HTMLDivElement, RowProps>(function Row(
  { className, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'div';
  return (
    <Comp
      ref={ref}
      className={cn('flex min-h-14 w-full items-center justify-between gap-3 px-4', className)}
      {...props}
    />
  );
});
