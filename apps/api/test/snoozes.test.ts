/**
 * Snooze endpoints (SPEC.md §6 "Actions", §9, §13 "API tests").
 */
import { expect } from 'chai';
import request from 'supertest';
import { snoozeDtoSchema } from '@beta/core';

import { TEST_NOW_MS, useTestApp } from './helpers/testApp';
import {
  bearer,
  detailPaths,
  expectEnvelope,
  expectHiddenFromOtherUser,
  registerUser,
  type Session,
} from './helpers/auth';
import { LOGS_URL, postHabit, snoozeUrl } from './helpers/routes';

const MINUTE_MS = 60_000;
/** The harness clock is pinned to 2026-09-17T06:00:00Z. */
const NOW_ISO = '2026-09-17T06:00:00.000Z';
const TODAY = '2026-09-17';

describe('snoozes', () => {
  const harness = useTestApp();
  const app = () => harness().app;

  const signIn = () => registerUser(app(), { timeZone: 'Asia/Dubai' });

  const putSnooze = (session: Session, habitId: string, minutes: unknown) =>
    request(app())
      .put(snoozeUrl(habitId))
      .set(...bearer(session.accessToken))
      .send({ minutes });

  describe('PUT /api/habits/:id/snooze', () => {
    it("computes `until` from the injected clock, in the user's day", async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session);
      expect(harness().clock.now(), 'the clock is pinned').to.equal(TEST_NOW_MS);

      const res = await putSnooze(session, habit.id, 15).expect(200);

      expect(snoozeDtoSchema.parse(res.body)).to.deep.equal({
        habitId: habit.id,
        dayKey: TODAY,
        until: '2026-09-17T06:15:00.000Z',
      });
      expect(NOW_ISO < (res.body.until as string)).to.equal(true);
    });

    it("uses the caller's timezone for the day key", async () => {
      const west = await registerUser(app(), { timeZone: 'America/Los_Angeles' });
      const habit = await postHabit(app(), west);

      const res = await putSnooze(west, habit.id, 180).expect(200);

      // Same instant, a day earlier in Los Angeles (SPEC.md §7).
      expect(res.body.dayKey).to.equal('2026-09-16');
      expect(res.body.until).to.equal('2026-09-17T09:00:00.000Z');
    });

    it('replaces an existing snooze rather than adding one', async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session);

      await putSnooze(session, habit.id, 15).expect(200);
      const later = await putSnooze(session, habit.id, 60).expect(200);

      const rows = await harness().prisma.snooze.findMany({ where: { habitId: habit.id } });
      expect(rows).to.have.lengthOf(1);
      expect(rows[0]?.until.getTime()).to.equal(TEST_NOW_MS + 60 * MINUTE_MS);
      expect(later.body.until).to.equal('2026-09-17T07:00:00.000Z');
    });

    it('is not a log and writes nothing to the log table', async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session);

      await putSnooze(session, habit.id, 180).expect(200);

      expect(await harness().prisma.log.count({ where: { habitId: habit.id } })).to.equal(0);
      const logs = await request(app())
        .get(LOGS_URL)
        .query({ from: '2026-09-01', to: TODAY })
        .set(...bearer(session.accessToken))
        .expect(200);
      expect(logs.body).to.deep.equal([]);
    });

    it('accepts only 15, 60 or 180 minutes', async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session);

      for (const minutes of [30, 0, -15, '15', null]) {
        const res = await putSnooze(session, habit.id, minutes).expect(400);
        expect(detailPaths(expectEnvelope(res.body, 'VALIDATION_ERROR').details)).to.include(
          'body.minutes',
        );
      }

      const extra = await request(app())
        .put(snoozeUrl(habit.id))
        .set(...bearer(session.accessToken))
        .send({ minutes: 15, until: '2030-01-01T00:00:00.000Z' })
        .expect(400);
      expect(detailPaths(expectEnvelope(extra.body, 'VALIDATION_ERROR').details)).to.include(
        'body.until',
      );
    });

    it('emits exactly one snooze.changed event', async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session);
      harness().eventBus.reset();

      await putSnooze(session, habit.id, 15).expect(200);

      expect(harness().eventBus.events).to.deep.equal([
        { type: 'snooze.changed', userId: session.me.id, habitId: habit.id, dayKey: TODAY },
      ]);
    });
  });

  describe('DELETE /api/habits/:id/snooze', () => {
    it('is idempotent and emits an event only for a real deletion', async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session);
      await putSnooze(session, habit.id, 15).expect(200);
      harness().eventBus.reset();

      const remove = () =>
        request(app())
          .delete(snoozeUrl(habit.id))
          .set(...bearer(session.accessToken))
          .expect(204);

      await remove();
      expect(harness().eventBus.events).to.deep.equal([
        { type: 'snooze.changed', userId: session.me.id, habitId: habit.id },
      ]);
      expect(await harness().prisma.snooze.count({ where: { habitId: habit.id } })).to.equal(0);

      await remove();
      expect(harness().eventBus.events).to.have.lengthOf(1);
    });
  });

  describe('authorization (SPEC.md §9: 404, never 403)', () => {
    it("hides another user's snooze routes behind 404", async () => {
      const owner = await signIn();
      const intruder = await signIn();
      const habit = await postHabit(app(), owner);
      await putSnooze(owner, habit.id, 15).expect(200);

      await expectHiddenFromOtherUser(() =>
        request(app())
          .put(snoozeUrl(habit.id))
          .set(...bearer(intruder.accessToken))
          .send({ minutes: 180 }),
      );
      await expectHiddenFromOtherUser(() =>
        request(app())
          .delete(snoozeUrl(habit.id))
          .set(...bearer(intruder.accessToken)),
      );

      const rows = await harness().prisma.snooze.findMany({ where: { habitId: habit.id } });
      expect(rows, "the owner's snooze is untouched").to.have.lengthOf(1);
      expect(rows[0]?.until.getTime()).to.equal(TEST_NOW_MS + 15 * MINUTE_MS);
    });
  });
});
