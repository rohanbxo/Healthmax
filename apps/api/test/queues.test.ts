/**
 * The queue wiring, against real BullMQ and real Redis (SPEC.md §10).
 *
 * Every other reminder test drives the handlers through `FakeQueues`, which
 * only records a user id. That is exactly why a broken `jobId` survived from
 * M3 to M9: BullMQ rejects a custom job id containing `:` ("Custom Id cannot
 * contain :"), the event handler is fire-and-forget, and the failure only ever
 * reached the log. Nothing was ever scheduled, so no reminder could fire.
 *
 * So these tests use the real `BullQueues` and the real workers.
 */
import { expect } from 'chai';
import { randomUUID } from 'node:crypto';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

import {
  BullQueues,
  QUEUE_NAMES,
  RESCHEDULE_DEBOUNCE_MS,
  queueConnection,
  rescheduleJobId,
} from '../src/jobs/queues';
import {
  DISPATCH_INTERVAL_MS,
  EXTEND_INTERVAL_MS,
  REMINDER_QUEUE_NAMES,
  startReminderWorkers,
  type ReminderWorkers,
} from '../src/jobs/reminderWorkers';
import { useTestApp } from './helpers/testApp';

/** A Redis database of its own, so a run never disturbs the dev queues. */
const QUEUE_TEST_DB = 3;

describe('queues', () => {
  const harness = useTestApp();
  let connection: ConnectionOptions;
  let queues: BullQueues;

  before(function setUpQueues() {
    this.timeout(20_000);
    const url = new URL(harness().config.REDIS_URL);
    url.pathname = `/${QUEUE_TEST_DB}`;
    connection = queueConnection(url.toString());
    queues = new BullQueues(connection);
  });

  after(async () => {
    await queues?.close();
  });

  const drain = async (name: string): Promise<Queue> => {
    const queue = new Queue(name, { connection });
    await queue.obliterate({ force: true });
    return queue;
  };

  describe('reschedule-user', () => {
    it('enqueues a job BullMQ accepts, keyed and deduplicated by user', async () => {
      const queue = await drain(QUEUE_NAMES.rescheduleUser);
      const userId = randomUUID();

      try {
        // Five taps, as SPEC.md §10 step 2 describes.
        for (let i = 0; i < 5; i += 1) await queues.rescheduleUser(userId);

        const jobs = await queue.getDelayed();
        expect(jobs, 'a burst collapses into one job').to.have.length(1);
        expect(jobs[0]?.id).to.equal(rescheduleJobId(userId));
        expect(jobs[0]?.data).to.deep.equal({ userId });
        expect(jobs[0]?.opts.delay).to.equal(RESCHEDULE_DEBOUNCE_MS);
      } finally {
        await queue.obliterate({ force: true });
        await queue.close();
      }
    });

    it('builds a job id BullMQ allows', () => {
      const id = rescheduleJobId(randomUUID());
      // BullMQ splits its Redis keys on ':' and refuses ids containing one.
      expect(id).to.not.include(':');
    });

    it('accepts the next change once the previous run has finished', async function releasesTheId() {
      this.timeout(20_000);
      const queue = await drain(QUEUE_NAMES.rescheduleUser);
      const userId = randomUUID();

      try {
        await queues.rescheduleUser(userId);

        // Let a real worker finish that run.
        const worker = new Worker(QUEUE_NAMES.rescheduleUser, async () => {}, { connection });
        await new Promise<void>((resolve, reject) => {
          worker.on('completed', () => resolve());
          worker.on('error', reject);
        });
        await worker.close();

        // A later habit or log change must schedule another rebuild. BullMQ
        // ignores `add` while a job with the same id still exists, so keeping
        // completed jobs here would silently stop rebuilding this user's plan.
        await queues.rescheduleUser(userId);

        const waiting = (await queue.getDelayedCount()) + (await queue.getWaitingCount());
        expect(waiting, 'the second change was swallowed').to.equal(1);
      } finally {
        await queue.obliterate({ force: true });
        await queue.close();
      }
    });

    it('separates two users', async () => {
      const queue = await drain(QUEUE_NAMES.rescheduleUser);
      try {
        await queues.rescheduleUser(randomUUID());
        await queues.rescheduleUser(randomUUID());

        expect(await queue.getDelayedCount()).to.equal(2);
      } finally {
        await queue.obliterate({ force: true });
        await queue.close();
      }
    });
  });

  describe('repeatable schedulers', () => {
    let workers: ReminderWorkers | undefined;

    afterEach(async () => {
      await workers?.close();
      workers = undefined;
    });

    it('registers dispatch-reminders and extend-windows at boot', async function registersSchedulers() {
      this.timeout(20_000);
      const dispatch = await drain(REMINDER_QUEUE_NAMES.dispatchReminders);
      const extend = await drain(REMINDER_QUEUE_NAMES.extendWindows);

      try {
        workers = await startReminderWorkers({
          prisma: harness().prisma,
          clock: harness().clock,
          pushSender: harness().pushSender,
          queues,
          connection,
          logger: harness().logger,
        });

        // Without these the dispatcher never runs and no reminder is ever sent,
        // however correct the handlers are.
        const dispatchSchedulers = await dispatch.getJobSchedulers();
        expect(dispatchSchedulers.map((s) => s.key)).to.deep.equal(['dispatch']);
        expect(Number(dispatchSchedulers[0]?.every)).to.equal(DISPATCH_INTERVAL_MS);

        const extendSchedulers = await extend.getJobSchedulers();
        expect(extendSchedulers.map((s) => s.key)).to.deep.equal(['extend']);
        expect(Number(extendSchedulers[0]?.every)).to.equal(EXTEND_INTERVAL_MS);

        // Registration alone is not proof: wait for the first tick to actually
        // run, and for the scheduler to have queued the one after it.
        const deadline = Date.now() + 10_000;
        let completed = 0;
        while (completed === 0 && Date.now() < deadline) {
          completed = await dispatch.getCompletedCount();
          if (completed === 0) await new Promise((resolve) => setTimeout(resolve, 200));
        }
        expect(completed, 'dispatch-reminders never ran').to.be.greaterThan(0);
        expect(Number((await dispatch.getJobSchedulers())[0]?.next)).to.be.greaterThan(Date.now());
      } finally {
        await dispatch.obliterate({ force: true });
        await extend.obliterate({ force: true });
        await dispatch.close();
        await extend.close();
      }
    });
  });
});
