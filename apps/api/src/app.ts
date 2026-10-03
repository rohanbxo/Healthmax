/**
 * Composition root (SPEC.md §3 "Dependency injection").
 *
 * `createApp` receives every collaborator it needs. Nothing under `src/`
 * imports a singleton Prisma or Redis client: production wires the real ones in
 * `server.ts`, tests pass `FixedClock`, `FakeMailer`, `FakePushSender`,
 * `FakeQueues` and `FakeObjectStore`.
 */
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

import type { Config } from './config';
import type { Clock } from './lib/clock';
import type { Mailer } from './lib/mailer';
import type { PushSender } from './lib/pushSender';
import type { ObjectStore } from './lib/objectStore';
import type { EventBus } from './events/bus';
import type { Queues } from './jobs/queues';

import { requestId } from './http/requestId';
import { httpLogger } from './http/logger';
import { errorHandler } from './http/errors';
import { globalRateLimit } from './http/rateLimit';
import { notFoundHandler } from './http/notFound';
import { createDocsRouter } from './http/openapi';
import { serveStaticSite } from './http/staticSite';
import { createHealthRouter, HEALTH_PATH } from './modules/health/routes';
import { AUTH_PATH, createAuthRouter } from './modules/auth/routes';
import { createMeRouter, ME_PATH } from './modules/me/routes';
import { createHabitsRouter, HABITS_PATH } from './modules/habits/routes';
import { createLogsRouter } from './modules/logs/routes';
import { createSnoozesRouter } from './modules/snoozes/routes';
import { createTodayRouter, TODAY_PATH } from './modules/today/routes';
import { createRedisStatsCache, type StatsCache } from './modules/stats/cache';
import { createStatsRouter, STATS_PATH } from './modules/stats/routes';
import { createPushRouter, PUSH_PATH } from './modules/push/routes';
import { createTransferRouter } from './modules/transfer/routes';
import './http/types';

export type AppDeps = {
  prisma: PrismaClient;
  redis: Redis;
  queues: Queues;
  clock: Clock;
  eventBus: EventBus;
  mailer: Mailer;
  pushSender: PushSender;
  /** `undefined` when `S3_EXPORT_BUCKET` is unset: cloud export is disabled. */
  objectStore: ObjectStore | undefined;
  config: Config;
  logger: Logger;
};

/** Every route lives under `/api` (SPEC.md §9). */
export const API_BASE_PATH = '/api';

/** Request bodies are small JSON documents (SPEC.md §12 "Body size limit"). */
export const JSON_BODY_LIMIT = '100kb';

/**
 * Content Security Policy sized for the built web app, which the API serves
 * from the same origin in production (SPEC.md §12, §13 "Docker").
 * Geist and Geist Mono come from Google Fonts (SPEC.md §4).
 */
function contentSecurityPolicy(config: Config) {
  return {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      scriptSrc: ["'self'"],
      // Radix and Tailwind's runtime styles are injected inline.
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      // Only meaningful over HTTPS; it would break http://localhost.
      ...(config.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {}),
    },
  };
}

/**
 * Drops a user's cached stats whenever something they are computed from moves
 * (SPEC.md §9 "Stats cache"). `user.scheduleChanged` is included because a
 * `weekStart` change regroups every `timesPerWeek` week; snoozes never affect
 * stats (SPEC.md §6), so `snooze.changed` is not.
 */
function invalidateStatsOnChange(eventBus: EventBus, cache: StatsCache): void {
  const drop = (event: { userId: string }) => cache.invalidate(event.userId);
  eventBus.on('habit.changed', drop);
  eventBus.on('log.changed', drop);
  eventBus.on('user.scheduleChanged', drop);
}

/**
 * Rebuilds a user's reminder plan whenever something it is derived from moves
 * (SPEC.md §10 steps 1–2). The queue keys the job by user and delays it two
 * seconds, so a burst of taps collapses into one `reschedule-user` run.
 *
 * Fire-and-forget by design: a queue that is down must not fail the write the
 * user just made. `InProcessEventBus` reports the rejection to the logger.
 */
