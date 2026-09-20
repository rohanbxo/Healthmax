/**
 * The `send-email` worker (SPEC.md §9 forgot-password, §10).
 *
 * `POST /auth/forgot-password` answers 204 whatever happens and enqueues the
 * message, so the response time never reveals whether the address exists, and
 * a slow or failing mail provider cannot hold up the request. This is the
 * consumer: it hands each job to the injected `Mailer`.
 *
 * The queue retries three times with exponential backoff (see `queues.ts`).
 * A job that still fails is left in the failed set, and logged — a reset link
 * that never arrives must be visible to whoever is on call.
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import type { Logger } from 'pino';

import type { Mailer } from '../lib/mailer';
import { QUEUE_NAMES, type SendEmailJob } from './queues';

export type EmailWorkerDeps = {
  mailer: Mailer;
  connection: ConnectionOptions;
  logger: Logger;
};

export type EmailWorker = { close(): Promise<void> };

export function startEmailWorker(deps: EmailWorkerDeps): EmailWorker {
  const worker = new Worker<SendEmailJob>(
    QUEUE_NAMES.sendEmail,
    async (job) => {
      await deps.mailer.send(job.data);
      // The subject, never the body: a reset link in the log is a live
      // credential (SPEC.md §12).
      deps.logger.info({ subject: job.data.subject }, 'Sent an email');
    },
    { connection: deps.connection },
  );

  worker.on('failed', (job, err) => {
    deps.logger.error(
      { err, attempts: job?.attemptsMade, subject: job?.data.subject },
      'Email job failed',
    );
  });

  return { close: () => worker.close() };
}
