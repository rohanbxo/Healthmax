/**
 * Today controller (SPEC.md §3). One read, no input beyond the caller's id.
 */
import type { RequestHandler } from 'express';

import { asyncHandler } from '../../http/asyncHandler';
import { requireUserId } from '../../http/authenticate';
import type { TodayService } from './service';

export type TodayController = { get: RequestHandler };

export function createTodayController(deps: { service: TodayService }): TodayController {
  return {
    get: asyncHandler(async (req, res) => {
      res.status(200).json(await deps.service.get(requireUserId(req)));
    }),
  };
}
