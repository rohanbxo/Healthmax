/**
 * Export and import (SPEC.md §9, §13 "API tests": "round trip equality;
 * invalid file 400; import is atomic (a failure mid-way leaves data
 * unchanged)").
 */
import { expect } from 'chai';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { exportDtoSchema, type ExportDTO } from '@beta/core';

import { TEST_NOW_MS, useTestApp } from './helpers/testApp';
import { bearer, expectEnvelope, registerUser, type Session } from './helpers/auth';
import { createHabit, createLog } from './helpers/factories';
import { postHabit } from './helpers/routes';

const EXPORT_URL = '/api/export';
const IMPORT_URL = '/api/import';

describe('export and import', () => {
  const harness = useTestApp();
  const app = () => harness().app;

  const getExport = async (session: Session): Promise<ExportDTO> => {
    const res = await request(app())
      .get(EXPORT_URL)
      .set(...bearer(session.accessToken))
      .expect(200);
    return exportDtoSchema.parse(res.body);
  };

  /** A user with two habits and three logs. */
  const arrange = async (): Promise<Session> => {
    const session = await registerUser(app(), { timeZone: 'Asia/Dubai' });
    const read = await createHabit(harness().prisma, session.me.id, {
      name: 'Read',
      createdDayKey: '2026-09-01',
      order: 0,
    });
    const gym = await createHabit(harness().prisma, session.me.id, {
      name: 'Gym',
      schedule: { kind: 'timesPerWeek', count: 3 },
      createdDayKey: '2026-09-01',
      order: 1,
    });
    await createLog(harness().prisma, {
      userId: session.me.id,
      habitId: read.id,
      dayKey: '2026-09-15',
    });
    await createLog(harness().prisma, {
      userId: session.me.id,
      habitId: read.id,
      dayKey: '2026-09-16',
      status: 'skipped',
    });
    await createLog(harness().prisma, {
      userId: session.me.id,
      habitId: gym.id,
      dayKey: '2026-09-16',
    });
    return session;
  };

  describe('GET /export', () => {
    it('serves the account as a downloadable file', async () => {
      const session = await arrange();

      const res = await request(app())
        .get(EXPORT_URL)
        .set(...bearer(session.accessToken))
        .expect(200);

      expect(res.headers['content-disposition']).to.equal(
        'attachment; filename="beta-export-2026-09-17.json"',
      );
      const data = exportDtoSchema.parse(res.body);
      expect(data.app).to.equal('beta');
      expect(data.schemaVersion).to.equal(1);
      expect(data.exportedAt).to.equal(new Date(TEST_NOW_MS).toISOString());
      expect(data.me.email).to.equal(session.me.email);
      expect(data.habits.map((habit) => habit.name)).to.deep.equal(['Read', 'Gym']);
      expect(data.logs).to.have.length(3);
    });

    it('carries only the caller’s data', async () => {
      const session = await arrange();
      const stranger = await arrange();

      const mine = await getExport(session);
      const theirs = await getExport(stranger);

      const habitIds = new Set(mine.habits.map((habit) => habit.id));
      expect(theirs.habits.every((habit) => !habitIds.has(habit.id))).to.equal(true);
      expect(mine.logs.every((log) => habitIds.has(log.habitId))).to.equal(true);
    });

    it('requires a token', async () => {
      expectEnvelope((await request(app()).get(EXPORT_URL).expect(401)).body, 'UNAUTHENTICATED');
    });
  });

  describe('POST /import', () => {
    it('round trips: export, import, export again gives the same data', async () => {
      const session = await arrange();
      const before = await getExport(session);

      const res = await request(app())
        .post(IMPORT_URL)
        .set(...bearer(session.accessToken))
        .send({ app: 'beta', schemaVersion: 1, habits: before.habits, logs: before.logs })
        .expect(200);
      expect(res.body).to.deep.equal({ habits: 2, logs: 3 });

      const after = await getExport(session);
      expect(after.habits).to.deep.equal(before.habits);
      expect(after.logs).to.deep.equal(before.logs);
    });

    it('replaces what was there rather than merging', async () => {
      const session = await arrange();
      const replacement = {
        app: 'beta' as const,
        schemaVersion: 1 as const,
        habits: [
          {
            id: randomUUID(),
            name: 'Only this',
            schedule: { kind: 'daily' as const },
            time: '06:00',
            remind: true,
            createdDayKey: '2026-09-10',
            archived: false,
            order: 0,
          },
        ],
        logs: [],
      };

      await request(app())
        .post(IMPORT_URL)
        .set(...bearer(session.accessToken))
        .send(replacement)
        .expect(200);

      const after = await getExport(session);
      expect(after.habits.map((habit) => habit.name)).to.deep.equal(['Only this']);
      expect(after.logs).to.deep.equal([]);
    });

    it('rebuilds the reminder plan afterwards', async () => {
      const session = await arrange();
      const before = await getExport(session);
      harness().queues.reset();

      await request(app())
        .post(IMPORT_URL)
        .set(...bearer(session.accessToken))
        .send({ app: 'beta', schemaVersion: 1, habits: before.habits, logs: before.logs })
        .expect(200);

      expect(harness().queues.uniqueRescheduled()).to.deep.equal([session.me.id]);
    });

    it('rejects a file that is not a Beta export', async () => {
      const session = await registerUser(app());

      for (const body of [
        { app: 'other', schemaVersion: 1, habits: [], logs: [] },
        { app: 'beta', schemaVersion: 2, habits: [], logs: [] },
        { app: 'beta', schemaVersion: 1, habits: [{ name: 'No id' }], logs: [] },
        { app: 'beta', schemaVersion: 1 },
      ]) {
        const res = await request(app())
          .post(IMPORT_URL)
          .set(...bearer(session.accessToken))
          .send(body)
          .expect(400);
        expectEnvelope(res.body, 'VALIDATION_ERROR');
      }
    });

    it('leaves the account untouched when the file is inconsistent', async () => {
      const session = await arrange();
      const before = await getExport(session);

      const res = await request(app())
        .post(IMPORT_URL)
        .set(...bearer(session.accessToken))
        .send({
          app: 'beta',
          schemaVersion: 1,
          habits: before.habits,
          // A log for a habit the file never defines: the import must fail
          // whole rather than leave the account half replaced.
          logs: [...before.logs, { habitId: randomUUID(), dayKey: '2026-09-17', status: 'done' }],
        })
        .expect(422);
      expectEnvelope(res.body, 'UNPROCESSABLE');

      const after = await getExport(session);
      expect(after.habits).to.deep.equal(before.habits);
      expect(after.logs).to.deep.equal(before.logs);
    });

    it('rolls back when the database refuses a row mid-transaction', async () => {
      const session = await arrange();
      const before = await getExport(session);
      const [first] = before.habits;
      if (first === undefined) throw new Error('fixture has no habits');

      // Two habits sharing an id: the first insert succeeds, the second
      // violates the primary key, and the whole replace must roll back.
      const res = await request(app())
        .post(IMPORT_URL)
        .set(...bearer(session.accessToken))
        .send({
          app: 'beta',
          schemaVersion: 1,
          habits: [first, { ...first, name: 'Clash' }],
          logs: [],
        })
        .expect(422);
      expectEnvelope(res.body, 'UNPROCESSABLE');

      const after = await getExport(session);
      expect(after.habits, 'the account must be exactly as it was').to.deep.equal(before.habits);
      expect(after.logs).to.deep.equal(before.logs);
    });

    it('cannot move data between accounts', async () => {
      const owner = await arrange();
      const intruder = await registerUser(app());
      await postHabit(app(), intruder, { name: 'Theirs' });
      const stolen = await getExport(owner);

      // The intruder imports the owner's file: the rows become the intruder's
      // own, and the owner keeps everything.
      await request(app())
        .post(IMPORT_URL)
        .set(...bearer(intruder.accessToken))
        .send({ app: 'beta', schemaVersion: 1, habits: stolen.habits, logs: stolen.logs })
        .expect(200);

      const ownerAfter = await getExport(owner);
      expect(ownerAfter.habits, "the owner's data is untouched").to.deep.equal(stolen.habits);

      // The originals still belong to the owner, and the intruder holds copies
      // under fresh ids rather than the owner's rows.
      const rows = await harness().prisma.habit.findMany({
        where: { id: { in: stolen.habits.map((habit) => habit.id) } },
        select: { userId: true },
      });
      expect(new Set(rows.map((row) => row.userId))).to.deep.equal(new Set([owner.me.id]));

      const intruderAfter = await getExport(intruder);
      expect(intruderAfter.habits.map((habit) => habit.name)).to.deep.equal(
        stolen.habits.map((habit) => habit.name),
      );
      const stolenIds = new Set(stolen.habits.map((habit) => habit.id));
      expect(intruderAfter.habits.every((habit) => !stolenIds.has(habit.id))).to.equal(true);
      // And their logs followed the rename rather than dangling.
      const intruderHabitIds = new Set(intruderAfter.habits.map((habit) => habit.id));
      expect(intruderAfter.logs.every((log) => intruderHabitIds.has(log.habitId))).to.equal(true);
      expect(intruderAfter.logs).to.have.length(stolen.logs.length);
    });

    it('requires a token', async () => {
      const res = await request(app())
        .post(IMPORT_URL)
        .send({ app: 'beta', schemaVersion: 1, habits: [], logs: [] })
        .expect(401);
      expectEnvelope(res.body, 'UNAUTHENTICATED');
    });
  });
});
