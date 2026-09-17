import * as React from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-2',
    'rounded-control font-sans font-medium whitespace-nowrap',
    'transition-colors duration-150',
    'disabled:pointer-events-none disabled:opacity-40',
    'aria-disabled:pointer-events-none aria-disabled:opacity-40',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        /** Accent fill, black label — the Complete button (SPEC.md §4.2). */
        primary: 'bg-accent text-base hover:bg-accent/90 active:bg-accent/80',
        secondary: 'bg-raised text-text hover:bg-raised/80 active:bg-raised/70',
        ghost: 'bg-transparent text-text hover:bg-raised/60 active:bg-raised',
        outline: 'border border-border bg-transparent text-text hover:bg-raised/50',
        /** Red outline — the overdue Complete button (SPEC.md §4.3). */
        'danger-outline': 'border border-danger bg-transparent text-danger hover:bg-danger/10',
        destructive: 'bg-danger text-base hover:bg-danger/90 active:bg-danger/80',
      },
      size: {
        default: 'h-12 px-5 text-[15px] [&_svg]:size-5',
        sm: 'h-11 px-3.5 text-sm [&_svg]:size-4',
        /** 44x44 round icon button. Needs an aria-label (SPEC.md §4). */
        icon: 'size-11 rounded-full p-0 [&_svg]:size-5',
        /** Same 44x44 hit area, lighter glyph, for dense rows. */
        iconSm: 'size-11 rounded-full p-0 [&_svg]:size-4',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'default', fullWidth: false },
  },
);

export type ButtonProps = React.ComponentPropsWithoutRef<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element instead of a <button> (Radix Slot). */
    asChild?: boolean;
    /**
     * Shows a spinner and blocks interaction. The label stays in the layout
     * (just invisible), so the button keeps its width.
     */
    loading?: boolean;
    /** Announced while `loading` is true. */
    loadingLabel?: string;
  };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    fullWidth,
    asChild = false,
    loading = false,
    loadingLabel = 'Loading',
    disabled,
    children,
    type,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  const isDisabled = Boolean(disabled) || loading;

  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      data-loading={loading ? '' : undefined}
      aria-busy={loading || undefined}
      {...(asChild
        ? { 'aria-disabled': isDisabled || undefined, 'data-disabled': isDisabled ? '' : undefined }
        : { disabled: isDisabled, type: type ?? 'button' })}
      {...props}
    >
      {asChild ? (
        <Slottable>{children}</Slottable>
      ) : (
        // `contents` generates no box, so the layout is identical to plain
        // children, while `invisible` (inherited) keeps the width during load.
        <span className={cn('contents', loading && 'invisible')}>{children}</span>
      )}
      {loading ? (
        <Spinner
          size={size === 'sm' || size === 'iconSm' ? 'sm' : 'md'}
          label={loadingLabel}
          className="absolute inset-0 justify-center"
        />
      ) : null}
    </Comp>
  );
});

export { buttonVariants };
