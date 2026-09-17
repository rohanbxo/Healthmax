/**
 * Composition root (SPEC.md §3 "Dependency injection").
 *
 * `createApp` receives every collaborator it needs. Nothing under `src/`
 * imports a singleton Prisma or Redis client: production wires the real ones in
 * `server.ts`, tests pass `FixedClock`, `FakeMailer`, `FakePushSender` and
 * `FakeQueues`.
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
import type { EventBus } from './events/bus';
import type { Queues } from './jobs/queues';

import { requestId } from './http/requestId';
import { httpLogger } from './http/logger';
import { errorHandler } from './http/errors';
import { globalRateLimit } from './http/rateLimit';
import { notFoundHandler } from './http/notFound';
import { createDocsRouter } from './http/openapi';
import { createHealthRouter, HEALTH_PATH } from './modules/health/routes';
import './http/types';

export type AppDeps = {
  prisma: PrismaClient;
  redis: Redis;
  queues: Queues;
  clock: Clock;
  eventBus: EventBus;
  mailer: Mailer;
  pushSender: PushSender;
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
  // M4 mounts auth and /me; M5 mounts habits, logs, snoozes, today.
  app.use(API_BASE_PATH, api);

  app.use(notFoundHandler());
  app.use(errorHandler({ logger: deps.logger }));

  return app;
}
