import * as React from 'react';
import { cn } from '@/lib/utils';

export type ProgressSegmentsProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> & {
  /** Number of segments — one per habit due today. */
  total: number;
  /** How many segments are filled. Clamped to [0, total]. */
  completed: number;
  /** Overrides the default "3 of 7 done" announcement. */
  valueText?: string;
  /** Accessible name, e.g. "Today's progress". */
  label?: string;
};

/**
 * Segmented progress bar: one 4px segment per item, `raised` track, `accent`
 * when filled (SPEC.md §4.1).
 */
export const ProgressSegments = React.forwardRef<HTMLDivElement, ProgressSegmentsProps>(
  function ProgressSegments(
    { className, total, completed, valueText, label = 'Progress', ...props },
    ref,
  ) {
    const segments = Math.max(0, Math.trunc(total));
    const filled = Math.min(Math.max(0, Math.trunc(completed)), segments);
    const text = valueText ?? `${filled} of ${segments} done`;

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={segments}
        aria-valuenow={filled}
        aria-valuetext={text}
        className={cn('flex w-full items-center gap-1', className)}
        {...props}
      >
        {Array.from({ length: segments }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={cn('h-1 flex-1 rounded-full', index < filled ? 'bg-accent' : 'bg-raised')}
          />
        ))}
      </div>
    );
  },
);
