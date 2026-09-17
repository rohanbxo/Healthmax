/**
 * The Today read model (SPEC.md §9 "Read models").
 *
 * Deliberately **not** a screen description. The endpoint returns facts —
 * the server's instant, the caller's day and timezone, their habits, the logs
 * for the current week and the live snoozes — and the client computes the
 * sections with `@beta/core`. That is what keeps "overdue" honest between
 * fetches: the browser re-derives it every second against `serverNow`, instead
 * of rendering a snapshot that quietly goes stale (SPEC.md §9, §11).
 *
 * `logs` covers the whole current week rather than just today, because
 * `timesPerWeek` progress ("1 / 5 this week") is a week-long count the client
 * runs through `doneCountInWeek`. Three queries, no N+1 (SPEC.md §8).
 */
import { addDays, weekStartKey, todayKey, type TodayDTO } from '@beta/core';

import type { Clock } from '../../lib/clock';
import { toIsoInstant } from '../../lib/instant';
import { requireUserContext, type UserContextRepository } from '../shared/userContext';
import { toHabitDtos } from '../habits/dto';
import type { HabitRepository } from '../habits/repository';
import { toLogDto } from '../logs/dto';
import type { LogRepository } from '../logs/repository';
import type { SnoozeRepository } from '../snoozes/repository';

/** Days in a week, as a `to` offset from the week's first day. */
const LAST_DAY_OF_WEEK = 6;

export type TodayServiceDeps = {
  habits: HabitRepository;
  logs: LogRepository;
  snoozes: SnoozeRepository;
  users: UserContextRepository;
  clock: Clock;
};

export interface TodayService {
  get(userId: string): Promise<TodayDTO>;
}

export function createTodayService(deps: TodayServiceDeps): TodayService {
  return {
    async get(userId) {
      const user = await requireUserContext(deps.users, userId);
      const now = deps.clock.now();

      const dayKey = todayKey(now, user.timeZone);
      const from = weekStartKey(dayKey, user.weekStart);
      const to = addDays(from, LAST_DAY_OF_WEEK);

      const [habitRows, logRows, snoozeRows] = await Promise.all([
        deps.habits.listLive(userId),
        deps.logs.listRange(userId, { from, to }),
        deps.snoozes.listLive(userId, now),
      ]);

      return {
        serverNow: toIsoInstant(now),
        dayKey,
        timeZone: user.timeZone,
        weekStart: user.weekStart,
        // Archived habits come along, flagged: a habit archived after being
        // completed today still has to be renderable in "Done & skipped".
        // `isScheduledOn` keeps them out of every live section (SPEC.md §6).
        habits: toHabitDtos(habitRows),
        logs: logRows.map(toLogDto),
        snoozes: snoozeRows.map((row) => ({
          habitId: row.habitId,
          dayKey: row.dayKey,
          until: toIsoInstant(row.untilMs),
        })),
      };
    },
  };
}