function rescheduleRemindersOnChange(eventBus: EventBus, queues: Queues): void {
  const reschedule = (event: { userId: string }) => queues.rescheduleUser(event.userId);
  eventBus.on('habit.changed', reschedule);
  eventBus.on('log.changed', reschedule);
  eventBus.on('snooze.changed', reschedule);
  eventBus.on('user.scheduleChanged', reschedule);
}

/**
 * Builds the Express app. Middleware order is fixed by SPEC.md §9:
 * requestId → pino-http → helmet → json → cookieParser → rate limit → routes →
 * 404 → error handler.
 */
export function createApp(deps: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  // Behind one proxy in production (same-origin deploy, SPEC.md §13).
  app.set('trust proxy', deps.config.NODE_ENV === 'production' ? 1 : false);

  app.use(requestId());
  app.use(httpLogger(deps.logger));
  app.use(
    helmet({
      contentSecurityPolicy: contentSecurityPolicy(deps.config),
      // The web app is same-origin, so no cross-origin embedder isolation.
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());
  app.use(globalRateLimit(deps.redis, [`${API_BASE_PATH}${HEALTH_PATH}`]));

  const api = express.Router();
  api.use(createHealthRouter({ prisma: deps.prisma, redis: deps.redis, clock: deps.clock }));
  api.use(createDocsRouter(deps.config));
  api.use(
    AUTH_PATH,
    createAuthRouter({
      prisma: deps.prisma,
      redis: deps.redis,
      clock: deps.clock,
      config: deps.config,
      queues: deps.queues,
    }),
  );
  api.use(
    ME_PATH,
    createMeRouter({
      prisma: deps.prisma,
      clock: deps.clock,
      config: deps.config,
      eventBus: deps.eventBus,
    }),
  );
  const dataDeps = {
    prisma: deps.prisma,
    clock: deps.clock,
    config: deps.config,
    eventBus: deps.eventBus,
  };
  api.use(HABITS_PATH, createHabitsRouter(dataDeps));
  // Logs and snoozes hang off `/habits/:id`, and `/logs` is a range query, so
  // both routers spell out their full paths from the `/api` root.
  api.use(createLogsRouter(dataDeps));
  api.use(createSnoozesRouter(dataDeps));
  api.use(
    TODAY_PATH,
    createTodayRouter({ prisma: deps.prisma, clock: deps.clock, config: deps.config }),
  );
  const statsCache = createRedisStatsCache(deps.redis);
  invalidateStatsOnChange(deps.eventBus, statsCache);
  api.use(
    STATS_PATH,
    createStatsRouter({
      prisma: deps.prisma,
      clock: deps.clock,
      config: deps.config,
      cache: statsCache,
    }),
  );
  api.use(
    PUSH_PATH,
    createPushRouter({
      prisma: deps.prisma,
      clock: deps.clock,
      config: deps.config,
      pushSender: deps.pushSender,
    }),
  );
  // `/export`, `/export/cloud` and `/import` spell out their own paths from
  // the `/api` root.
  api.use(
    createTransferRouter({
      prisma: deps.prisma,
      redis: deps.redis,
      clock: deps.clock,
      config: deps.config,
      eventBus: deps.eventBus,
      objectStore: deps.objectStore,
    }),
  );
  app.use(API_BASE_PATH, api);

  rescheduleRemindersOnChange(deps.eventBus, deps.queues);

  // The production image serves the built web app from this same process, on
  // the same origin (SPEC.md §13). Mounted after `/api`, so an unknown API
  // route still answers with the JSON envelope rather than the SPA shell.
  if (deps.config.WEB_ROOT !== undefined) {
    serveStaticSite(app, { root: deps.config.WEB_ROOT, apiBasePath: API_BASE_PATH });
  }

  app.use(notFoundHandler());
  app.use(errorHandler({ logger: deps.logger }));

  return app;
}
