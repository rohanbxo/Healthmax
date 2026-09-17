import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Tailwind v4 is CSS-first: the Beta tokens live in `@theme` in `src/index.css`
 * (SPEC.md §4), so tailwind-merge does not know about them out of the box.
 *
 * Two of the generated utilities need teaching:
 *
 * 1. `text-base` — because `--color-base` exists, Tailwind v4 generates
 *    `.text-base { color: var(--color-base) }` (verified against the compiled
 *    stylesheet). tailwind-merge's stock config classifies `text-base` as a
 *    *font size*, so `cn('text-sm', 'text-base')` would wrongly drop `text-sm`
 *    and `cn('text-base', 'text-danger')` would keep both colors. The
 *    `font-size` group is therefore overridden without `base`, and `base` is
 *    added to the text colors.
 * 2. `rounded-card` / `rounded-control` — unknown radii, so they never
 *    conflicted with each other or with `rounded-full`. Registered on the
 *    `radius` theme scale.
 *
 * Everything else (`bg-base`, `bg-card`, `bg-raised`, `border-border`,
 * `text-muted`, `font-mono`, …) already merges correctly, because
 * tailwind-merge's colour scales accept any value. The custom utilities
 * `section-label` and `tap-target` are unknown classes and are passed through
 * untouched, which is what we want.
 */
const FONT_SIZES = ['xs', 'sm', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];

const isArbitrary = (value: string): boolean => value.startsWith('[') || value.startsWith('(');

const twMerge = extendTailwindMerge({
  override: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES, isArbitrary] }],
    },
  },
  extend: {
    theme: { radius: ['card', 'control'] },
    classGroups: { 'text-color': [{ text: ['base'] }] },
  },
});

/** Compose conditional class names, resolving Tailwind conflicts (last wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
