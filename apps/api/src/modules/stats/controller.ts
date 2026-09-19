/**
 * Stats controller (SPEC.md §3). Reports the cache outcome in `X-Cache`
 * (SPEC.md §9) so a client — or a test — can see which path answered.
 */
import type { RequestHandler } from 'express';
import { statsQuerySchema } from '@beta/core';

import { asyncHandler } from '../../http/asyncHandler';
import { requireUserId } from '../../http/authenticate';
import { getValidated } from '../../http/validate';
import type { StatsService } from './service';

export const CACHE_HEADER = 'X-Cache';

export const statsSchemas = {
  get: { query: statsQuerySchema },
} as const;

export type StatsController = { get: RequestHandler };

export function createStatsController(deps: { service: StatsService }): StatsController {
  return {
    get: asyncHandler(async (req, res) => {
      const { query } = getValidated(req, statsSchemas.get);
      const { stats, cache } = await deps.service.get(requireUserId(req), query.range);
      res.status(200).set(CACHE_HEADER, cache).json(stats);
    }),
  };
}
