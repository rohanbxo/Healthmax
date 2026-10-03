/**
 * Test application builder (SPEC.md §3: "tests pass fakes").
 *
 * Real Postgres (`DATABASE_URL_TEST`) and real Redis (logical database
 * {@link REDIS_TEST_DB}) so the SQL and the Redis-backed rate limiter are
 * genuinely exercised; everything with a side effect outside the process —
 * clock, email, push, queues, object storage — is a fake the test can inspect.
 */
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import type { Logger } from 'pino';

import { createApp, type AppDeps } from '../../src/app';
import { loadConfig, type Config } from '../../src/config';
import { createLogger } from '../../src/http/logger';
import { FixedClock } from '../../src/lib/clock';
import { FakeMailer } from '../../src/lib/mailer';
import { FakePushSender } from '../../src/lib/pushSender';
import { FakeObjectStore } from '../../src/lib/objectStore';
import { RecordingEventBus } from '../../src/events/bus';
import { FakeQueues } from '../../src/jobs/queues';
import { loadTestEnv, requireEnv, REDIS_TEST_DB } from './env';
import { resetDatabase, resetRedis } from './db';

/** 2026-09-17T06:00:00.000Z — a fixed instant so tests never race the wall clock. */
export const TEST_NOW_MS = 1_789_624_800_000;

/** The key `GET /push/vapid-public-key` serves in tests. */
export const TEST_VAPID_PUBLIC_KEY = 'test-vapid-public-key';

export type TestHarness = {
  app: Express;
  deps: AppDeps;
  config: Config;
  prisma: PrismaClient;
  redis: Redis;
  logger: Logger;
  clock: FixedClock;
  mailer: FakeMailer;
  pushSender: FakePushSender;
  objectStore: FakeObjectStore;
  queues: FakeQueues;
  eventBus: RecordingEventBus;
  /** Empties Postgres and Redis and clears every fake. */
  reset(): Promise<void>;
  close(): Promise<void>;
};

/** The environment's value, or `fallback` when it is missing or blank. */
function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value : fallback;
}

function testConfig(): Config {
  loadTestEnv();
  return loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    ROLE: 'api',
    // The dev database must never be touched by the suite (SPEC.md §13).
    DATABASE_URL: requireEnv('DATABASE_URL_TEST'),
    JWT_SECRET: process.env.JWT_SECRET ?? 'test-secret-that-is-at-least-32-characters-long',
    APP_URL: process.env.APP_URL ?? 'http://localhost:5173',
    DOCS_ENABLED: 'true',
    LOG_LEVEL: 'silent',
    // Required from M9 (SPEC.md §14). Nothing is signed with these: every test
    // sends through `FakePushSender`. A blank value in `.env` counts as unset.
    VAPID_PUBLIC_KEY: envOr('VAPID_PUBLIC_KEY', TEST_VAPID_PUBLIC_KEY),
    VAPID_PRIVATE_KEY: envOr('VAPID_PRIVATE_KEY', 'test-vapid-private-key'),
    VAPID_SUBJECT: envOr('VAPID_SUBJECT', 'mailto:test@example.com'),
  });
}

let harness: TestHarness | undefined;

/** Builds the harness once per process; reuses it across suites. */
export async function getTestHarness(): Promise<TestHarness> {
  if (harness) return harness;

  const config = testConfig();
  const prisma = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
  const redis = new Redis(config.REDIS_URL, { db: REDIS_TEST_DB, maxRetriesPerRequest: null });
  const logger = createLogger(config);
  const clock = new FixedClock(TEST_NOW_MS);
  const mailer = new FakeMailer();
  const pushSender = new FakePushSender();
  const objectStore = new FakeObjectStore();
  const queues = new FakeQueues();
  const eventBus = new RecordingEventBus();

  const deps: AppDeps = {
    prisma,
    redis,
    queues,
    clock,
    eventBus,
    mailer,
    pushSender,
    objectStore,
    config,
    logger,
  };
  const app = createApp(deps);

  harness = {
    app,
    deps,
    config,
    prisma,
    redis,
    logger,
    clock,
    mailer,
    pushSender,
    objectStore,
    queues,
    eventBus,
    async reset() {
      await resetDatabase(prisma);
      await resetRedis(redis);
      clock.set(TEST_NOW_MS);
      mailer.reset();
      pushSender.reset();
      objectStore.reset();
      queues.reset();
      eventBus.reset();
    },
    async close() {
      harness = undefined;
      await prisma.$disconnect();
      redis.disconnect();
    },
  };

  return harness;
}

/**
 * Registers the mocha hooks a suite needs and returns an accessor:
 *
 *     const getApp = useTestApp();
 *     it('...', async () => { await request(getApp().app).get('/api/health'); });
 */
export function useTestApp(): () => TestHarness {
  let current: TestHarness | undefined;

  before(async function setUpTestApp() {
    this.timeout(30_000);
    current = await getTestHarness();
  });

  beforeEach(async () => {
    await current?.reset();
  });

  after(async () => {
    await current?.close();
    current = undefined;
  });

  return () => {
    if (!current) throw new Error('useTestApp() must be called inside a describe block');
    return current;
  };
}
