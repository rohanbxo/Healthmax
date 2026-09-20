/**
 * Log rules (SPEC.md §9, §6 "Actions" and "Backfill").
 *
 * This is where a `dayKey` stops being a well-formed string and starts being a
 * day that may or may not be logged. The route layer can only judge the *shape*
 * of the input (`2026-02-30` is a 400), because the answer to "may I log this
 * day?" needs three things a schema does not have: the injected clock, the
 * user's timezone, and the habit's schedule and `createdDayKey`. So the
 * decision lives here, one layer above the repository and below the controller,
 * and it is expressed with `@beta/core`'s `canLogOn` — the same function the web
 * client uses to disable the button (SPEC.md §0.6).
 *
 * A rejected day is `UNPROCESSABLE` 422, never 400: the request was understood,
 * it just asks for something the rules forbid.
 */
import {
  MAX_LOG_RANGE_DAYS,
  canLogOn,
  compareDayKeys,
  diffDays,
  todayKey,
  type DayKey,
  type HabitDTO,
  type LogDTO,
  type LogsQuery,
  type PutLogBody,
} from '@beta/core';

import type { Clock } from '../../lib/clock';
import type { EventBus } from '../../events/bus';
import { unprocessable, type ErrorDetail } from '../../http/errors';
import { requireUserContext, type UserContextRepository } from '../shared/userContext';
import type { HabitRepository } from '../habits/repository';
import { requireOwnedHabit, requireOwnedHabitId } from '../habits/service';
import { toLogDto } from './dto';
import type { LogRepository } from './repository';

export type LogServiceDeps = {
  repository: LogRepository;
  habits: HabitRepository;
  users: UserContextRepository;
  clock: Clock;
  eventBus: EventBus;
};

export interface LogService {
  put(userId: string, habitId: string, dayKey: DayKey, body: PutLogBody): Promise<LogDTO>;
  remove(userId: string, habitId: string, dayKey: DayKey): Promise<void>;
  list(userId: string, query: LogsQuery): Promise<LogDTO[]>;
}

const dayDetail = (message: string): ErrorDetail[] => [{ path: 'params.dayKey', message }];

const rangeDetail = (message: string): ErrorDetail[] => [{ path: 'query.to', message }];

/**
 * `canLogOn` gives the verdict (SPEC.md §6); this adds the reason, because "422"
 * on its own is not something a user can act on.
 */
function assertLoggable(habit: HabitDTO, dayKey: DayKey, today: DayKey): void {
  if (canLogOn(habit, dayKey, today)) return;

  if (compareDayKeys(dayKey, today) > 0) {
    throw unprocessable(
      `${dayKey} is in the future; only days up to ${today} can be logged.`,
      dayDetail('A future day cannot be logged.'),
    );
  }
  if (compareDayKeys(dayKey, habit.createdDayKey) < 0) {
    throw unprocessable(
      `This habit did not exist on ${dayKey}; it starts on ${habit.createdDayKey}.`,
      dayDetail('Earlier than the habit was created.'),
    );
  }
  if (habit.archived) {
    throw unprocessable(
      'This habit is archived, so it is not scheduled on any day.',
      dayDetail('The habit is archived.'),
    );
  }
  throw unprocessable(
    `This habit is not scheduled on ${dayKey}.`,
    dayDetail('The habit is not scheduled on this day.'),
  );
}

/** SPEC.md §8: log range queries are capped at 400 days, inclusive of both ends. */
function assertRange(from: DayKey, to: DayKey): void {
  if (compareDayKeys(from, to) > 0) {
    throw unprocessable(
      `"to" (${to}) is before "from" (${from}).`,
      rangeDetail('Range is inverted.'),
    );
  }
  const days = diffDays(from, to) + 1;
  if (days > MAX_LOG_RANGE_DAYS) {
    throw unprocessable(
      `A log range covers at most ${MAX_LOG_RANGE_DAYS} days; ${from}…${to} covers ${days}.`,
      rangeDetail(`At most ${MAX_LOG_RANGE_DAYS} days.`),
    );
  }
}

export function createLogService(deps: LogServiceDeps): LogService {
  return {
    async put(userId, habitId, dayKey, body) {
      const user = await requireUserContext(deps.users, userId);
      const habit = await requireOwnedHabit(deps.habits, userId, habitId);

      assertLoggable(habit, dayKey, todayKey(deps.clock.now(), user.timeZone));

      // Idempotent: the same status twice is one row and one event.
      await deps.repository.put({ userId, habitId, dayKey, status: body.status });

      // The cleared snooze rides along on `log.changed`: it is the same user's
      // plan being rebuilt, so a second event would only duplicate the job.
      deps.eventBus.emit({ type: 'log.changed', userId, habitId, dayKey });
      return toLogDto({ habitId, dayKey, status: body.status });
    },

    async remove(userId, habitId, dayKey) {
      await requireOwnedHabitId(deps.habits, userId, habitId);

      const removed = await deps.repository.remove(userId, habitId, dayKey);
      // Deleting a log that is already gone is a success with nothing to
      // reschedule, so it stays silent on the bus.
      if (removed) deps.eventBus.emit({ type: 'log.changed', userId, habitId, dayKey });
    },

    async list(userId, query) {
      assertRange(query.from, query.to);
      // A habit filter is checked for ownership so an id that is not the
      // caller's reads as 404 rather than as an empty range.
      if (query.habitId !== undefined) {
        await requireOwnedHabitId(deps.habits, userId, query.habitId);
      }

      const rows = await deps.repository.listRange(userId, {
        from: query.from,
        to: query.to,
        habitId: query.habitId,
      });
      return rows.map(toLogDto);
    },
  };
}
