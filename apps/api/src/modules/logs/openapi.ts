/**
 * OpenAPI for the log routes (SPEC.md §9). Imported for its side effect by
 * `routes.ts`.
 */
import { z } from 'zod';
import {
  MAX_LOG_RANGE_DAYS,
  habitDayParamsSchema,
  logDtoSchema,
  logsQuerySchema,
  putLogBodySchema,
} from '@beta/core';

import { apiRegistry } from '../../http/openapi';
import {
  HABIT_NOT_FOUND_RESPONSE,
  UNAUTHENTICATED_RESPONSE,
  errorResponse,
  security,
} from '../habits/openapi';

const TAGS = ['logs'];

const BACKFILL_NOTE =
  'A day is loggable when it is scheduled for the habit and falls between `createdDayKey` and today in the ' +
  "caller's timezone (SPEC.md §6). A well-formed day that breaks those rules is 422; a malformed one is 400.";

apiRegistry.registerPath({
  method: 'put',
  path: '/api/habits/{id}/logs/{dayKey}',
  summary: 'Complete or skip a habit on a day',
  description: `Idempotent upsert. Clears any snooze for that day. ${BACKFILL_NOTE}`,
  tags: TAGS,
  security,
  request: {
    params: habitDayParamsSchema,
    body: { required: true, content: { 'application/json': { schema: putLogBodySchema } } },
  },
  responses: {
    200: { description: 'The stored log.', content: { 'application/json': { schema: logDtoSchema } } },
    400: errorResponse('Validation failed — for example a malformed `dayKey`.'),
    401: UNAUTHENTICATED_RESPONSE,
    404: HABIT_NOT_FOUND_RESPONSE,
    422: errorResponse('A future day, a day before the habit existed, or a day it is not scheduled on.'),
  },
});

apiRegistry.registerPath({
  method: 'delete',
  path: '/api/habits/{id}/logs/{dayKey}',
  summary: 'Clear a habit log',
  description: 'Idempotent: deleting a log that is not there is still 204.',
  tags: TAGS,
  security,
  request: { params: habitDayParamsSchema },
  responses: {
    204: { description: 'No log remains for that day.' },
    400: errorResponse('Validation failed.'),
    401: UNAUTHENTICATED_RESPONSE,
    404: HABIT_NOT_FOUND_RESPONSE,
  },
});

apiRegistry.registerPath({
  method: 'get',
  path: '/api/logs',
  summary: 'Read logs over a day range',
  description: `Inclusive range, at most ${MAX_LOG_RANGE_DAYS} days (SPEC.md §8). Logs of deleted habits are excluded.`,
  tags: TAGS,
  security,
  request: { query: logsQuerySchema },
  responses: {
    200: {
      description: 'The logs in range, oldest first.',
      content: { 'application/json': { schema: z.array(logDtoSchema) } },
    },
    400: errorResponse('Validation failed — for example a malformed `from` or `to`.'),
    401: UNAUTHENTICATED_RESPONSE,
    404: HABIT_NOT_FOUND_RESPONSE,
    422: errorResponse(`An inverted range, or one longer than ${MAX_LOG_RANGE_DAYS} days.`),
  },
});
