import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const sectionLabelVariants = cva('section-label', {
  variants: {
    tone: {
      muted: 'text-muted',
      accent: 'text-accent',
      danger: 'text-danger',
      success: 'text-success',
    },
  },
  defaultVariants: { tone: 'muted' },
});

export type SectionLabelProps = React.ComponentPropsWithoutRef<'p'> &
  VariantProps<typeof sectionLabelVariants>;

/** Geist Mono, 12px, uppercase, 0.12em tracking (SPEC.md §4). */
export const SectionLabel = React.forwardRef<HTMLParagraphElement, SectionLabelProps>(
  function SectionLabel({ className, tone, ...props }, ref) {
    return <p ref={ref} className={cn(sectionLabelVariants({ tone }), className)} {...props} />;
  },
);

export { sectionLabelVariants };
