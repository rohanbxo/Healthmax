/**
 * Habit controller (SPEC.md §3). Reads what `validate()` parsed, takes the
 * caller's id from `authenticate` — never from the body — and shapes the
 * response. No Prisma, no rules.
 */
import type { RequestHandler } from 'express';
import { createHabitBodySchema, habitIdParamsSchema, updateHabitBodySchema } from '@beta/core';

import { asyncHandler } from '../../http/asyncHandler';
import { requireUserId } from '../../http/authenticate';
import { getValidated } from '../../http/validate';
import type { HabitService } from './service';

export const habitSchemas = {
  create: { body: createHabitBodySchema },
  update: { params: habitIdParamsSchema, body: updateHabitBodySchema },
  byId: { params: habitIdParamsSchema },
} as const;

export type HabitController = {
  list: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
};

export function createHabitController(deps: { service: HabitService }): HabitController {
  return {
    list: asyncHandler(async (req, res) => {
      res.status(200).json(await deps.service.list(requireUserId(req)));
    }),

    create: asyncHandler(async (req, res) => {
      const { body } = getValidated(req, habitSchemas.create);
      res.status(201).json(await deps.service.create(requireUserId(req), body));
    }),

    update: asyncHandler(async (req, res) => {
      const { params, body } = getValidated(req, habitSchemas.update);
      res.status(200).json(await deps.service.update(requireUserId(req), params.id, body));
    }),

    remove: asyncHandler(async (req, res) => {
      const { params } = getValidated(req, habitSchemas.byId);
      await deps.service.remove(requireUserId(req), params.id);
      res.status(204).end();
    }),
  };
}
