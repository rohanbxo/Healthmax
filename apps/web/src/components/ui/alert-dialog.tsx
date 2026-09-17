import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { cn } from '@/lib/utils';
import { buttonVariants } from './button';

/** Destructive confirmations: delete habit, delete account, replace on import. */
export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogPortal = AlertDialogPrimitive.Portal;

export const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(function AlertDialogOverlay({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Overlay
      ref={ref}
      data-beta-overlay=""
      className={cn('fixed inset-0 z-50 bg-base/70', className)}
      {...props}
    />
  );
});

export type AlertDialogContentProps = React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Content
> & {
  /** Required accessible name. */
  title: React.ReactNode;
  description?: React.ReactNode;
};

export const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  AlertDialogContentProps
>(function AlertDialogContent({ className, children, title, description, ...props }, ref) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2',
          'rounded-card border border-border bg-card p-4 text-text outline-none',
          className,
        )}
        {...props}
      >
        <AlertDialogPrimitive.Title className="text-lg font-semibold">
          {title}
        </AlertDialogPrimitive.Title>
        {description ? (
          <AlertDialogPrimitive.Description className="pt-1 text-sm text-muted">
            {description}
          </AlertDialogPrimitive.Description>
        ) : null}
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPortal>
  );
});

export const AlertDialogFooter = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(function AlertDialogFooter({ className, ...props }, ref) {
  return <div ref={ref} className={cn('flex flex-col gap-2 pt-4', className)} {...props} />;
});

export const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(function AlertDialogAction({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Action
      ref={ref}
      className={cn(buttonVariants({ variant: 'destructive', fullWidth: true }), className)}
      {...props}
    />
  );
});

export const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(function AlertDialogCancel({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Cancel
      ref={ref}
      className={cn(buttonVariants({ variant: 'secondary', fullWidth: true }), className)}
      {...props}
    />
  );
});
