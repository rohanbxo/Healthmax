/**
 * The Today screen's heartbeat (SPEC.md §4, §11).
 *
 * One interval for the whole screen — not one per row — re-renders every 30
 * seconds with a fresh instant. Because every section is derived from that
 * instant through `@beta/core`, a habit walks from "Later today" into "Overdue"
 * on its own, with no refetch and no per-row timer to leak.
 *
 * `Date.now()` is the only clock reading in the web app; every calculation on
 * top of it goes through `packages/core/time.ts` (SPEC.md §7).
 */
import * as React from 'react';

export const TICK_INTERVAL_MS = 30_000;

export function useNowTick(intervalMs: number = TICK_INTERVAL_MS): number {
  const [now, setNow] = React.useState<number>(() => Date.now());

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
