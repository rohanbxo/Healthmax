import type { HabitDTO, LogDTO, LogStatus, SnoozeDTO, DayKey, Schedule } from '../src/types';
import { localToInstant } from '../src/time';

/**
 * Fixtures for the domain tests.
 *
 * Every date in these suites is real: 2026-09-17 is a Thursday, so
 * `weekStartKey` is 2026-09-14 on a Monday week and 2026-09-13 on a Sunday one.
 */
export const THURSDAY: DayKey = '2026-09-17';

export function habit(overrides: Partial<HabitDTO> = {}): HabitDTO {
  return {
    id: 'habit-1',
    name: 'Morning run',
    schedule: { kind: 'daily' },
    time: '07:30',
    remind: true,
    createdDayKey: '2026-09-01',
    archived: false,
    order: 0,
    ...overrides,
  };
}

export function weekdaysSchedule(...days: number[]): Schedule {
  return { kind: 'weekdays', days: [...days].sort((a, b) => a - b) };
}

export function timesPerWeek(count: number): Schedule {
  return { kind: 'timesPerWeek', count };
}

export function log(dayKey: DayKey, status: LogStatus = 'done', habitId = 'habit-1'): LogDTO {
  return { habitId, dayKey, status };
}

/** `done` logs for each listed day. */
export function done(days: DayKey[], habitId = 'habit-1'): LogDTO[] {
  return days.map((day) => log(day, 'done', habitId));
}

export function snooze(dayKey: DayKey, until: string, habitId = 'habit-1'): SnoozeDTO {
  return { habitId, dayKey, until };
}

/** An ISO instant for a wall-clock time in a timezone — how a snooze is stored. */
export function isoAt(dayKey: DayKey, time: string, tz: string): string {
  return new Date(localToInstant(dayKey, time, tz)).toISOString();
}

/** Epoch ms for a wall-clock time in a timezone, for `now` in the tests. */
export function at(dayKey: DayKey, time: string, tz: string): number {
  return localToInstant(dayKey, time, tz);
}
