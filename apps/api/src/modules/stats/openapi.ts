/**
 * OpenAPI for the Stats read model (SPEC.md §9). Imported for its side effect
 * by `routes.ts`.
 */
import { statsDtoSchema, statsQuerySchema } from '@beta/core';

import { apiRegistry } from '../../http/openapi';
import { UNAUTHENTICATED_RESPONSE, errorResponse, security } from '../habits/openapi';

apiRegistry.registerPath({
  method: 'get',
  path: '/api/stats',
  summary: 'Accuracy and streaks',
  description:
    'Overall accuracy over the last 7, 30 or 90 days (default 30), and per habit the current streak, best streak, ' +
    '30-day accuracy and the last 30 days of statuses. Archived habits are not counted. Cached in Redis for an ' +
    'hour per user, day and range, and dropped whenever a habit or log changes.',
  tags: ['stats'],
  security,
  request: { query: statsQuerySchema },
  responses: {
    200: {
      description: "The caller's stats.",
      headers: {
        'X-Cache': {
          description: '`HIT` when served from the cache, `MISS` when computed.',
          schema: { type: 'string', enum: ['HIT', 'MISS'] },
        },
      },
      content: { 'application/json': { schema: statsDtoSchema } },
    },
    400: errorResponse('`range` is not 7, 30 or 90.'),
    401: UNAUTHENTICATED_RESPONSE,
    404: errorResponse('The account behind the token no longer exists.'),
  },
});
