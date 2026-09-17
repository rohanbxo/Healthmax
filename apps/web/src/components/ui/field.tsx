import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from './label';

/** Props a field-aware control should spread onto its input element. */
export type FieldControlProps = {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  required: boolean | undefined;
};

const FieldContext = React.createContext<FieldControlProps | null>(null);

/**
 * Returns the wiring for the control inside a `Field` (id, description and
 * validity), or `null` when the control is used standalone. `Input` and
 * `Switch` consume this automatically.
 */
export function useFieldControl(): FieldControlProps | null {
  return React.useContext(FieldContext);
}

export type FieldProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> & {
  label: React.ReactNode;
  /** Helper text rendered under the control and referenced by the control. */
  hint?: React.ReactNode;
  /** When set, the control is marked invalid and the message is announced. */
  error?: React.ReactNode;
  /** Explicit control id; generated when omitted. */
  id?: string;
  required?: boolean;
  /** A control (auto-wired) or a render function receiving the wiring. */
  children: React.ReactNode | ((control: FieldControlProps) => React.ReactNode);
};

/**
 * Wires a label, a control, an optional hint and an inline error message with
 * the right `id` / `aria-describedby` / `aria-invalid` relationships.
 */
export const Field = React.forwardRef<HTMLDivElement, FieldProps>(function Field(
  { className, label, hint, error, id, required, children, ...props },
  ref,
) {
  const generatedId = React.useId();
  const controlId = id ?? `field-${generatedId}`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  const control = React.useMemo<FieldControlProps>(
    () => ({
      id: controlId,
      'aria-describedby': describedBy,
      'aria-invalid': error ? true : undefined,
      required: required || undefined,
    }),
    [controlId, describedBy, error, required],
  );

  return (
    <div ref={ref} className={cn('flex flex-col gap-1.5', className)} {...props}>
      <Label htmlFor={controlId}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-muted">
            *
          </span>
        ) : null}
      </Label>

      <FieldContext.Provider value={control}>
        {typeof children === 'function' ? children(control) : children}
      </FieldContext.Provider>

      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
});
