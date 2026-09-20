/**
 * OpenAPI 3.1 document generated from the zod schemas that actually validate
 * traffic (SPEC.md §2, §9) — so the docs cannot drift from the API.
 *
 * Routes register themselves on `apiRegistry`; M4 and M5 add auth, habits, logs
 * and the read models using the schemas from `packages/core/schemas.ts`.
 */
import { Router, type RequestHandler } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { z } from 'zod';
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';
import type { Config } from '../config';
import { STATUS_BY_CODE } from './errors';

// Must run once, before any schema uses `.openapi()`.
extendZodWithOpenApi(z);

export const DOCS_PATH = '/docs';
export const DOCS_JSON_PATH = '/docs.json';

export const apiRegistry = new OpenAPIRegistry();

export const ApiErrorSchema = registerErrorSchema();

function registerErrorSchema() {
  const schema = z
    .object({
      error: z.object({
        code: z.enum(Object.keys(STATUS_BY_CODE) as [string, ...string[]]),
        message: z.string(),
        details: z.array(z.unknown()),
      }),
    })
    .openapi('ApiError', {
      description: 'Error envelope used by every non-2xx response (SPEC.md §9).',
    });
  apiRegistry.register('ApiError', schema);
  return schema;
}

const CheckResultSchema = z
  .object({
    ok: z.boolean(),
    latencyMs: z.number(),
    error: z.string().optional(),
  })
  .openapi('HealthCheckResult');

const HealthSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    checks: z.object({ database: CheckResultSchema, redis: CheckResultSchema }),
  })
  .openapi('Health');

apiRegistry.registerPath({
  method: 'get',
  path: '/api/health',
  summary: 'Liveness and dependency check',
  description: 'Checks Postgres and Redis. Public, unauthenticated and never rate limited.',
  tags: ['health'],
  responses: {
    200: {
      description: 'Every dependency answered.',
      content: { 'application/json': { schema: HealthSchema } },
    },
    503: {
      description: 'At least one dependency failed.',
      content: { 'application/json': { schema: HealthSchema } },
    },
  },
});

export function buildOpenApiDocument(
  config: Pick<Config, 'APP_URL'>,
): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  return new OpenApiGeneratorV31(apiRegistry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Beta API',
      version: '0.1.0',
      description: 'Reminder-first habit tracker. See SPEC.md §9.',
    },
    servers: [{ url: config.APP_URL }],
  });
}

/** Docs are off in production unless explicitly enabled (SPEC.md §9). */
export function docsEnabled(config: Pick<Config, 'NODE_ENV' | 'DOCS_ENABLED'>): boolean {
  return config.NODE_ENV !== 'production' || config.DOCS_ENABLED;
}

/**
 * Swagger UI ships inline scripts and styles, so it gets its own relaxed CSP
 * rather than loosening the policy that protects the app.
 */
function docsCsp(): RequestHandler {
  return helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  });
}

/** Mounts `/docs` and `/docs.json`, or nothing at all when docs are disabled. */
export function createDocsRouter(
  config: Pick<Config, 'APP_URL' | 'NODE_ENV' | 'DOCS_ENABLED'>,
): Router {
  const router = Router();
  if (!docsEnabled(config)) return router;

  const document = buildOpenApiDocument(config);

  router.get(DOCS_JSON_PATH, (_req, res) => {
    res.json(document);
  });
  router.use(
    DOCS_PATH,
    docsCsp(),
    swaggerUi.serve,
    swaggerUi.setup(document, { customSiteTitle: 'Beta API' }),
  );
  return router;
}
