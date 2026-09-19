/**
 * The Stats read model (SPEC.md §9 "Read models", §6 "Streaks" and "Accuracy").
 *
 * The numbers all come from `@beta/core`'s `buildStats`; this layer only
 * decides which rows to load and whether it needs to load them at all. The
 * cache key carries the caller's `dayKey`, so the payload rolls over at their
 * midnight, not the server's (SPEC.md §7 rule 5).
 *
 * History: current and best streak can walk back to a habit's creation, so the
 * log read spans `[statsHistoryFrom, today]` rather than the 400-day window
 * `/logs` enforces. That cap bounds what a *client* may ask for; this query is
 * the server's own, bounded by `MAX_STREAK_LOOKBACK_DAYS`, and runs once per
 * user per day and range before the cache answers.
 */
import { buildStats, statsHistoryFrom, todayKey, type StatsDTO, type StatsRange } from '@beta/core';

import type { Clock } from '../../lib/clock';
import { requireUserContext, type UserContextRepository } from '../shared/userContext';
import { toHabitDtos } from '../habits/dto';
import type { HabitRepository } from '../habits/repository';
import { toLogDto } from '../logs/dto';
import type { LogRepository } from '../logs/repository';
import type { StatsCache } from './cache';

export type CacheStatus = 'HIT' | 'MISS';

export type StatsServiceDeps = {
  habits: HabitRepository;
  logs: LogRepository;
  users: UserContextRepository;
  clock: Clock;
  cache: StatsCache;
};

export interface StatsService {
  get(userId: string, range: StatsRange): Promise<{ stats: StatsDTO; cache: CacheStatus }>;
}

export function createStatsService(deps: StatsServiceDeps): StatsService {
  return {
    async get(userId, range) {
      const user = await requireUserContext(deps.users, userId);
      const now = deps.clock.now();
      const dayKey = todayKey(now, user.timeZone);

      const cached = await deps.cache.get(userId, dayKey, range);
      if (cached.hit) return { stats: cached.stats, cache: 'HIT' };

      const habits = toHabitDtos(await deps.habits.listLive(userId));
      const logRows = await deps.logs.listRange(userId, {
        from: statsHistoryFrom(habits, dayKey),
        to: dayKey,
      });

      const stats = buildStats({
        habits,
        logs: logRows.map(toLogDto),
        todayKey: dayKey,
        now,
        tz: user.timeZone,
        weekStart: user.weekStart,
        range,
      });

      await deps.cache.put(userId, dayKey, range, stats, cached.generation);
      return { stats, cache: 'MISS' };
    },
  };
}
