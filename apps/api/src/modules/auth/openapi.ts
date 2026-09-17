/**
 * OpenAPI for the auth routes (SPEC.md §2, §9).
 *
 * Registered from the same zod schemas that validate the traffic, so `/api/docs`
 * cannot drift from what the server actually accepts. Imported for its side
 * effect by `routes.ts`, which guarantees it has run before the document is
 * generated in `createDocsRouter`.
 */
import {
  authDtoSchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
} from '@beta/core';

import { ApiErrorSchema, apiRegistry } from '../../http/openapi';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './cookies';
import { AUTH_ATTEMPT_RATE_LIMIT, FORGOT_PASSWORD_RATE_LIMIT } from './rateLimits';
import { REFRESH_TOKEN_TTL_MS } from './tokens';
import { ACCESS_TOKEN_TTL_MS } from '../../lib/accessToken';
import { REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE } from '../../http/requestedWith';

const TAGS = ['auth'];

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ApiErrorSchema } },
});

const REFRESH_COOKIE_NOTE =
  `Sets \`${REFRESH_COOKIE_NAME}\`: HttpOnly, SameSite=Strict, Path=${REFRESH_COOKIE_PATH}, ` +
  `Secure in production, ${REFRESH_TOKEN_TTL_MS / 86_400_000} days. ` +
  `The access token is a ${ACCESS_TOKEN_TTL_MS / 60_000}-minute HS256 JWT.`;

const CSRF_NOTE = `Requires the \`${REQUESTED_WITH_HEADER}: ${REQUESTED_WITH_VALUE}\` header (CSRF defence in depth); without it the request is 401.`;

const sessionResponse = (description: string) => ({
  description: `${description} ${REFRESH_COOKIE_NOTE}`,
  content: { 'application/json': { schema: authDtoSchema } },
});

apiRegistry.registerPath({
  method: 'post',
  path: '/api/auth/register',
  summary: 'Create an account',
  description: `Rate limited to ${AUTH_ATTEMPT_RATE_LIMIT.limit} per minute per IP and email. The email is stored lowercased.`,
  tags: TAGS,
  request: {
    body: { required: true, content: { 'application/json': { schema: registerBodySchema } } },
  },
  responses: {
    201: sessionResponse('Account created and signed in.'),
    400: errorResponse('Validation failed.'),
    409: errorResponse('That email address is already registered.'),
    429: errorResponse('Too many attempts.'),
  },
});

apiRegistry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  summary: 'Sign in',
  description:
    'Answers with one generic message for a wrong password and an unknown address alike, and takes the same time for both. ' +
    `Rate limited to ${AUTH_ATTEMPT_RATE_LIMIT.limit} per minute per IP and email.`,
  tags: TAGS,
  request: {
    body: { required: true, content: { 'application/json': { schema: loginBodySchema } } },
  },
  responses: {
    200: sessionResponse('Signed in.'),
    400: errorResponse('Validation failed.'),
    401: errorResponse('Invalid email or password.'),
    429: errorResponse('Too many attempts.'),
  },
});

apiRegistry.registerPath({
  method: 'post',
  path: '/api/auth/refresh',
  summary: 'Rotate the refresh token',
  description:
    `Reads \`${REFRESH_COOKIE_NAME}\`, revokes it and issues a replacement in the same family. ` +
    'Presenting an already-rotated token revokes the entire family and returns 401. ' +
    CSRF_NOTE,
  tags: TAGS,
  responses: {
    200: sessionResponse('Rotated.'),
    401: errorResponse('Missing, expired, unknown or replayed refresh token.'),
  },
});

apiRegistry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  summary: 'Sign out',
  description: `Revokes the whole token family and clears the cookie. Idempotent. ${CSRF_NOTE}`,
  tags: TAGS,
  responses: {
    204: { description: 'Signed out.' },
    401: errorResponse('Missing CSRF header.'),
  },
});

apiRegistry.registerPath({
  method: 'post',
  path: '/api/auth/forgot-password',
  summary: 'Request a password reset link',
  description:
    'Always answers 204, whether or not the address has an account; a known address enqueues a `send-email` job. ' +
    `Rate limited to ${FORGOT_PASSWORD_RATE_LIMIT.limit} per hour per IP.`,
  tags: TAGS,
  request: {
    body: { required: true, content: { 'application/json': { schema: forgotPasswordBodySchema } } },
  },
  responses: {
    204: { description: 'Accepted.' },
    400: errorResponse('Validation failed.'),
    429: errorResponse('Too many requests.'),
  },
});

apiRegistry.registerPath({
  method: 'post',
  path: '/api/auth/reset-password',
  summary: 'Set a new password with a reset token',
  description:
    'Consumes the single-use token and revokes every refresh token of that user, so all existing sessions end.',
  tags: TAGS,
  request: {
    body: { required: true, content: { 'application/json': { schema: resetPasswordBodySchema } } },
  },
  responses: {
    204: { description: 'Password changed; sign in again.' },
    400: errorResponse('Validation failed, or the link is invalid or expired.'),
  },
});
