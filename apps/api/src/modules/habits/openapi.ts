/**
 * OpenAPI for the habit routes (SPEC.md §9). Registered from the same zod
 * schemas that validate the traffic, so `/api/docs` cannot drift. Imported for
 * its side effect by `routes.ts`.
 */
import { z } from 'zod';
import {
  createHabitBodySchema,
  habitDtoSchema,
  habitIdParamsSchema,
  updateHabitBodySchema,
} from '@beta/core';

import { ApiErrorSchema, apiRegistry } from '../../http/openapi';
import { BEARER_SECURITY_SCHEME } from '../me/openapi';

const TAGS = ['habits'];

export const security = [{ [BEARER_SECURITY_SCHEME.name]: [] }];

export const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});

export const UNAUTHENTICATED_RESPONSE = errorResponse('Missing, expired or invalid access token.');
export const HABIT_NOT_FOUND_RESPONSE = errorResponse(
  "No such habit, or it belongs to somebody else (SPEC.md §9: never 403).",
);

const habitResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: habitDtoSchema } },
});

apiRegistry.registerPath({
  method: 'get',
  path: '/api/habits',
  summary: 'List the live habits',
  description:
    'Archived habits are included and flagged; soft-deleted habits never appear. Ordered by `order`, then by age.',
  tags: TAGS,
  security,
  responses: {
    200: {
      description: 'The caller\'s habits.',
      content: { 'application/json': { schema: z.array(habitDtoSchema) } },
    },
    401: UNAUTHENTICATED_RESPONSE,
  },
});

apiRegistry.registerPath({
  method: 'post',
  path: '/api/habits',
  summary: 'Create a habit',
  description:
    '`createdDayKey` is set by the server to today in the caller\'s timezone; it is not accepted from the client (SPEC.md §9).',
  tags: TAGS,
  security,
  request: {
    body: { required: true, content: { 'application/json': { schema: createHabitBodySchema } } },
  },
  responses: {
    201: habitResponse('The created habit.'),
    400: errorResponse('Validation failed.'),
    401: UNAUTHENTICATED_RESPONSE,
  },
});

apiRegistry.registerPath({
  method: 'patch',
  path: '/api/habits/{id}',
  summary: 'Update a habit',
  description: 'Partial update, including `archived` and `order`.',
  tags: TAGS,
  security,
  request: {
    params: habitIdParamsSchema,
    body: { required: true, content: { 'application/json': { schema: updateHabitBodySchema } } },
  },
  responses: {
    200: habitResponse('The updated habit.'),
    400: errorResponse('Validation failed.'),
    401: UNAUTHENTICATED_RESPONSE,
    404: HABIT_NOT_FOUND_RESPONSE,
  },
});

apiRegistry.registerPath({
  method: 'delete',
  path: '/api/habits/{id}',
  summary: 'Delete a habit',
  description:
    'Soft delete: the row keeps its logs and reminder history, but disappears from every read (SPEC.md §8).',
  tags: TAGS,
  security,
  request: { params: habitIdParamsSchema },
  responses: {
    204: { description: 'Habit deleted.' },
    401: UNAUTHENTICATED_RESPONSE,
    404: HABIT_NOT_FOUND_RESPONSE,
  },
});
