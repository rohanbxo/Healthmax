/**
 * The Stats read model and its Redis cache (SPEC.md §9, §13 "API tests":
 * "first call MISS, second HIT, after a log change MISS again, values correct").
 */
import { expect } from 'chai';
import request from 'supertest';
import { statsDtoSchema, type StatsDTO, type StatsRange } from '@beta/core';

import {
  STATS_CACHE_TTL_SECONDS,
  createRedisStatsCache,
  statsCacheKey,
  statsKeySetKey,
} from '../src/modules/stats/cache';
import { TEST_NOW_MS, useTestApp } from './helpers/testApp';
import {
  bearer,
  expectEnvelope,
  forgeAccessToken,
  registerUser,
  type Session,
} from './helpers/auth';
import { createHabit, createLog } from './helpers/factories';
import { habitUrl, logUrl, snoozeUrl } from './helpers/routes';

const STATS_URL = '/api/stats';
/** The harness clock is 2026-09-17T06:00Z: 10:00 on Thursday in Dubai. */
const TODAY = '2026-09-17';

describe('stats', () => {
  const harness = useTestApp();
  const app = () => harness().app;

  const getStats = async (
    session: Session,
    range?: StatsRange,
  ): Promise<{ stats: StatsDTO; cache: string | undefined }> => {
    const res = await request(app())
      .get(STATS_URL)
      .query(range === undefined ? {} : { range })
      .set(...bearer(session.accessToken))
      .expect(200);
    return {
      stats: statsDtoSchema.parse(res.body),
      cache: res.headers['x-cache'] as string | undefined,
    };
  };

  /**
   * A Dubai user with one daily habit from Thu 10 Sep: done 10, 11, 14, 15, 16;
   * skipped 12; 13 missed; today unlogged.
   */
  const arrange = async (): Promise<{ session: Session; habitId: string }> => {
    const session = await registerUser(app(), { timeZone: 'Asia/Dubai' });
    const habit = await createHabit(harness().prisma, session.me.id, {
      name: 'Read',
      createdDayKey: '2026-09-10',
    });
    const userId = session.me.id;
    for (const dayKey of ['2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16']) {
      await createLog(harness().prisma, { userId, habitId: habit.id, dayKey });
    }
    await createLog(harness().prisma, {
      userId,
      habitId: habit.id,
      dayKey: '2026-09-12',
      status: 'skipped',
    });
    return { session, habitId: habit.id };
  };

  it('misses, then hits, then misses again after a log change — with correct values', async () => {
    const { session, habitId } = await arrange();

    const first = await getStats(session, 7);
    expect(first.cache).to.equal('MISS');
    // 11–17 Sep: done 11, 14, 15, 16; missed 13; skipped 12 and today excluded.
    expect(first.stats.overallAccuracy).to.be.closeTo(4 / 5, 1e-9);
    expect(first.stats.dayKey).to.equal(TODAY);
    const [habit] = first.stats.habits;
    expect(habit?.habitId).to.equal(habitId);
    expect(habit?.currentStreak).to.equal(3);
    expect(habit?.bestStreak).to.equal(3);
    expect(habit?.accuracy30).to.be.closeTo(5 / 6, 1e-9);
    expect(habit?.last30).to.have.length(30);
    expect(habit?.last30.at(-1)).to.deep.equal({ dayKey: TODAY, status: 'overdue' });

    const second = await getStats(session, 7);
    expect(second.cache).to.equal('HIT');
    expect(second.stats).to.deep.equal(first.stats);

    await request(app())
      .put(logUrl(habitId, TODAY))
      .set(...bearer(session.accessToken))
      .send({ status: 'done' })
      .expect(200);

    // No wait between the write and the read: invalidation must already hold.
    const third = await getStats(session, 7);
    expect(third.cache).to.equal('MISS');
    expect(third.stats.overallAccuracy).to.be.closeTo(5 / 6, 1e-9);
    expect(third.stats.habits[0]?.currentStreak).to.equal(4);
    expect(third.stats.habits[0]?.last30.at(-1)).to.deep.equal({ dayKey: TODAY, status: 'done' });
  });

  it('defaults to 30 days and caches each range separately', async () => {
    const { session } = await arrange();

    const defaulted = await getStats(session);
    expect(defaulted.stats.range).to.equal(30);
    expect(defaulted.cache).to.equal('MISS');

    expect((await getStats(session, 30)).cache, 'same key as the default').to.equal('HIT');
    expect((await getStats(session, 7)).cache).to.equal('MISS');
    expect((await getStats(session, 90)).cache).to.equal('MISS');
    expect((await getStats(session, 7)).cache).to.equal('HIT');
  });

  it('drops the cache when a log is cleared', async () => {
    const { session, habitId } = await arrange();
    await getStats(session, 7);

    await request(app())
      .delete(logUrl(habitId, '2026-09-16'))
      .set(...bearer(session.accessToken))
      .expect(204);

    const after = await getStats(session, 7);
    expect(after.cache).to.equal('MISS');
    expect(after.stats.habits[0]?.currentStreak, '16 is now missed').to.equal(0);
  });

  it('drops the cache when a habit changes, and stops counting an archived one', async () => {
    const { session, habitId } = await arrange();
    await getStats(session, 30);

    await request(app())
      .patch(habitUrl(habitId))
      .set(...bearer(session.accessToken))
      .send({ archived: true })
      .expect(200);

    const after = await getStats(session, 30);
    expect(after.cache).to.equal('MISS');
    expect(after.stats.habits).to.deep.equal([]);
    expect(after.stats.overallAccuracy).to.equal(null);
  });

  it('drops the cache when the week start changes', async () => {
    const { session } = await arrange();
    await getStats(session, 30);

    await request(app())
      .patch('/api/me')
      .set(...bearer(session.accessToken))
      .send({ weekStart: 0 })
      .expect(200);

    expect((await getStats(session, 30)).cache).to.equal('MISS');
  });

  it('keeps the cache through a snooze, which has no effect on stats', async () => {
    const { session, habitId } = await arrange();
    await getStats(session, 30);

    await request(app())
      .put(snoozeUrl(habitId))
      .set(...bearer(session.accessToken))
      .send({ minutes: 15 })
      .expect(200);

    expect((await getStats(session, 30)).cache).to.equal('HIT');
  });

  it("invalidates only the changed user's entries", async () => {
    const mine = await arrange();
    const theirs = await arrange();
    await getStats(mine.session, 30);
    await getStats(theirs.session, 30);

    await request(app())
      .put(logUrl(mine.habitId, TODAY))
      .set(...bearer(mine.session.accessToken))
      .send({ status: 'done' })
      .expect(200);

    expect((await getStats(mine.session, 30)).cache).to.equal('MISS');
    expect((await getStats(theirs.session, 30)).cache).to.equal('HIT');
  });

  it('stores under stats:v1:{userId}:{dayKey}:{range} with a one-hour TTL, tracked in the key set', async () => {
    const { session } = await arrange();
    await getStats(session, 90);

    const key = statsCacheKey(session.me.id, TODAY, 90);
    expect(key).to.equal(`stats:v1:${session.me.id}:${TODAY}:90`);
    const ttl = await harness().redis.ttl(key);
    expect(ttl).to.be.greaterThan(0).and.at.most(STATS_CACHE_TTL_SECONDS);
    expect(await harness().redis.smembers(statsKeySetKey(session.me.id))).to.deep.equal([key]);
  });

  it('deletes through the key set, never with KEYS', async () => {
    const { session } = await arrange();
    await getStats(session, 7);
    await getStats(session, 30);
    const redis = harness().redis;

    const original = redis.keys.bind(redis);
    let keysCalls = 0;
    (redis as unknown as { keys: typeof redis.keys }).keys = ((
      ...args: Parameters<typeof redis.keys>
    ) => {
      keysCalls += 1;
      return original(...args);
    }) as typeof redis.keys;
    try {
      await createRedisStatsCache(redis).invalidate(session.me.id);
    } finally {
      (redis as unknown as { keys: typeof redis.keys }).keys = original;
    }

    expect(keysCalls).to.equal(0);
    expect(await redis.exists(statsCacheKey(session.me.id, TODAY, 7))).to.equal(0);
    expect(await redis.exists(statsCacheKey(session.me.id, TODAY, 30))).to.equal(0);
    expect(await redis.exists(statsKeySetKey(session.me.id))).to.equal(0);
    // And the next read agrees.
    expect((await getStats(session, 7)).cache).to.equal('MISS');
  });

  it('misses on a read issued before the invalidation has finished deleting', async () => {
    const { session } = await arrange();
    await getStats(session, 30);
    const cache = createRedisStatsCache(harness().redis);

    // Not awaited: this is the event handler's fire-and-forget call. The read
    // is queued on the same connection before `DEL` can be sent, because `DEL`
    // waits for the `SMEMBERS` reply — so only the generation can make it miss.
    const invalidated = cache.invalidate(session.me.id);
    const read = await cache.get(session.me.id, TODAY, 30);
    await invalidated;

    expect(read.hit).to.equal(false);
  });

  it('never serves a value computed before an invalidation that landed mid-computation', async () => {
    const { session } = await arrange();
    const cache = createRedisStatsCache(harness().redis);
    const { stats } = await getStats(session, 30);
    await cache.invalidate(session.me.id);

    // A miss begins: it reads the generation, then goes to Postgres…
    const read = await cache.get(session.me.id, TODAY, 30);
    expect(read.hit).to.equal(false);
    if (read.hit) return;

    // …while a log change invalidates the user…
    await cache.invalidate(session.me.id);

    // …and only then does the stale result get written.
    await cache.put(session.me.id, TODAY, 30, stats, read.generation);

    expect((await cache.get(session.me.id, TODAY, 30)).hit).to.equal(false);
    expect((await getStats(session, 30)).cache).to.equal('MISS');
  });

  it('rolls over at the user’s midnight, not the server’s', async () => {
    const { session } = await arrange();
    await getStats(session, 30);

    // 20:00Z is midnight in Dubai (+4): a new day key, so a new cache entry.
    // The jump outlives the 15-minute access token, so mint one for the new now.
    harness().clock.set(TEST_NOW_MS + 14 * 60 * 60 * 1000);
    const accessToken = forgeAccessToken(
      harness().config.JWT_SECRET,
      harness().clock.now(),
      session.me.id,
    );
    const nextDay = await getStats({ ...session, accessToken }, 30);
    expect(nextDay.cache).to.equal('MISS');
    expect(nextDay.stats.dayKey).to.equal('2026-09-18');
  });

  it('rejects a range other than 7, 30 or 90', async () => {
    const session = await registerUser(app());
    const res = await request(app())
      .get(STATS_URL)
      .query({ range: 14 })
      .set(...bearer(session.accessToken))
      .expect(400);
    expectEnvelope(res.body, 'VALIDATION_ERROR');
  });

  it('401s without a token and 404s for an account that is gone', async () => {
    expectEnvelope((await request(app()).get(STATS_URL).expect(401)).body, 'UNAUTHENTICATED');

    const ghost = await request(app())
      .get(STATS_URL)
      .set(...bearer(forgeAccessToken(harness().config.JWT_SECRET, harness().clock.now())))
      .expect(404);
    expectEnvelope(ghost.body, 'NOT_FOUND');
  });
});
