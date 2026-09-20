/**
 * Push controller (SPEC.md §3, §9 "Push").
 */
import type { RequestHandler } from 'express';
import { pushSubscriptionBodySchema, pushUnsubscribeBodySchema } from '@beta/core';

import { asyncHandler } from '../../http/asyncHandler';
import { requireUserId } from '../../http/authenticate';
import { getValidated } from '../../http/validate';
import type { PushService } from './service';

export const pushSchemas = {
  subscribe: { body: pushSubscriptionBodySchema },
  unsubscribe: { body: pushUnsubscribeBodySchema },
} as const;

export type PushController = {
  vapidPublicKey: RequestHandler;
  subscribe: RequestHandler;
  unsubscribe: RequestHandler;
  test: RequestHandler;
};

export function createPushController(deps: { service: PushService }): PushController {
  return {
    vapidPublicKey: asyncHandler(async (_req, res) => {
      res.status(200).json(deps.service.vapidPublicKey());
    }),

    subscribe: asyncHandler(async (req, res) => {
      const { body } = getValidated(req, pushSchemas.subscribe);
      await deps.service.subscribe(requireUserId(req), body);
      res.status(204).end();
    }),

    unsubscribe: asyncHandler(async (req, res) => {
      const { body } = getValidated(req, pushSchemas.unsubscribe);
      await deps.service.unsubscribe(requireUserId(req), body.endpoint);
      res.status(204).end();
    }),

    test: asyncHandler(async (req, res) => {
      res.status(200).json(await deps.service.sendTest(requireUserId(req)));
    }),
  };
}
