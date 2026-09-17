/**
 * `GET /api/health` — public, unauthenticated, never rate limited
 * (SPEC.md §9 "Push, export, health, docs").
 */
import { Router } from 'express';
import { healthController } from './controller';
import { createHealthService, type HealthServiceDeps } from './service';

/** Path within the `/api` router. */
export const HEALTH_PATH = '/health';

export function createHealthRouter(deps: HealthServiceDeps): Router {
  const router = Router();
  router.get(HEALTH_PATH, healthController(createHealthService(deps)));
  return router;
}
