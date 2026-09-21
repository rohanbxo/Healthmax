/**
 * OpenAPI for the account routes (SPEC.md §9 "Account"). Imported for its side
 * effect by `routes.ts`.
 */
import { deleteMeBodySchema, meDtoSchema, patchMeBodySchema } from '@beta/core';
import { ApiErrorSchema, apiRegistry } from '../../http/openapi';

const TAGS = ['account'];

/** Every route here is behind `Authorization: Bearer <access token>`. */
export const BEARER_SECURITY_SCHEME = apiRegistry.registerComponent(
  'securitySchemes',
  'bearerAuth',
  { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
);

const security = [{ [BEARER_SECURITY_SCHEME.name]: [] }];

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});

const meResponse = {
  description: 'The signed-in account.',
  content: { 'application/json': { schema: meDtoSchema } },
};

const UNAUTHENTICATED = errorResponse('Missing, expired or invalid access token.');
const GONE = errorResponse('No such account (SPEC.md §9: never 403).');

apiRegistry.registerPath({
  method: 'get',
  path: '/api/me',
  summary: 'Read the signed-in account',
  tags: TAGS,
  security,
  responses: { 200: meResponse, 401: UNAUTHENTICATED, 404: GONE },
});

apiRegistry.registerPath({
  method: 'patch',
  path: '/api/me',
  summary: 'Update the signed-in account',
  description:
    'A change to `timeZone` or `weekStart` emits `user.scheduleChanged`, which reschedules the reminder plan (SPEC.md §10).',
  tags: TAGS,
  security,
  request: {
    body: { required: true, content: { 'application/json': { schema: patchMeBodySchema } } },
  },
  responses: {
    200: meResponse,
    400: errorResponse('Validation failed.'),
    401: UNAUTHENTICATED,
    404: GONE,
  },
});

apiRegistry.registerPath({
  method: 'delete',
  path: '/api/me',
  summary: 'Delete the account',
  description: 'Requires the current password. Habits, logs, snoozes and tokens cascade.',
  tags: TAGS,
  security,
  request: {
    body: { required: true, content: { 'application/json': { schema: deleteMeBodySchema } } },
  },
  responses: {
    204: { description: 'Account deleted.' },
    400: errorResponse('Validation failed.'),
    401: UNAUTHENTICATED,
    404: GONE,
    422: errorResponse('The password is incorrect (the token is still valid).'),
  },
});
