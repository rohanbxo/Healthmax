import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';
import { useFieldControl } from './field';

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

/**
 * Accent when on, `raised` track when off. The visible pill is 28px tall; a
 * transparent pseudo-element extends the hit area to 44px (SPEC.md §4).
 */
export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  function Switch({ className, id, 'aria-describedby': describedBy, ...props }, ref) {
    const field = useFieldControl();

    return (
      <SwitchPrimitive.Root
        ref={ref}
        id={id ?? field?.id}
        aria-describedby={describedBy ?? field?.['aria-describedby']}
        className={cn(
          'peer relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full p-0.5',
          'border border-transparent transition-colors',
          'bg-raised data-[state=checked]:bg-accent',
          'disabled:pointer-events-none disabled:opacity-40',
          "after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']",
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'pointer-events-none block size-6 rounded-full bg-text shadow-sm',
            'transition-transform motion-reduce:transition-none',
            'translate-x-0 data-[state=checked]:translate-x-5 data-[state=checked]:bg-base',
          )}
        />
      </SwitchPrimitive.Root>
    );
  },
);
