/**
 * Job queues (SPEC.md §10). Thin on purpose: M3 only needs the seam so services
 * can enqueue work and tests can assert on it. The workers themselves land in
 * M9 (`reschedule-user`, `dispatch-reminders`, `extend-windows`) and M10
 * (`send-email`).
 */
import { Queue, type ConnectionOptions } from 'bullmq';

export const QUEUE_NAMES = {
  rescheduleUser: 'reschedule-user',
  sendEmail: 'send-email',
} as const;

/**
 * A burst of taps must collapse into one job, so the reschedule job is keyed by
 * user and delayed 2 seconds (SPEC.md §10 step 2).
 */
export const RESCHEDULE_DEBOUNCE_MS = 2_000;

/**
 * One job per user, so a burst collapses into a single run.
 *
 * The separator is a hyphen because BullMQ rejects a custom job id containing
 * `:` — it builds its Redis keys with that character ("Custom Id cannot
 * contain :"). A colon here throws inside the event handler, which is
 * fire-and-forget, so the write still succeeds and nothing is ever scheduled.
 */
export const rescheduleJobId = (userId: string): string => `reschedule-${userId}`;

export type RescheduleUserJob = { userId: string };

export type SendEmailJob = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export interface Queues {
  rescheduleUser(userId: string): Promise<void>;
  sendEmail(payload: SendEmailJob): Promise<void>;
  /** Releases the underlying connections. Called on shutdown. */
  close(): Promise<void>;
}

/** BullMQ-backed queues. Owns its Redis connections and closes them. */
export class BullQueues implements Queues {
  private readonly reschedule: Queue<RescheduleUserJob>;
  private readonly email: Queue<SendEmailJob>;

  constructor(connection: ConnectionOptions) {
    const defaultJobOptions = {
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 24 * 3_600 },
    };
    this.reschedule = new Queue<RescheduleUserJob>(QUEUE_NAMES.rescheduleUser, {
      connection,
      defaultJobOptions: {
        ...defaultJobOptions,
        // The job id is the user's, which is what collapses a burst of taps
        // into one run — but BullMQ ignores `add` while a job with that id
        // still exists, *including* a finished one. Keeping history here would
        // therefore drop every later change by that user until the retention
        // window expired, and their reminders would silently stop being
        // rebuilt. The id has to be released the moment the run ends.
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
    this.email = new Queue<SendEmailJob>(QUEUE_NAMES.sendEmail, {
      connection,
      defaultJobOptions: {
        ...defaultJobOptions,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        // A job's payload is the whole message, and a password reset message
        // contains a live credential. Once it is delivered there is no reason
        // to keep it, and an hour of retention is an hour that link sits in
        // Redis. A *failed* one is kept, because it can still be retried and
        // because nobody received it.
        removeOnComplete: true,
      },
    });
  }

  async rescheduleUser(userId: string): Promise<void> {
    await this.reschedule.add(
      QUEUE_NAMES.rescheduleUser,
      { userId },
      { jobId: rescheduleJobId(userId), delay: RESCHEDULE_DEBOUNCE_MS },
    );
  }

  async sendEmail(payload: SendEmailJob): Promise<void> {
    await this.email.add(QUEUE_NAMES.sendEmail, payload);
  }

  async close(): Promise<void> {
    await Promise.all([this.reschedule.close(), this.email.close()]);
  }
}

/** Builds the BullMQ connection options for a Redis URL. */
export function queueConnection(redisUrl: string): ConnectionOptions {
  // BullMQ blocks on Redis, so retries must be unlimited.
  return { url: redisUrl, maxRetriesPerRequest: null };
}

/** Test double: records enqueued jobs instead of touching Redis. */
export class FakeQueues implements Queues {
  readonly rescheduled: string[] = [];
  readonly emails: SendEmailJob[] = [];

  async rescheduleUser(userId: string): Promise<void> {
    this.rescheduled.push(userId);
  }

  async sendEmail(payload: SendEmailJob): Promise<void> {
    this.emails.push(payload);
  }

  async close(): Promise<void> {
    // Nothing to release.
  }

  /** Distinct users scheduled — the deduplication BullMQ would do by `jobId`. */
  uniqueRescheduled(): string[] {
    return [...new Set(this.rescheduled)];
  }

  reset(): void {
    this.rescheduled.length = 0;
    this.emails.length = 0;
  }
}
