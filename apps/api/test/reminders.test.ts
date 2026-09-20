/**
 * Reminders (SPEC.md §10, §13 "API tests"): a burst of taps collapses into one
 * deduplicated job; the reschedule output matches the core plan; the dispatcher
 * sends once, never twice under concurrency, and stays quiet for a day that was
 * logged after planning; a `410` deletes the subscription; a stale occurrence is
 * cancelled rather than sent.
 *
 * The service is driven directly. BullMQ's own delivery is not under test here
 * — what matters is that the handlers do the right thing when they run.
 */
import { expect } from 'chai';
import request from 'supertest';
import { MS_PER_HOUR, MS_PER_MINUTE, planReminders, type HabitDTO } from '@beta/core';

import { buildReminderService } from '../src/jobs/reminderWorkers';
import { STALE_AFTER_MS, SNOOZED_BODY, DUE_BODY } from '../src/modules/reminders/service';
import { createReminderRepository } from '../src/modules/reminders/repository';
import { MAX_PUSH_FAILURES } from '../src/modules/push/repository';
import { TEST_NOW_MS, useTestApp, type TestHarness } from './helpers/testApp';
import { bearer, registerUser, type Session } from './helpers/auth';
import { createHabit, createPushSubscription, createReminder } from './helpers/factories';
import { logUrl, postHabit, snoozeUrl } from './helpers/routes';

/** The harness clock: 2026-09-17T06:00Z, 10:00 Thursday in Dubai. */
const TODAY = '2026-09-17';
const TOMORROW = '2026-09-18';

