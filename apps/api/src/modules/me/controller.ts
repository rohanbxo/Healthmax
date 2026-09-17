/**
 * Account controller (SPEC.md §3). Takes the caller's id from `authenticate`,
 * never from the body or a query parameter — that is what makes an IDOR
 * impossible on these three routes.
 */
import type { RequestHandler } from 'express';
import { deleteMeBodySchema, patchMeBodySchema } from '@beta/core';

import { asyncHandler } from '../../http/asyncHandler';
import { requireUserId } from '../../http/authenticate';
import { getValidated } from '../../http/validate';
import type { MeService } from './service';

export const meSchemas = {
  patch: { body: patchMeBodySchema },
  delete: { body: deleteMeBodySchema },
} as const;

export type MeController = {
  get: RequestHandler;
  patch: RequestHandler;
  remove: RequestHandler;
};

export function createMeController(deps: { service: MeService }): MeController {
  return {
    get: asyncHandler(async (req, res) => {
      res.status(200).json(await deps.service.get(requireUserId(req)));
    }),

    patch: asyncHandler(async (req, res) => {
      const { body } = getValidated(req, meSchemas.patch);
      res.status(200).json(await deps.service.patch(requireUserId(req), body));
    }),

    remove: asyncHandler(async (req, res) => {
      const { body } = getValidated(req, meSchemas.delete);
      await deps.service.remove(requireUserId(req), body);
      res.status(204).end();
    }),
  };
}
