import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { cn } from '@/lib/utils';

/** Bottom sheet root (SPEC.md §4.9 — the snooze sheet). */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function SheetOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      data-beta-overlay=""
      className={cn('fixed inset-0 z-50 bg-base/70', className)}
      {...props}
    />
  );
});

export type SheetContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  /** Required accessible name. Hidden from view when `hideTitle` is set. */
  title: React.ReactNode;
  /** Renders the title only for assistive technology. */
  hideTitle?: boolean;
  description?: React.ReactNode;
  hideDescription?: boolean;
  /** The grab-handle affordance at the top of the sheet. */
  showHandle?: boolean;
};

/**
 * A sheet anchored to the bottom of the screen: `card` background, rounded top
 * corners, focus trapped inside, closes on overlay click and Escape.
 */
export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function SheetContent(
  {
    className,
    children,
    title,
    hideTitle = false,
    description,
    hideDescription = false,
    showHandle = true,
    ...props
  },
  ref,
) {
  const titleNode = (
    <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
  );
  const descriptionNode = description ? (
    <DialogPrimitive.Description className="text-sm text-muted">
      {description}
    </DialogPrimitive.Description>
  ) : null;

  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-beta-sheet=""
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[480px]',
          'rounded-t-card border-t border-border bg-card text-text',
          'px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]',
          'outline-none',
          className,
        )}
        {...props}
      >
        {showHandle ? (
          <div aria-hidden="true" className="mx-auto mb-3 h-1 w-9 rounded-full bg-border" />
        ) : null}

        {hideTitle ? <VisuallyHidden asChild>{titleNode}</VisuallyHidden> : titleNode}
        {descriptionNode ? (
          hideDescription ? (
            <VisuallyHidden asChild>{descriptionNode}</VisuallyHidden>
          ) : (
            descriptionNode
          )
        ) : null}

        {children}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
});

export const SheetHeader = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  function SheetHeader({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex flex-col gap-1 pb-2', className)} {...props} />;
  },
);

export const SheetFooter = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  function SheetFooter({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex flex-col gap-2 pt-3', className)} {...props} />;
  },
);
