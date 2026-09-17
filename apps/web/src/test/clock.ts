/**
 * A fixed clock for deterministic tests (SPEC.md §13).
 *
 * Only `Date.now` is stubbed — not the timers — so `user-event` keeps working
 * normally. Every date calculation in the app reads `now` through
 * `packages/core/time.ts`, which takes the instant as an argument, so pinning
 * `Date.now` pins the whole app.
 */
import { vi } from 'vitest';

/** 2026-09-17T07:12 in Asia/Dubai — the date on the approved mockup. */
export const FIXED_NOW_MS = 1_789_614_720_000;
export const FIXED_TIME_ZONE = 'Asia/Dubai';
export const FIXED_DAY_KEY = '2026-09-17';

export type FixedClock = {
  /** Move the clock to an absolute instant. */
  set: (ms: number) => void;
  /** Move the clock forward. */
  advance: (ms: number) => void;
  now: () => number;
  restore: () => void;
};

export function installFixedClock(startMs: number = FIXED_NOW_MS): FixedClock {
  let current = startMs;
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => current);

  return {
    set: (ms) => {
      current = ms;
    },
    advance: (ms) => {
      current += ms;
    },
    now: () => current,
    restore: () => spy.mockRestore(),
  };
}
