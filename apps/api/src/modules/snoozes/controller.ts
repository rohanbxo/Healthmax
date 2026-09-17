/**
 * Snooze controller (SPEC.md §3).
 */
import type { RequestHandler } from 'express';
import { habitIdParamsSchema, putSnoozeBodySchema } from '@beta/core';

import { asyncHandler } from '../../http/asyncHandler';
import { requireUserId } from '../../http/authenticate';
import { getValidated } from '../../http/validate';
import type { SnoozeService } from './service';

export const snoozeSchemas = {
  put: { params: habitIdParamsSchema, body: putSnoozeBodySchema },
  byHabit: { params: habitIdParamsSchema },
} as const;

export type SnoozeController = {
  put: RequestHandler;
  remove: RequestHandler;
};

export function createSnoozeController(deps: { service: SnoozeService }): SnoozeController {
  return {
    put: asyncHandler(async (req, res) => {
      const { params, body } = getValidated(req, snoozeSchemas.put);
      res.status(200).json(await deps.service.put(requireUserId(req), params.id, body));
    }),

    remove: asyncHandler(async (req, res) => {
      const { params } = getValidated(req, snoozeSchemas.byHabit);
      await deps.service.remove(requireUserId(req), params.id);
      res.status(204).end();
    }),
  };
}
