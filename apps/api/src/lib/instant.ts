/**
 * The one sanctioned bridge between epoch milliseconds and the `Date` objects
 * Prisma insists on for `DateTime` columns (SPEC.md §13 "ESLint guards": this
 * file is the API's single exemption from the date guard).
 *
 * Everything else in the API passes instants around as numbers and formats them
 * through `packages/core/time.ts`.
 */

/** Epoch milliseconds → a `Date` suitable for a Prisma `DateTime` column. */
export function toDbInstant(ms: number): Date {
  if (!Number.isFinite(ms)) {
    throw new TypeError(`toDbInstant expects a finite epoch-millisecond value, received ${ms}`);
  }
  return new Date(ms);
}

/** A Prisma `DateTime` column → epoch milliseconds. */
export function fromDbInstant(d: Date): number {
  return d.getTime();
}
