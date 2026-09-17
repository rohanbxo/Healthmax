/**
 * Habit endpoints (SPEC.md §9 "Habits, logs, snoozes", §12 "Authorization",
 * §13 "API tests").
 */
import { expect } from 'chai';
import request from 'supertest';
import { habitDtoSchema, type HabitDTO } from '@beta/core';

import { TEST_NOW_MS, useTestApp } from './helpers/testApp';
import { bearer, detailPaths, expectEnvelope, expectHiddenFromOtherUser, registerUser } from './helpers/auth';
import { createHabit } from './helpers/factories';
import { HABITS_URL, habitBody, habitUrl, postHabit } from './helpers/routes';

/** The fixed instant is 2026-09-17T06:00:00Z — a Thursday in most of the world. */
const DUBAI_TODAY = '2026-09-17';

describe('habits', () => {
  const harness = useTestApp();
  const app = () => harness().app;

  /* ------------------------------------------------------- POST /habits */

  describe('POST /api/habits', () => {
    it('creates a habit and stamps createdDayKey from the server clock', async () => {
      const session = await registerUser(app(), { timeZone: 'Asia/Dubai' });

      const res = await request(app())
        .post(HABITS_URL)
        .set(...bearer(session.accessToken))
        .send(habitBody({ schedule: { kind: 'weekdays', days: [4, 1] }, remind: false, order: 3 }))
        .expect(201);

      const habit = habitDtoSchema.parse(res.body);
      expect(habit.createdDayKey).to.equal(DUBAI_TODAY);
      expect(habit.archived).to.equal(false);
      expect(habit.remind).to.equal(false);
      expect(habit.order).to.equal(3);
      // The schedule is normalised on the way in (SPEC.md §5).
      expect(habit.schedule).to.deep.equal({ kind: 'weekdays', days: [1, 4] });
    });

    it('stamps createdDayKey in the user timezone, not the server one', async () => {
      const west = await registerUser(app(), { timeZone: 'America/Los_Angeles' });
      const east = await registerUser(app(), { timeZone: 'Pacific/Kiritimati' });

      // One instant, two calendars (SPEC.md §7).
      expect((await postHabit(app(), west)).createdDayKey).to.equal('2026-09-16');
      expect((await postHabit(app(), east)).createdDayKey).to.equal('2026-09-17');
    });

    it('refuses a client-supplied createdDayKey', async () => {
      const session = await registerUser(app());

      const res = await request(app())
        .post(HABITS_URL)
        .set(...bearer(session.accessToken))
        .send({ ...habitBody(), createdDayKey: '2020-01-01' })
        .expect(400);

      const { details } = expectEnvelope(res.body, 'VALIDATION_ERROR');
      expect(detailPaths(details)).to.include('body.createdDayKey');
    });

    it('emits exactly one habit.changed event', async () => {
      const session = await registerUser(app());
      harness().eventBus.reset();

      const habit = await postHabit(app(), session);

      expect(harness().eventBus.events).to.deep.equal([
        { type: 'habit.changed', userId: session.me.id, habitId: habit.id },
      ]);
    });

    it('requires authentication', async () => {
      const res = await request(app()).post(HABITS_URL).send(habitBody()).expect(401);
      expectEnvelope(res.body, 'UNAUTHENTICATED');
    });
  });

  /* -------------------------------------------------------- GET /habits */

  describe('GET /api/habits', () => {
    it('returns live habits ordered by order, then by age', async () => {
      const session = await registerUser(app());
      const second = await postHabit(app(), session, { name: 'Second', order: 5 });
      const first = await postHabit(app(), session, { name: 'First', order: 1 });
      const sameOrderLater = await postHabit(app(), session, { name: 'Also five', order: 5 });

      const res = await request(app())
        .get(HABITS_URL)
        .set(...bearer(session.accessToken))
        .expect(200);

      const habits = habitDtoSchema.array().parse(res.body);
      expect(habits.map((habit) => habit.id)).to.deep.equal([
        first.id,
        second.id,
        sameOrderLater.id,
      ]);
    });

    it('includes archived habits, flagged, and hides soft-deleted ones', async () => {
      const session = await registerUser(app());
      const archived = await createHabit(harness().prisma, session.me.id, {
        name: 'Archived',
        archived: true,
      });
      const deleted = await createHabit(harness().prisma, session.me.id, {
        name: 'Deleted',
        deletedAtMs: TEST_NOW_MS,
      });

      const res = await request(app())
        .get(HABITS_URL)
        .set(...bearer(session.accessToken))
        .expect(200);

      const habits = res.body as HabitDTO[];
      const ids = habits.map((habit) => habit.id);
      expect(ids).to.include(archived.id);
      expect(ids).to.not.include(deleted.id);
      expect(habits.find((habit) => habit.id === archived.id)?.archived).to.equal(true);
    });

    it('never shows another user\'s habits', async () => {
      const owner = await registerUser(app());
      const intruder = await registerUser(app());
      await postHabit(app(), owner);

      const res = await request(app())
        .get(HABITS_URL)
        .set(...bearer(intruder.accessToken))
        .expect(200);

      expect(res.body).to.deep.equal([]);
    });

    it('drops a habit whose stored schedule is unreadable instead of failing', async () => {
      const session = await registerUser(app());
      const good = await postHabit(app(), session);
      // A hand-edited row (SPEC.md §8: the JSON column is validated on read).
      const corrupt = await createHabit(harness().prisma, session.me.id);
      await harness().prisma.$executeRaw`
        UPDATE "Habit" SET "schedule" = '{"kind":"monthly"}'::jsonb WHERE "id" = ${corrupt.id}::uuid
      `;

      const res = await request(app())
        .get(HABITS_URL)
        .set(...bearer(session.accessToken))
        .expect(200);

      expect((res.body as HabitDTO[]).map((habit) => habit.id)).to.deep.equal([good.id]);
    });
  });

  /* --------------------------------------------------- PATCH /habits/:id */

  describe('PATCH /api/habits/:id', () => {
    it('applies a partial update, including archived and order', async () => {
      const session = await registerUser(app());
      const habit = await postHabit(app(), session);

      const res = await request(app())
        .patch(habitUrl(habit.id))
        .set(...bearer(session.accessToken))
        .send({ archived: true, order: 9, time: '21:15' })
        .expect(200);

      const updated = habitDtoSchema.parse(res.body);
      expect(updated).to.include({ archived: true, order: 9, time: '21:15' });
      // Untouched fields stay untouched.
      expect(updated.name).to.equal(habit.name);
      expect(updated.createdDayKey).to.equal(habit.createdDayKey);
    });

    it('emits exactly one habit.changed event', async () => {
      const session = await registerUser(app());
      const habit = await postHabit(app(), session);
      harness().eventBus.reset();

      await request(app())
        .patch(habitUrl(habit.id))
        .set(...bearer(session.accessToken))
        .send({ name: 'Renamed' })
        .expect(200);

      expect(harness().eventBus.events).to.deep.equal([
        { type: 'habit.changed', userId: session.me.id, habitId: habit.id },
      ]);
    });

    it('rejects an empty body, an unknown field and a bad time', async () => {
      const session = await registerUser(app());
      const habit = await postHabit(app(), session);
      const patch = (body: object) =>
        request(app())
          .patch(habitUrl(habit.id))
          .set(...bearer(session.accessToken))
          .send(body)
          .expect(400);

      expectEnvelope((await patch({})).body, 'VALIDATION_ERROR');
      expect(detailPaths(expectEnvelope((await patch({ colour: 'red' })).body, 'VALIDATION_ERROR').details))
        .to.include('body.colour');
      expect(detailPaths(expectEnvelope((await patch({ time: '25:00' })).body, 'VALIDATION_ERROR').details))
        .to.include('body.time');
      expect(
        detailPaths(
          expectEnvelope((await patch({ schedule: { kind: 'weekdays', days: [] } })).body, 'VALIDATION_ERROR')
            .details,
        ),
      ).to.include('body.schedule.days');
    });

    it('404s on an unknown or soft-deleted habit', async () => {
      const session = await registerUser(app());
      const deleted = await createHabit(harness().prisma, session.me.id, {
        deletedAtMs: TEST_NOW_MS,
      });

      const res = await request(app())
        .patch(habitUrl(deleted.id))
        .set(...bearer(session.accessToken))
        .send({ name: 'Back from the dead' })
        .expect(404);
      expectEnvelope(res.body, 'NOT_FOUND');
    });
  });

  /* -------------------------------------------------- DELETE /habits/:id */

  describe('DELETE /api/habits/:id', () => {
    it('soft-deletes, keeps the row, and hides it from every read', async () => {
      const session = await registerUser(app());
      const habit = await postHabit(app(), session);

      await request(app())
        .delete(habitUrl(habit.id))
        .set(...bearer(session.accessToken))
        .expect(204);

      const stored = await harness().prisma.habit.findUnique({ where: { id: habit.id } });
      expect(stored?.deletedAt, 'the row survives the delete').to.not.equal(null);

      const list = await request(app())
        .get(HABITS_URL)
        .set(...bearer(session.accessToken))
        .expect(200);
      expect(list.body).to.deep.equal([]);
    });

    it('emits one habit.changed event, and 404s on the second delete', async () => {
      const session = await registerUser(app());
      const habit = await postHabit(app(), session);
      harness().eventBus.reset();

      await request(app())
        .delete(habitUrl(habit.id))
        .set(...bearer(session.accessToken))
        .expect(204);
      expect(harness().eventBus.events).to.deep.equal([
        { type: 'habit.changed', userId: session.me.id, habitId: habit.id },
      ]);

      await request(app())
        .delete(habitUrl(habit.id))
        .set(...bearer(session.accessToken))
        .expect(404);
      // A no-op delete has nothing to reschedule.
      expect(harness().eventBus.events).to.have.lengthOf(1);
    });
  });

  /* ----------------------------------------------------------- IDOR */

  describe('authorization (SPEC.md §9: 404, never 403)', () => {
    it('hides another user\'s habit from PATCH and DELETE', async () => {
      const owner = await registerUser(app());
      const intruder = await registerUser(app());
      const habit = await postHabit(app(), owner);

      await expectHiddenFromOtherUser(() =>
        request(app())
          .patch(habitUrl(habit.id))
          .set(...bearer(intruder.accessToken))
          .send({ name: 'Mine now' }),
      );
      await expectHiddenFromOtherUser(() =>
        request(app())
          .delete(habitUrl(habit.id))
          .set(...bearer(intruder.accessToken)),
      );

      const stored = await harness().prisma.habit.findUnique({ where: { id: habit.id } });
      expect(stored?.name).to.equal(habit.name);
      expect(stored?.deletedAt).to.equal(null);
    });

    it('rejects a habit id that is not a uuid with 400, not 404', async () => {
      const session = await registerUser(app());
      const res = await request(app())
        .patch(habitUrl('not-a-uuid'))
        .set(...bearer(session.accessToken))
        .send({ name: 'Nope' })
        .expect(400);
      expect(detailPaths(expectEnvelope(res.body, 'VALIDATION_ERROR').details)).to.include('params.id');
    });
  });
});
