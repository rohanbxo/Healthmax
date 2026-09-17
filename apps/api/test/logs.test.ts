/**
 * Log endpoints: the backfill window, the scheduling gate, idempotency and the
 * range cap (SPEC.md §6 "Actions", §8 "Query rules", §9, §13 "API tests").
 */
import { expect } from 'chai';
import request from 'supertest';
import { MAX_LOG_RANGE_DAYS, addDays, logDtoSchema, type LogDTO } from '@beta/core';

import { useTestApp } from './helpers/testApp';
import {
  bearer,
  detailPaths,
  expectEnvelope,
  expectHiddenFromOtherUser,
  registerUser,
  type Session,
} from './helpers/auth';
import { createHabit, createLog } from './helpers/factories';
import { LOGS_URL, habitUrl, logUrl, postHabit, snoozeUrl } from './helpers/routes';

/** 2026-09-17T06:00:00Z in Asia/Dubai: Thursday, weekday 4. */
const TODAY = '2026-09-17';
const TOMORROW = '2026-09-18';
const THURSDAY = 4;
const MONDAY = 1;

describe('logs', () => {
  const harness = useTestApp();
  const app = () => harness().app;

  const signIn = () => registerUser(app(), { timeZone: 'Asia/Dubai' });

  const putLog = (session: Session, habitId: string, dayKey: string, status = 'done') =>
    request(app())
      .put(logUrl(habitId, dayKey))
      .set(...bearer(session.accessToken))
      .send({ status });

  const listLogs = (session: Session, query: Record<string, string>) =>
    request(app())
      .get(LOGS_URL)
      .query(query)
      .set(...bearer(session.accessToken));

  /* ------------------------------------------- PUT /habits/:id/logs/:day */

  describe('PUT /api/habits/:id/logs/:dayKey', () => {
    it('is an idempotent upsert', async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session);

      const first = await putLog(session, habit.id, TODAY).expect(200);
      expect(logDtoSchema.parse(first.body)).to.deep.equal({
        habitId: habit.id,
        dayKey: TODAY,
        status: 'done',
      });

      await putLog(session, habit.id, TODAY).expect(200);
      const changed = await putLog(session, habit.id, TODAY, 'skipped').expect(200);
      expect(changed.body.status).to.equal('skipped');

      const rows = await harness().prisma.log.findMany({ where: { habitId: habit.id } });
      expect(rows, 'three writes, one row').to.have.lengthOf(1);
      expect(rows[0]?.status).to.equal('skipped');
    });

    it('accepts a scheduled backfill day between createdDayKey and today', async () => {
      const session = await signIn();
      const habit = await createHabit(harness().prisma, session.me.id, {
        createdDayKey: '2026-09-10',
      });

      await putLog(session, habit.id, '2026-09-14').expect(200);
      await putLog(session, habit.id, '2026-09-10').expect(200);
    });

    it('rejects a future day with 422', async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session);

      const res = await putLog(session, habit.id, TOMORROW).expect(422);
      expect(expectEnvelope(res.body, 'UNPROCESSABLE').message).to.include('future');
    });

    it('rejects a day before createdDayKey with 422', async () => {
      const session = await signIn();
      const habit = await createHabit(harness().prisma, session.me.id, {
        createdDayKey: '2026-09-10',
      });

      const res = await putLog(session, habit.id, '2026-09-09').expect(422);
      expect(expectEnvelope(res.body, 'UNPROCESSABLE').message).to.include('2026-09-10');
    });

    it('rejects a weekday the habit is not scheduled on with 422', async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session, {
        schedule: { kind: 'weekdays', days: [MONDAY] },
      });

      const res = await putLog(session, habit.id, TODAY).expect(422);
      expect(expectEnvelope(res.body, 'UNPROCESSABLE').message).to.include('not scheduled');

      // The same habit on a day it *is* scheduled goes through.
      const thursday = await postHabit(app(), session, {
        schedule: { kind: 'weekdays', days: [THURSDAY] },
      });
      await putLog(session, thursday.id, TODAY).expect(200);
    });

    it('rejects an archived habit with 422', async () => {
      const session = await signIn();
      const habit = await createHabit(harness().prisma, session.me.id, { archived: true });

      const res = await putLog(session, habit.id, TODAY).expect(422);
      expect(expectEnvelope(res.body, 'UNPROCESSABLE').message).to.include('archived');
    });

    it('separates a malformed dayKey (400) from a disallowed one (422)', async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session);

      for (const bad of ['yesterday', '2026-9-17', '2026-02-30', '2026-13-01']) {
        const res = await putLog(session, habit.id, bad).expect(400);
        expect(detailPaths(expectEnvelope(res.body, 'VALIDATION_ERROR').details)).to.include(
          'params.dayKey',
        );
      }

      await putLog(session, habit.id, TOMORROW).expect(422);
    });

    it('rejects a bad status and unknown body fields', async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session);

      const bad = await putLog(session, habit.id, TODAY, 'maybe').expect(400);
      expect(detailPaths(expectEnvelope(bad.body, 'VALIDATION_ERROR').details)).to.include('body.status');

      const extra = await request(app())
        .put(logUrl(habit.id, TODAY))
        .set(...bearer(session.accessToken))
        .send({ status: 'done', note: 'felt great' })
        .expect(400);
      expect(detailPaths(expectEnvelope(extra.body, 'VALIDATION_ERROR').details)).to.include('body.note');
    });

    it('clears the snooze for that day', async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session);

      await request(app())
        .put(snoozeUrl(habit.id))
        .set(...bearer(session.accessToken))
        .send({ minutes: 15 })
        .expect(200);
      expect(await harness().prisma.snooze.count({ where: { habitId: habit.id } })).to.equal(1);

      await putLog(session, habit.id, TODAY).expect(200);

      expect(
        await harness().prisma.snooze.count({ where: { habitId: habit.id } }),
        'completing ends the snooze (SPEC.md §6)',
      ).to.equal(0);
    });

    it('emits exactly one log.changed event', async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session);
      harness().eventBus.reset();

      await putLog(session, habit.id, TODAY).expect(200);

      expect(harness().eventBus.events).to.deep.equal([
        { type: 'log.changed', userId: session.me.id, habitId: habit.id, dayKey: TODAY },
      ]);
    });
  });

  /* ---------------------------------------- DELETE /habits/:id/logs/:day */

  describe('DELETE /api/habits/:id/logs/:dayKey', () => {
    it('is idempotent and emits an event only for a real deletion', async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session);
      await putLog(session, habit.id, TODAY).expect(200);
      harness().eventBus.reset();

      const remove = () =>
        request(app())
          .delete(logUrl(habit.id, TODAY))
          .set(...bearer(session.accessToken))
          .expect(204);

      await remove();
      expect(harness().eventBus.events).to.deep.equal([
        { type: 'log.changed', userId: session.me.id, habitId: habit.id, dayKey: TODAY },
      ]);

      // Deleting what is already gone is still a success.
      await remove();
      expect(harness().eventBus.events).to.have.lengthOf(1);
      expect(await harness().prisma.log.count({ where: { habitId: habit.id } })).to.equal(0);
    });

    it('clears a day outside the backfill window', async () => {
      const session = await signIn();
      const habit = await createHabit(harness().prisma, session.me.id, {
        createdDayKey: '2026-09-10',
        schedule: { kind: 'weekdays', days: [MONDAY] },
      });
      // A row from before the schedule changed: clearing it must stay possible.
      await createLog(harness().prisma, {
        userId: session.me.id,
        habitId: habit.id,
        dayKey: '2026-09-16',
      });

      await request(app())
        .delete(logUrl(habit.id, '2026-09-16'))
        .set(...bearer(session.accessToken))
        .expect(204);
      expect(await harness().prisma.log.count({ where: { habitId: habit.id } })).to.equal(0);
    });
  });

  /* ------------------------------------------------------------ GET /logs */

  describe('GET /api/logs', () => {
    it('returns the caller\'s logs in the range, oldest first', async () => {
      const session = await signIn();
      const habit = await createHabit(harness().prisma, session.me.id, {
        createdDayKey: '2026-01-01',
      });
      const other = await createHabit(harness().prisma, session.me.id, {
        createdDayKey: '2026-01-01',
        name: 'Other',
      });
      for (const dayKey of ['2026-09-16', '2026-09-14', '2026-09-01']) {
        await createLog(harness().prisma, { userId: session.me.id, habitId: habit.id, dayKey });
      }
      await createLog(harness().prisma, {
        userId: session.me.id,
        habitId: other.id,
        dayKey: '2026-09-15',
        status: 'skipped',
      });

      const res = await listLogs(session, { from: '2026-09-14', to: TODAY }).expect(200);
      const logs = logDtoSchema.array().parse(res.body);
      expect(logs.map((log) => log.dayKey)).to.deep.equal(['2026-09-14', '2026-09-15', '2026-09-16']);

      const filtered = await listLogs(session, {
        from: '2026-09-01',
        to: TODAY,
        habitId: habit.id,
      }).expect(200);
      expect((filtered.body as LogDTO[]).every((log) => log.habitId === habit.id)).to.equal(true);
      expect(filtered.body).to.have.lengthOf(3);
    });

    it(`caps the range at ${MAX_LOG_RANGE_DAYS} days`, async () => {
      const session = await signIn();
      const from = '2026-01-01';

      await listLogs(session, { from, to: addDays(from, MAX_LOG_RANGE_DAYS - 1) }).expect(200);

      const res = await listLogs(session, { from, to: addDays(from, MAX_LOG_RANGE_DAYS) }).expect(422);
      expect(expectEnvelope(res.body, 'UNPROCESSABLE').message).to.include(
        String(MAX_LOG_RANGE_DAYS),
      );
    });

    it('rejects an inverted range with 422 and a malformed one with 400', async () => {
      const session = await signIn();

      const inverted = await listLogs(session, { from: TODAY, to: '2026-09-01' }).expect(422);
      expectEnvelope(inverted.body, 'UNPROCESSABLE');

      const malformed = await listLogs(session, { from: 'never', to: TODAY }).expect(400);
      expect(detailPaths(expectEnvelope(malformed.body, 'VALIDATION_ERROR').details)).to.include(
        'query.from',
      );

      const missing = await listLogs(session, { to: TODAY }).expect(400);
      expectEnvelope(missing.body, 'VALIDATION_ERROR');
    });

    it('does not resurrect the logs of a soft-deleted habit', async () => {
      const session = await signIn();
      const habit = await postHabit(app(), session);
      await putLog(session, habit.id, TODAY).expect(200);

      await request(app())
        .delete(habitUrl(habit.id))
        .set(...bearer(session.accessToken))
        .expect(204);

      const res = await listLogs(session, { from: '2026-09-01', to: TODAY }).expect(200);
      expect(res.body).to.deep.equal([]);
      // The row itself is untouched — the read filters it, nothing deleted it.
      expect(await harness().prisma.log.count({ where: { habitId: habit.id } })).to.equal(1);
    });
  });

  /* ----------------------------------------------------------- IDOR */

  describe('authorization (SPEC.md §9: 404, never 403)', () => {
    it('hides another user\'s logs behind 404', async () => {
      const owner = await registerUser(app(), { timeZone: 'Asia/Dubai' });
      const intruder = await registerUser(app(), { timeZone: 'Asia/Dubai' });
      const habit = await postHabit(app(), owner);
      await putLog(owner, habit.id, TODAY).expect(200);

      await expectHiddenFromOtherUser(() =>
        request(app())
          .put(logUrl(habit.id, TODAY))
          .set(...bearer(intruder.accessToken))
          .send({ status: 'skipped' }),
      );
      await expectHiddenFromOtherUser(() =>
        request(app())
          .delete(logUrl(habit.id, TODAY))
          .set(...bearer(intruder.accessToken)),
      );
      await expectHiddenFromOtherUser(() =>
        request(app())
          .get(LOGS_URL)
          .query({ from: '2026-09-01', to: TODAY, habitId: habit.id })
          .set(...bearer(intruder.accessToken)),
      );

      const stored = await harness().prisma.log.findMany({ where: { habitId: habit.id } });
      expect(stored).to.have.lengthOf(1);
      expect(stored[0]?.status).to.equal('done');
    });
  });
});
