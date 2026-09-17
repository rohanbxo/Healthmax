/**
 * OpenAPI for the snooze routes (SPEC.md §9). Imported for its side effect by
 * `routes.ts`.
 */
import { habitIdParamsSchema, putSnoozeBodySchema, snoozeDtoSchema } from '@beta/core';

import { apiRegistry } from '../../http/openapi';
import {
  HABIT_NOT_FOUND_RESPONSE,
  UNAUTHENTICATED_RESPONSE,
  errorResponse,
  security,
} from '../habits/openapi';

const TAGS = ['snoozes'];

apiRegistry.registerPath({
  method: 'put',
  path: '/api/habits/{id}/snooze',
  summary: 'Snooze a habit',
  description:
    "15, 60 or 180 minutes from the server's clock, on today's day key in the caller's timezone. Replaces any " +
    'existing snooze. A snooze is not a log and has no effect on streaks or accuracy (SPEC.md §6).',
  tags: TAGS,
  security,
  request: {
    params: habitIdParamsSchema,
    body: { required: true, content: { 'application/json': { schema: putSnoozeBodySchema } } },
  },
  responses: {
    200: {
      description: 'The stored snooze.',
      content: { 'application/json': { schema: snoozeDtoSchema } },
    },
    400: errorResponse('Validation failed — `minutes` must be 15, 60 or 180.'),
    401: UNAUTHENTICATED_RESPONSE,
    404: HABIT_NOT_FOUND_RESPONSE,
  },
});

apiRegistry.registerPath({
  method: 'delete',
  path: '/api/habits/{id}/snooze',
  summary: 'Clear a habit snooze',
  description: 'Idempotent: clearing a habit that is not snoozed is still 204.',
  tags: TAGS,
  security,
  request: { params: habitIdParamsSchema },
  responses: {
    204: { description: 'No snooze remains for the habit.' },
    401: UNAUTHENTICATED_RESPONSE,
    404: HABIT_NOT_FOUND_RESPONSE,
  },
});