describe('reminders', () => {
  const harness = useTestApp();
  const app = () => harness().app;
  const service = (current: TestHarness = harness()) =>
    buildReminderService({
      prisma: current.prisma,
      clock: current.clock,
      pushSender: current.pushSender,
      queues: current.queues,
    });
  const reminders = () => createReminderRepository(harness().prisma);

  /** A Dubai user whose habit is due at 18:00 today, with one device. */
  const arrange = async (): Promise<{ session: Session; habit: HabitDTO; endpoint: string }> => {
    const session = await registerUser(app(), { timeZone: 'Asia/Dubai' });
    const habit = await postHabit(app(), session, { name: 'Evening run', time: '18:00' });
    const subscription = await createPushSubscription(harness().prisma, { userId: session.me.id });
    harness().queues.reset();
    return { session, habit, endpoint: subscription.endpoint };
  };

  describe('scheduling', () => {
    it('collapses a burst of five taps into one deduplicated job', async () => {
      const { session, habit } = await arrange();

      // Tap, change your mind, tap again: five writes to the same day.
      for (const status of ['done', 'skipped', 'done', 'skipped', 'done']) {
        await request(app())
          .put(logUrl(habit.id, TODAY))
          .set(...bearer(session.accessToken))
          .send({ status })
          .expect(200);
      }

      // Five events, five enqueues — but one `jobId`, so BullMQ runs it once.
      expect(harness().queues.rescheduled).to.have.length(5);
      expect(harness().queues.uniqueRescheduled()).to.deep.equal([session.me.id]);
    });

    it('enqueues a reschedule for a snooze and for a schedule change too', async () => {
      const { session, habit } = await arrange();

      await request(app())
        .put(snoozeUrl(habit.id))
        .set(...bearer(session.accessToken))
        .send({ minutes: 15 })
        .expect(200);
      await request(app())
        .patch('/api/me')
        .set(...bearer(session.accessToken))
        .send({ timeZone: 'America/Los_Angeles' })
        .expect(200);

      expect(harness().queues.rescheduled).to.have.length(2);
    });

    it('writes exactly the plan core computed', async () => {
      const { session } = await arrange();
      const daily = await postHabit(app(), session, { name: 'Read', time: '21:00' });
      const weekly = await postHabit(app(), session, {
        name: 'Gym',
        time: '07:00',
        schedule: { kind: 'timesPerWeek', count: 2 },
      });
      const silent = await postHabit(app(), session, {
        name: 'Silent',
        time: '09:00',
        remind: false,
      });
      const habits = (
        await request(app())
          .get('/api/habits')
          .set(...bearer(session.accessToken))
          .expect(200)
      ).body as HabitDTO[];

      const { planned } = await service().rescheduleUser(session.me.id);

      const expected = planReminders({
        habits,
        logs: [],
        snoozes: [],
        now: TEST_NOW_MS,
        tz: 'Asia/Dubai',
        weekStart: 1,
      });
      const pending = await reminders().listPending(session.me.id);

      expect(planned).to.equal(expected.length);
      expect(
        pending.map((row) => ({ habitId: row.habitId, dayKey: row.dayKey, fireAt: row.fireAtMs })),
      ).to.deep.equal(expected);
      // Sanity: the silent habit is absent, the others are there.
      expect(pending.map((row) => row.habitId)).to.not.include(silent.id);
      expect(pending.map((row) => row.habitId)).to.include.members([daily.id, weekly.id]);
    });

    it('replaces the previous plan instead of adding to it', async () => {
      const { session } = await arrange();
      await service().rescheduleUser(session.me.id);
      const first = await reminders().listPending(session.me.id);

      await service().rescheduleUser(session.me.id);
      const second = await reminders().listPending(session.me.id);

      expect(second).to.have.length(first.length);
      expect(second.map((row) => row.id)).to.not.have.members(first.map((row) => row.id));
    });

    it('moves a snoozed habit to its snooze time', async () => {
      const { session, habit } = await arrange();
      // 10:00 Dubai now; snoozing 60 minutes puts the reminder at 11:00, well
      // before the habit's own 18:00.
      await request(app())
        .put(snoozeUrl(habit.id))
        .set(...bearer(session.accessToken))
        .send({ minutes: 60 })
        .expect(200);

      await service().rescheduleUser(session.me.id);
      const [today] = await reminders().listPending(session.me.id);

      expect(today?.dayKey).to.equal(TODAY);
      expect(today?.fireAtMs).to.equal(TEST_NOW_MS + MS_PER_HOUR);
    });

    it('leaves a logged day out of the plan', async () => {
      const { session, habit } = await arrange();
      await request(app())
        .put(logUrl(habit.id, TODAY))
        .set(...bearer(session.accessToken))
        .send({ status: 'done' })
        .expect(200);

      await service().rescheduleUser(session.me.id);
      const pending = await reminders().listPending(session.me.id);

      expect(pending.map((row) => row.dayKey)).to.deep.equal([TOMORROW]);
    });
  });

  describe('dispatching', () => {
    it('sends one notification per due occurrence, with the habit as the title', async () => {
      const { session, habit, endpoint } = await arrange();
      await createReminder(harness().prisma, {
        userId: session.me.id,
        habitId: habit.id,
        dayKey: TODAY,
        fireAtMs: TEST_NOW_MS - MS_PER_MINUTE,
      });

      const report = await service().dispatchDue();

      expect(report).to.deep.equal({ claimed: 1, sent: 1, cancelled: 0, removed: 0 });
      expect(harness().pushSender.sent).to.have.length(1);
      const [delivery] = harness().pushSender.sent;
      expect(delivery?.sub.endpoint).to.equal(endpoint);
      expect(delivery?.payload).to.deep.equal({
        title: 'Evening run',
        body: DUE_BODY,
        url: '/',
        tag: `habit:${habit.id}:${TODAY}`,
      });

      // Claimed rows are marked, so a second run has nothing to do.
      expect(await service().dispatchDue()).to.deep.include({ claimed: 0, sent: 0 });
    });

    it('says "snoozed" when the occurrence was moved off its due time', async () => {
      const { session, habit } = await arrange();
      await createReminder(harness().prisma, {
        userId: session.me.id,
        habitId: habit.id,
        dayKey: TODAY,
        // The habit is due at 18:00 Dubai; this fires later, so it is a snooze.
        fireAtMs: TEST_NOW_MS + 12 * MS_PER_HOUR,
      });
      harness().clock.set(TEST_NOW_MS + 12 * MS_PER_HOUR);

      await service().dispatchDue();

      expect(harness().pushSender.sent[0]?.payload.body).to.equal(SNOOZED_BODY);
    });

    it('never sends the same occurrence twice when two dispatchers run at once', async () => {
      const { session, habit } = await arrange();
      for (const dayKey of ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', TODAY]) {
        await createReminder(harness().prisma, {
          userId: session.me.id,
          habitId: habit.id,
          dayKey,
          // All within the stale window, so every one is sendable.
          fireAtMs: TEST_NOW_MS - MS_PER_MINUTE,
        });
      }

      const [first, second] = await Promise.all([service().dispatchDue(), service().dispatchDue()]);

      // Between them they claim all five, and each row is claimed by exactly one.
      expect(first.claimed + second.claimed).to.equal(5);
      expect(first.sent + second.sent).to.equal(5);
      const tags = harness().pushSender.sent.map((record) => record.payload.tag);
      expect(tags).to.have.length(5);
      expect(new Set(tags).size, 'no tag sent twice').to.equal(5);
    });

    it('does not send an occurrence for a day that was logged after planning', async () => {
      const { session, habit } = await arrange();
      await createReminder(harness().prisma, {
        userId: session.me.id,
        habitId: habit.id,
        dayKey: TODAY,
        fireAtMs: TEST_NOW_MS - MS_PER_MINUTE,
      });

      await request(app())
        .put(logUrl(habit.id, TODAY))
        .set(...bearer(session.accessToken))
        .send({ status: 'done' })
        .expect(200);

      const report = await service().dispatchDue();

      expect(report).to.deep.include({ claimed: 1, sent: 0, cancelled: 1 });
      expect(harness().pushSender.sent).to.have.length(0);
    });

    it('cancels an occurrence whose habit was archived or silenced since planning', async () => {
      const { session } = await arrange();
      const archived = await createHabit(harness().prisma, session.me.id, {
        name: 'Archived',
        archived: true,
      });
      await createReminder(harness().prisma, {
        userId: session.me.id,
        habitId: archived.id,
        dayKey: TODAY,
        fireAtMs: TEST_NOW_MS - MS_PER_MINUTE,
      });

      const report = await service().dispatchDue();

      expect(report).to.deep.include({ claimed: 1, sent: 0, cancelled: 1 });
      expect(harness().pushSender.sent).to.have.length(0);
    });

    it('cancels a stale occurrence instead of sending it', async () => {
      const { session, habit } = await arrange();
      await createReminder(harness().prisma, {
        userId: session.me.id,
        habitId: habit.id,
        dayKey: '2026-09-16',
        // Over two hours late: the host was asleep (SPEC.md §10.6).
        fireAtMs: TEST_NOW_MS - STALE_AFTER_MS - MS_PER_MINUTE,
      });

      const report = await service().dispatchDue();

      expect(report).to.deep.include({ claimed: 1, sent: 0, cancelled: 1 });
      expect(harness().pushSender.sent).to.have.length(0);
    });

    it('deletes a subscription the push service reports as gone', async () => {
      const { session, habit, endpoint } = await arrange();
      const alive = await createPushSubscription(harness().prisma, { userId: session.me.id });
      harness().pushSender.script(endpoint, { status: 'gone', statusCode: 410 });
      await createReminder(harness().prisma, {
        userId: session.me.id,
        habitId: habit.id,
        dayKey: TODAY,
        fireAtMs: TEST_NOW_MS - MS_PER_MINUTE,
      });

      const report = await service().dispatchDue();

      expect(report).to.deep.include({ sent: 1, removed: 1 });
      const left = await harness().prisma.pushSubscription.findMany({ select: { endpoint: true } });
      expect(left.map((row) => row.endpoint)).to.deep.equal([alive.endpoint]);
    });

    it('drops a subscription after five consecutive failures, not before', async () => {
      const { session, habit, endpoint } = await arrange();
      await harness().prisma.pushSubscription.updateMany({
        where: { endpoint },
        data: { failureCount: MAX_PUSH_FAILURES - 2 },
      });
      harness().pushSender.script(endpoint, { status: 'failed', reason: 'timeout' });

      const fire = async (dayKey: string) => {
        await createReminder(harness().prisma, {
          userId: session.me.id,
          habitId: habit.id,
          dayKey,
          fireAtMs: TEST_NOW_MS - MS_PER_MINUTE,
        });
        return service().dispatchDue();
      };

      await fire('2026-09-16');
      expect(
        await harness().prisma.pushSubscription.count({ where: { endpoint } }),
        'four failures is not five',
      ).to.equal(1);

      const second = await fire(TODAY);
      expect(second.removed).to.equal(1);
      expect(await harness().prisma.pushSubscription.count({ where: { endpoint } })).to.equal(0);
    });

    it('sends only to the owner of the occurrence', async () => {
      const { session, habit } = await arrange();
      const stranger = await registerUser(app(), { timeZone: 'Asia/Dubai' });
      await createPushSubscription(harness().prisma, { userId: stranger.me.id });
      await createReminder(harness().prisma, {
        userId: session.me.id,
        habitId: habit.id,
        dayKey: TODAY,
        fireAtMs: TEST_NOW_MS - MS_PER_MINUTE,
      });

      await service().dispatchDue();

      expect(harness().pushSender.sent).to.have.length(1);
      expect(harness().pushSender.sent[0]?.sub.endpoint).to.not.equal(stranger.me.id);
    });
  });

  describe('extend-windows', () => {
    it('enqueues a reschedule for every user with a reminding habit', async () => {
      const first = await registerUser(app());
      const second = await registerUser(app());
      const silentOnly = await registerUser(app());
      await postHabit(app(), first);
      await postHabit(app(), second);
      await postHabit(app(), silentOnly, { remind: false });
      harness().queues.reset();

      const { users } = await service().extendWindows();

      expect(users).to.equal(2);
      expect(harness().queues.uniqueRescheduled().sort()).to.deep.equal(
        [first.me.id, second.me.id].sort(),
      );
    });
  });
});
