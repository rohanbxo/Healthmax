/**
 * The single source of query keys (SPEC.md §11). Mutations invalidate through
 * this factory, so a key never drifts between the reader and the writer.
 */
import { type DayKey, type StatsRange } from '@beta/core';

export const queryKeys = {
  me: () => ['me'] as const,
  habits: () => ['habits'] as const,
  today: () => ['today'] as const,
  stats: (range: StatsRange) => ['stats', range] as const,
  /** Prefix for every range — what the optimistic mutations invalidate (SPEC.md §11). */
  statsAll: () => ['stats'] as const,
  logs: (from: DayKey, to: DayKey, habitId?: string) => ['logs', from, to, habitId] as const,
} as const;

export type QueryKeys = typeof queryKeys;
