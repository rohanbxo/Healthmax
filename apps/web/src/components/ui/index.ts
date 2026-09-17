/**
 * Beta UI kit — presentational primitives only (SPEC.md §4).
 * No domain knowledge, no data fetching, no imports from @beta/core.
 */
export { Button, buttonVariants, type ButtonProps } from './button';
export {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
  Row,
  type CardProps,
  type RowProps,
} from './card';
export { SectionLabel, sectionLabelVariants, type SectionLabelProps } from './section-label';
export { Badge, badgeVariants, type BadgeProps } from './badge';
export { Input, type InputProps } from './input';
export { Label, type LabelProps } from './label';
export { Field, useFieldControl, type FieldProps, type FieldControlProps } from './field';
export { Switch, type SwitchProps } from './switch';
export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetFooter,
  type SheetContentProps,
} from './sheet';
export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
  type AlertDialogContentProps,
} from './alert-dialog';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedControlOption,
} from './segmented-control';
export {
  ToastProvider,
  Toaster,
  useToast,
  useToasts,
  type ToastOptions,
  type ToastItem,
  type ToastAction,
  type ToastVariant,
  type ToastContextValue,
  type ToastProviderProps,
  type ToasterProps,
} from './toast';
export { ProgressSegments, type ProgressSegmentsProps } from './progress-segments';
export { Spinner, spinnerVariants, type SpinnerProps } from './spinner';
