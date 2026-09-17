import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastVariant = 'default' | 'error' | 'success';

export type ToastAction = {
  /** Rendered as accent mono uppercase text, e.g. "UNDO" (SPEC.md §4.8). */
  label: string;
  onClick: () => void;
  /** Dismiss the toast after the action runs. Defaults to true. */
  dismissOnClick?: boolean;
};

export type ToastOptions = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. `0` or `Infinity` keeps the toast until dismissed. */
  duration?: number;
  action?: ToastAction;
};

export type ToastItem = ToastOptions & { id: string };

export type ToastContextValue = {
  toast: (options: ToastOptions) => string;
  dismiss: (id?: string) => void;
};

const DEFAULT_DURATION = 5000;

const ToastContext = React.createContext<ToastContextValue | null>(null);
const ToastListContext = React.createContext<readonly ToastItem[]>([]);

export type ToastProviderProps = {
  children: React.ReactNode;
  /** Default auto-dismiss delay for toasts that do not set their own. */
  duration?: number;
};

/**
 * Minimal toast store. Render a `<Toaster />` anywhere inside the provider to
 * display the queue.
 */
export function ToastProvider({
  children,
  duration = DEFAULT_DURATION,
}: ToastProviderProps): React.ReactElement {
  const [toasts, setToasts] = React.useState<readonly ToastItem[]>([]);
  const counter = React.useRef(0);

  const dismiss = React.useCallback((id?: string) => {
    setToasts((current) => (id === undefined ? [] : current.filter((item) => item.id !== id)));
  }, []);

  const toast = React.useCallback(
    (options: ToastOptions) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      setToasts((current) => [...current, { duration, ...options, id }]);
      return id;
    },
    [duration],
  );

  const value = React.useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      <ToastListContext.Provider value={toasts}>{children}</ToastListContext.Provider>
    </ToastContext.Provider>
  );
}

/** Queue a toast or dismiss one (or all, with no argument). */
export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside a <ToastProvider>.');
  }
  return context;
}

/** The live queue — for a custom renderer; `Toaster` uses it internally. */
export function useToasts(): readonly ToastItem[] {
  return React.useContext(ToastListContext);
}

const variantStyles: Record<ToastVariant, string> = {
  default: 'bg-raised text-text',
  error: 'bg-raised text-text border border-danger',
  success: 'bg-raised text-text border border-success',
};

type ToastRowProps = {
  item: ToastItem;
  onDismiss: (id: string) => void;
};

function ToastRow({ item, onDismiss }: ToastRowProps): React.ReactElement {
  const { id, title, description, action, variant = 'default' } = item;
  const duration = item.duration ?? DEFAULT_DURATION;
  const isSticky = duration <= 0 || !Number.isFinite(duration);

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = React.useRef(duration);
  const startedAtRef = React.useRef(0);

  const clear = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = React.useCallback(() => {
    if (isSticky) return;
    clear();
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => onDismiss(id), remainingRef.current);
  }, [clear, id, isSticky, onDismiss]);

  const pause = React.useCallback(() => {
    if (isSticky || timerRef.current === null) return;
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
    clear();
  }, [clear, isSticky]);

  React.useEffect(() => {
    start();
    return clear;
  }, [start, clear]);

  return (
    <div
      data-beta-toast=""
      data-toast-id={id}
      data-variant={variant}
      role={variant === 'error' ? 'alert' : 'status'}
      {...(variant === 'error' ? {} : { 'aria-live': 'polite' as const })}
      aria-atomic="true"
      onPointerEnter={pause}
      onPointerLeave={start}
      onFocusCapture={pause}
      onBlurCapture={start}
      className={cn(
        'pointer-events-auto flex w-full items-center gap-3 rounded-control px-4 py-3 shadow-lg',
        variantStyles[variant],
      )}
    >
      <div className="min-w-0 flex-1">
        {title ? <p className="truncate text-sm font-medium">{title}</p> : null}
        {description ? <p className="truncate text-sm text-muted">{description}</p> : null}
      </div>

      {action ? (
        <button
          type="button"
          onClick={() => {
            action.onClick();
            if (action.dismissOnClick !== false) onDismiss(id);
          }}
          className={cn(
            'tap-target -my-2 shrink-0 px-1 font-mono text-sm uppercase tracking-[0.12em] text-accent',
          )}
        >
          {action.label}
        </button>
      ) : (
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => onDismiss(id)}
          className="tap-target -my-2 -mr-2 flex shrink-0 items-center justify-center text-muted hover:text-text"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export type ToasterProps = React.ComponentPropsWithoutRef<'div'>;

/**
 * Renders the queue floating above the bottom tab bar. The offset reads
 * `--tab-bar-height` (default 72px) so the shell can tune it.
 */
export function Toaster({ className, ...props }: ToasterProps): React.ReactElement {
  const toasts = useToasts();
  const { dismiss } = useToast();

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 z-50 mx-auto flex w-full max-w-[480px] flex-col gap-2 px-4',
        'bottom-[calc(var(--tab-bar-height,72px)+12px+env(safe-area-inset-bottom))]',
        className,
      )}
      {...props}
    >
      {toasts.map((item) => (
        <ToastRow key={item.id} item={item} onDismiss={dismiss} />
      ))}
    </div>
  );
}
