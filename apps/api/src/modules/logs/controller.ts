/**
 * Log controller (SPEC.md §3). `validate()` has already proved the `dayKey` is a
 * real calendar day; whether it may be logged is the service's call.
 */
import type { RequestHandler } from 'express';
import { habitDayParamsSchema, logsQuerySchema, putLogBodySchema } from '@beta/core';

import { asyncHandler } from '../../http/asyncHandler';
import { requireUserId } from '../../http/authenticate';
import { getValidated } from '../../http/validate';
import type { LogService } from './service';

export const logSchemas = {
  put: { params: habitDayParamsSchema, body: putLogBodySchema },
  byDay: { params: habitDayParamsSchema },
  list: { query: logsQuerySchema },
} as const;

export type LogController = {
  put: RequestHandler;
  remove: RequestHandler;
  list: RequestHandler;
};

export function createLogController(deps: { service: LogService }): LogController {
  return {
    put: asyncHandler(async (req, res) => {
      const { params, body } = getValidated(req, logSchemas.put);
      const log = await deps.service.put(requireUserId(req), params.id, params.dayKey, body);
      res.status(200).json(log);
    }),

    remove: asyncHandler(async (req, res) => {
      const { params } = getValidated(req, logSchemas.byDay);
      await deps.service.remove(requireUserId(req), params.id, params.dayKey);
      res.status(204).end();
    }),

    list: asyncHandler(async (req, res) => {
      const { query } = getValidated(req, logSchemas.list);
      res.status(200).json(await deps.service.list(requireUserId(req), query));
    }),
  };
}
