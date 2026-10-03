/**
 * Process entry point (SPEC.md §3, §10 "Worker process").
 *
 * Builds the real dependencies, then starts the HTTP server, the worker, or
 * both, according to `ROLE`. This is the only file that constructs a Prisma or
 * Redis client.
 */
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';

import { createApp, type AppDeps } from './app';
import { ConfigError, loadConfig, type Config } from './config';
import { createLogger } from './http/logger';
import { SystemClock } from './lib/clock';
import { awsClientConfig } from './lib/aws';
import { ResendMailer, type MailMessage, type Mailer } from './lib/mailer';
import { SesMailer } from './lib/sesMailer';
import { S3ObjectStore, type ObjectStore } from './lib/objectStore';
import { WebPushSender, type PushResult, type PushSender } from './lib/pushSender';
import { InProcessEventBus } from './events/bus';
import { BullQueues, queueConnection, type Queues } from './jobs/queues';
import { startReminderWorkers, type ReminderWorkers } from './jobs/reminderWorkers';
import { startEmailWorker, type EmailWorker } from './jobs/emailWorker';

/**
 * Chosen by `EMAIL_PROVIDER`; `loadConfig` has already checked that the chosen
 * provider has what it needs. With none, refuse loudly.
 */
function createMailer(config: Config, logger: Logger): Mailer {
  if (config.EMAIL_PROVIDER === 'resend' && config.RESEND_API_KEY && config.EMAIL_FROM) {
    return new ResendMailer(config.RESEND_API_KEY, config.EMAIL_FROM);
  }
  if (config.EMAIL_PROVIDER === 'ses' && config.EMAIL_FROM) {
    logger.info(
      { region: config.AWS_REGION, endpoint: config.AWS_ENDPOINT_URL ?? 'aws' },
      'Sending email through SES',
    );
    return new SesMailer(awsClientConfig(config), config.EMAIL_FROM);
  }
  logger.warn('EMAIL_PROVIDER is none — outbound email is disabled.');
  return {
    async send(msg: MailMessage): Promise<void> {
      throw new Error(`Email is not configured; refusing to send "${msg.subject}".`);
    },
  };
}

/** VAPID keys are generated before M9 (SPEC.md §14). */
function createPushSender(config: Config, logger: Logger): PushSender {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = config;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
    return new WebPushSender({
      subject: VAPID_SUBJECT,
      publicKey: VAPID_PUBLIC_KEY,
      privateKey: VAPID_PRIVATE_KEY,
    });
  }
  logger.warn('VAPID_* keys are not set — Web Push is disabled.');
  return {
    async send(): Promise<PushResult> {
      return { status: 'failed', reason: 'push is not configured' };
    },
  };
}

/** Cloud export needs a bucket; without one the endpoint answers 404. */
function createObjectStore(config: Config, logger: Logger): ObjectStore | undefined {
  const store = S3ObjectStore.fromConfig(config);
  if (store === undefined) {
    logger.warn('S3_EXPORT_BUCKET is not set — cloud export is disabled.');
    return undefined;
  }
  logger.info(
    {
      region: config.AWS_REGION,
      bucket: config.S3_EXPORT_BUCKET,
      endpoint: config.AWS_ENDPOINT_URL ?? 'aws',
      publicEndpoint: config.AWS_PUBLIC_ENDPOINT_URL ?? config.AWS_ENDPOINT_URL ?? 'aws',
    },
    'Cloud export to S3 is enabled',
  );
  return store;
}

type Runtime = {
  config: Config;
  logger: Logger;
  prisma: PrismaClient;
  redis: Redis;
  queues: Queues;
  deps: AppDeps;
};

function buildRuntime(config: Config): Runtime {
  const logger = createLogger(config);
  const prisma = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const queues: Queues = new BullQueues(queueConnection(config.REDIS_URL));
  const eventBus = new InProcessEventBus((error, event) => {
    logger.error(
      { err: error, event: event.type, userId: event.userId },
      'Domain event handler failed',
    );
  });

  // `createApp` subscribes the reminder scheduler to this bus; the worker role
  // consumes the jobs it enqueues.

  return {
    config,
    logger,
    prisma,
    redis,
    queues,
    deps: {
      prisma,
      redis,
      queues,
      clock: new SystemClock(),
      eventBus,
      mailer: createMailer(config, logger),
      pushSender: createPushSender(config, logger),
      objectStore: createObjectStore(config, logger),
      config,
      logger,
    },
  };
}

/** Closes each resource once, in dependency order, tolerating failures. */
async function shutdown(
  runtime: Runtime,
  httpServer: Server | undefined,
  workers: (ReminderWorkers | EmailWorker | undefined)[],
  signal: string,
): Promise<void> {
  const { logger } = runtime;
  logger.info({ signal }, 'Shutting down');

  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer.close(() => {
        resolve();
      });
    });
  }

  const closers: [string, () => Promise<unknown>][] = [
    // Workers first: a job in flight still needs Prisma and Redis.
    ...workers
      .filter((worker): worker is ReminderWorkers | EmailWorker => worker !== undefined)
      .map((worker, index): [string, () => Promise<unknown>] => [
        `worker ${index + 1}`,
        () => worker.close(),
      ]),
    ['queues', () => runtime.queues.close()],
    ['prisma', () => runtime.prisma.$disconnect()],
    ['redis', () => runtime.redis.quit()],
  ];
  for (const [name, close] of closers) {
    try {
      await close();
    } catch (err) {
      logger.error({ err, resource: name }, 'Failed to close resource cleanly');
    }
  }
  logger.info('Shutdown complete');
}

export async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      // The logger needs a valid config, so this one goes straight to stderr.
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const runtime = buildRuntime(config);
  const { logger } = runtime;
  let httpServer: Server | undefined;

  if (config.ROLE === 'api' || config.ROLE === 'all') {
    const app = createApp(runtime.deps);
    httpServer = app.listen(config.PORT, () => {
      logger.info(
        {
          port: config.PORT,
          role: config.ROLE,
          env: config.NODE_ENV,
          trustProxy: config.TRUST_PROXY,
        },
        'API listening',
      );
    });
  }

  let workers: ReminderWorkers | undefined;
  let emailWorker: EmailWorker | undefined;
  if (config.ROLE === 'worker' || config.ROLE === 'all') {
    emailWorker = startEmailWorker({
      mailer: runtime.deps.mailer,
      connection: queueConnection(config.REDIS_URL),
      logger,
    });
    workers = await startReminderWorkers({
      prisma: runtime.prisma,
      clock: runtime.deps.clock,
      pushSender: runtime.deps.pushSender,
      queues: runtime.queues,
      connection: queueConnection(config.REDIS_URL),
      logger,
    });
    logger.info({ role: config.ROLE }, 'Reminder workers started');
  }

  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void shutdown(runtime, httpServer, [workers, emailWorker], signal).then(() => {
        process.exit(0);
      });
    });
  }
}

if (require.main === module) {
  void main();
}
