/**
 * OpenAPI for the Today read model (SPEC.md §9). Imported for its side effect
 * by `routes.ts`.
 */
import { todayDtoSchema } from '@beta/core';

import { apiRegistry } from '../../http/openapi';
import { UNAUTHENTICATED_RESPONSE, errorResponse, security } from '../habits/openapi';

apiRegistry.registerPath({
  method: 'get',
  path: '/api/today',
  summary: 'Everything the Today screen needs',
  description:
    'A read model, not a rendering: the client derives overdue, upcoming, snoozed and weekly progress from these ' +
    'facts with `packages/core`, so the sections stay live between fetches (SPEC.md §9, §11). `logs` covers the ' +
    "whole of the caller's current week so `timesPerWeek` progress can be counted client-side.",
  tags: ['today'],
  security,
  responses: {
    200: {
      description: "The caller's Today payload.",
      content: { 'application/json': { schema: todayDtoSchema } },
    },
    401: UNAUTHENTICATED_RESPONSE,
    404: errorResponse('The account behind the token no longer exists.'),
  },
});
