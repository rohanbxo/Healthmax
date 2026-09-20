/**
 * The Today read model (SPEC.md §9 "Read models", §13 "API tests":
 * "correct payload for a user in Pacific/Kiritimati vs America/Los_Angeles at
 * the same fixed instant").
 */
import { expect } from 'chai';
import request from 'supertest';
import { todayDtoSchema, type TodayDTO } from '@beta/core';

import { TEST_NOW_MS, useTestApp } from './helpers/testApp';
import {
  bearer,
  expectEnvelope,
  forgeAccessToken,
  registerUser,
  type Session,
} from './helpers/auth';
import { createHabit, createLog, createSnooze } from './helpers/factories';
import { TODAY_URL, habitUrl, logUrl, postHabit, snoozeUrl } from './helpers/routes';

const MINUTE_MS = 60_000;
/** The harness clock: 2026-09-17T06:00:00Z, a Thursday. */
const NOW_ISO = '2026-09-17T06:00:00.000Z';

describe('today', () => {
  const harness = useTestApp();
  const app = () => harness().app;

  const getToday = async (session: Session): Promise<TodayDTO> => {
    const res = await request(app())
      .get(TODAY_URL)
      .set(...bearer(session.accessToken))
      .expect(200);
    return todayDtoSchema.parse(res.body);
  };

  it('puts two users on different day keys at the same instant', async () => {
    const east = await registerUser(app(), { timeZone: 'Pacific/Kiritimati' });
    const west = await registerUser(app(), { timeZone: 'America/Los_Angeles' });

    const eastToday = await getToday(east);
    const westToday = await getToday(west);

    // Same server instant, +14 and −7 from UTC: a calendar day apart.
    expect(eastToday.serverNow).to.equal(NOW_ISO);
    expect(westToday.serverNow).to.equal(NOW_ISO);
    expect(eastToday.dayKey).to.equal('2026-09-17');
    expect(westToday.dayKey).to.equal('2026-09-16');
    expect(eastToday.timeZone).to.equal('Pacific/Kiritimati');
    expect(westToday.timeZone).to.equal('America/Los_Angeles');
    expect(eastToday.weekStart).to.equal(1);
  });

  it('follows a timezone change immediately', async () => {
    const session = await registerUser(app(), { timeZone: 'Pacific/Kiritimati' });
    expect((await getToday(session)).dayKey).to.equal('2026-09-17');

    await request(app())
      .patch('/api/me')
      .set(...bearer(session.accessToken))
      .send({ timeZone: 'America/Los_Angeles' })
      .expect(200);

    // SPEC.md §6 "Timezone change": today follows the new zone at once.
    expect((await getToday(session)).dayKey).to.equal('2026-09-16');
  });

  it("returns the habits, the current week's logs and the live snoozes", async () => {
    const session = await registerUser(app(), { timeZone: 'Asia/Dubai' });
    const habit = await createHabit(harness().prisma, session.me.id, {
      name: 'Morning run',
      createdDayKey: '2026-08-01',
    });
    // Monday 14 Sep starts this week (weekStart 1); Sunday 13 Sep is last week.
    await createLog(harness().prisma, {
      userId: session.me.id,
      habitId: habit.id,
      dayKey: '2026-09-14',
    });
    await createLog(harness().prisma, {
      userId: session.me.id,
      habitId: habit.id,
      dayKey: '2026-09-13',
    });
    await createSnooze(harness().prisma, {
      userId: session.me.id,
      habitId: habit.id,
      dayKey: '2026-09-17',
      untilMs: TEST_NOW_MS + 15 * MINUTE_MS,
    });

    const today = await getToday(session);

    expect(today.habits.map((entry) => entry.id)).to.deep.equal([habit.id]);
    expect(
      today.logs.map((log) => log.dayKey),
      'today plus the rest of the week, so timesPerWeek progress is computable',
    ).to.deep.equal(['2026-09-14']);
    expect(today.snoozes).to.deep.equal([
      { habitId: habit.id, dayKey: '2026-09-17', until: '2026-09-17T06:15:00.000Z' },
    ]);
  });

  it('omits a snooze that has already run out', async () => {
    const session = await registerUser(app(), { timeZone: 'Asia/Dubai' });
    const habit = await postHabit(app(), session);
    await createSnooze(harness().prisma, {
      userId: session.me.id,
      habitId: habit.id,
      dayKey: '2026-09-17',
      untilMs: TEST_NOW_MS - MINUTE_MS,
    });

    expect((await getToday(session)).snoozes).to.deep.equal([]);
  });

  it('keeps archived habits, flagged, and drops soft-deleted ones with their logs', async () => {
    const session = await registerUser(app(), { timeZone: 'Asia/Dubai' });
    const archived = await createHabit(harness().prisma, session.me.id, {
      name: 'Archived',
      archived: true,
      createdDayKey: '2026-08-01',
    });
    const doomed = await postHabit(app(), session, { name: 'Doomed' });
    await request(app())
      .put(logUrl(doomed.id, '2026-09-17'))
      .set(...bearer(session.accessToken))
      .send({ status: 'done' })
      .expect(200);
    await request(app())
      .put(snoozeUrl(doomed.id))
      .set(...bearer(session.accessToken))
      .send({ minutes: 60 })
      .expect(200);

    await request(app())
      .delete(habitUrl(doomed.id))
      .set(...bearer(session.accessToken))
      .expect(204);

    const today = await getToday(session);
    expect(today.habits.map((entry) => entry.id)).to.deep.equal([archived.id]);
    expect(today.habits[0]?.archived).to.equal(true);
    expect(today.logs, "a deleted habit's logs stay hidden").to.deep.equal([]);
    expect(today.snoozes).to.deep.equal([]);
  });

  it("shows only the caller's data", async () => {
    const session = await registerUser(app(), { timeZone: 'Asia/Dubai' });
    const stranger = await registerUser(app(), { timeZone: 'Asia/Dubai' });
    const theirs = await postHabit(app(), stranger);
    await request(app())
      .put(logUrl(theirs.id, '2026-09-17'))
      .set(...bearer(stranger.accessToken))
      .send({ status: 'done' })
      .expect(200);

    const today = await getToday(session);
    expect(today.habits).to.deep.equal([]);
    expect(today.logs).to.deep.equal([]);
  });

  it('401s without a token and 404s for an account that is gone', async () => {
    const anonymous = await request(app()).get(TODAY_URL).expect(401);
    expectEnvelope(anonymous.body, 'UNAUTHENTICATED');

    const ghost = await request(app())
      .get(TODAY_URL)
      .set(...bearer(forgeAccessToken(harness().config.JWT_SECRET, harness().clock.now())))
      .expect(404);
    expectEnvelope(ghost.body, 'NOT_FOUND');
  });
});
