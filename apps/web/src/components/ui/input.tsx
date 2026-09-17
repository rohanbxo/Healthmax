import * as React from 'react';
import { cn } from '@/lib/utils';
import { useFieldControl } from './field';

export type InputProps = React.ComponentPropsWithoutRef<'input'>;

/**
 * Text input. Inside a `Field` it picks up the generated id, description and
 * validity automatically; explicit props always win.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    className,
    type = 'text',
    id,
    required,
    'aria-describedby': describedBy,
    'aria-invalid': invalid,
    ...props
  },
  ref,
) {
  const field = useFieldControl();

  return (
    <input
      ref={ref}
      type={type}
      id={id ?? field?.id}
      required={required ?? field?.required}
      aria-describedby={describedBy ?? field?.['aria-describedby']}
      aria-invalid={invalid ?? field?.['aria-invalid']}
      className={cn(
        'h-12 w-full rounded-control border border-border bg-card px-3.5 text-[15px] text-text',
        'placeholder:text-muted',
        'transition-colors outline-none focus-visible:border-accent',
        'disabled:pointer-events-none disabled:opacity-40',
        'aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
});
