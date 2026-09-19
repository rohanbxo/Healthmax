/**
 * The `/stats` cache (SPEC.md §9 "Stats cache").
 *
 *   value      stats:v1:{userId}:{dayKey}:{range}   TTL 1 hour
 *   key set    stats:keys:{userId}                  every value key written for the user
 *   generation stats:gen:{userId}                   bumped on every invalidation
 *
 * Invalidation deletes the user's keys through the key set — never `KEYS` —
 * but deletion alone has two races, and the generation closes both:
 *
 * 1. **Read after write.** The domain event fires inside the request that
 *    changed the data, but deleting takes two round trips (`SMEMBERS`, then
 *    `DEL`). A read arriving between them would still `HIT`. The `INCR` is
 *    issued first, synchronously, on the same connection, so Redis has run it
 *    before any later request's `MGET` — and a value tagged with an older
 *    generation reads as a miss.
 * 2. **Write after read.** A miss computed from the old data can finish after
 *    the invalidation and store a stale value for an hour. It is stored under
 *    the generation it *started* with, so it is already dead on arrival.
 */
import type { Redis } from 'ioredis';
import { statsDtoSchema, type DayKey, type StatsDTO, type StatsRange } from '@beta/core';

/** SPEC.md §9: one hour. */
export const STATS_CACHE_TTL_SECONDS = 60 * 60;

/**
 * The generation outlives every value written under it, so a value can never
 * outlast the counter it is checked against.
 */
const GENERATION_TTL_SECONDS = 2 * STATS_CACHE_TTL_SECONDS;

export const statsCacheKey = (userId: string, dayKey: DayKey, range: StatsRange): string =>
  `stats:v1:${userId}:${dayKey}:${range}`;
export const statsKeySetKey = (userId: string): string => `stats:keys:${userId}`;
export const statsGenerationKey = (userId: string): string => `stats:gen:${userId}`;

/** A generation that has never been bumped reads as `0`. */
const INITIAL_GENERATION = '0';

type Stored = { generation: string; stats: StatsDTO };

export type StatsCacheRead =
  | { hit: true; stats: StatsDTO }
  /** `generation` is what a later {@link StatsCache.put} must be tagged with. */
  | { hit: false; generation: string };

export interface StatsCache {
  get(userId: string, dayKey: DayKey, range: StatsRange): Promise<StatsCacheRead>;
  put(
    userId: string,
    dayKey: DayKey,
    range: StatsRange,
    stats: StatsDTO,
    generation: string,
  ): Promise<void>;
  /**
   * Makes every cached value for the user a miss. The generation bump is sent
   * before this returns its promise, which is what lets a fire-and-forget
   * event handler call it without racing the next request.
   */
  invalidate(userId: string): Promise<void>;
}

function parseStored(raw: string | null): Stored | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as { generation?: unknown; stats?: unknown };
    const stats = statsDtoSchema.safeParse(value.stats);
    if (typeof value.generation !== 'string' || !stats.success) return null;
    return { generation: value.generation, stats: stats.data };
  } catch {
    // A value this code cannot read is a miss, never a 500.
    return null;
  }
}

export function createRedisStatsCache(redis: Redis): StatsCache {
  return {
    async get(userId, dayKey, range) {
      const [raw, current] = await redis.mget(
        statsCacheKey(userId, dayKey, range),
        statsGenerationKey(userId),
      );
      const generation = current ?? INITIAL_GENERATION;
      const stored = parseStored(raw ?? null);
      if (stored !== null && stored.generation === generation) {
        return { hit: true, stats: stored.stats };
      }
      return { hit: false, generation };
    },

    async put(userId, dayKey, range, stats, generation) {
      const key = statsCacheKey(userId, dayKey, range);
      const keySet = statsKeySetKey(userId);
      const value: Stored = { generation, stats };
      await redis
        .multi()
        .set(key, JSON.stringify(value), 'EX', STATS_CACHE_TTL_SECONDS)
        .sadd(keySet, key)
        // The set lives as long as its newest member; older members that have
        // already expired cost nothing to `DEL`.
        .expire(keySet, STATS_CACHE_TTL_SECONDS)
        .exec();
    },

    invalidate(userId) {
      const generationKey = statsGenerationKey(userId);
      const keySet = statsKeySetKey(userId);
      // Queued now, before the caller's response is written (see the header).
      const bumped = redis
        .multi()
        .incr(generationKey)
        .expire(generationKey, GENERATION_TTL_SECONDS)
        .exec();

      return bumped.then(async () => {
        const keys = await redis.smembers(keySet);
        await redis.del(keySet, ...keys);
      });
    },
  };
}
