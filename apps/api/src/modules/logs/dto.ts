/**
 * `LogDTO` projection (SPEC.md §5). A log is three fields on the wire; the
 * timestamps and the denormalised `userId` stay server-side.
 */
import type { LogDTO, LogStatus } from '@beta/core';

export type LogRow = {
  habitId: string;
  dayKey: string;
  status: LogStatus;
};

/** The exact `select` that produces a {@link LogRow} (SPEC.md §8). */
export const LOG_SELECT = { habitId: true, dayKey: true, status: true } as const;

export function toLogDto(row: LogRow): LogDTO {
  return { habitId: row.habitId, dayKey: row.dayKey, status: row.status };
}
