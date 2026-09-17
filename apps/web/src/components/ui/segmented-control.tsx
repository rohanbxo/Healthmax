import * as React from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cn } from '@/lib/utils';

export type SegmentedControlOption<TValue extends string> = {
  value: TValue;
  label: React.ReactNode;
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string;
  disabled?: boolean;
};

export type SegmentedControlProps<TValue extends string> = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'onChange' | 'defaultValue' | 'dir'
> & {
  value: TValue;
  onValueChange: (value: TValue) => void;
  options: readonly SegmentedControlOption<TValue>[];
  /** Accessible name of the group, e.g. "Calendar view". */
  label: string;
  size?: 'default' | 'sm';
};

function SegmentedControlImpl<TValue extends string>(
  {
    className,
    value,
    onValueChange,
    options,
    label,
    size = 'default',
    ...props
  }: SegmentedControlProps<TValue>,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  return (
    <ToggleGroupPrimitive.Root
      ref={ref}
      type="single"
      value={value}
      // Radix emits '' when the active item is clicked again; a segmented
      // control is single-select, so that deselect is ignored.
      onValueChange={(next) => {
        if (next) onValueChange(next as TValue);
      }}
      orientation="horizontal"
      loop
      aria-label={label}
      className={cn(
        'inline-flex w-full items-center gap-1 rounded-control bg-raised p-1',
        className,
      )}
      {...props}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          aria-label={option.ariaLabel}
          // Selection follows focus, the expected behaviour for a radiogroup:
          // Radix's roving focus moves focus with the arrow keys, and the
          // segment under focus becomes the selected one.
          onFocus={() => {
            if (option.value !== value) onValueChange(option.value);
          }}
          className={cn(
            'flex flex-1 items-center justify-center rounded-[10px] px-3',
            'font-mono uppercase tracking-[0.08em] transition-colors',
            'text-muted hover:text-text',
            'data-[state=on]:bg-accent data-[state=on]:text-base',
            'disabled:pointer-events-none disabled:opacity-40',
            size === 'sm' ? 'h-9 text-xs' : 'h-11 text-sm',
          )}
        >
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

/**
 * Single-select segmented control (Day/Month/Year, 7/30/90). Renders a
 * `radiogroup` of `radio` items; arrow keys move focus (Radix roving focus)
 * and selection follows focus, as a native radio group does.
 */
export const SegmentedControl = React.forwardRef(SegmentedControlImpl) as <TValue extends string>(
  props: SegmentedControlProps<TValue> & { ref?: React.ForwardedRef<HTMLDivElement> },
) => React.ReactElement;
