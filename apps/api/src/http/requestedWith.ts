/**
 * CSRF defence in depth (SPEC.md §9: "`/auth/refresh` and `/auth/logout` also
 * require header `X-Requested-With: beta`").
 *
 * The refresh cookie is already `SameSite=Strict`, so a cross-site form post
 * cannot carry it. This header is the second lock: a custom header cannot be
 * set by a plain HTML form, so it can only come from same-origin JavaScript
 * that has passed CORS — and the deployment is same-origin (SPEC.md §13).
 *
 * A request without it is treated as unauthenticated (401), not as a malformed
 * body (400): the caller failed to prove it is our own client, which is an
 * authentication failure, and the web client's 401 handling already covers it.
 */
import type { RequestHandler } from 'express';
import { unauthenticated } from './errors';

export const REQUESTED_WITH_HEADER = 'x-requested-with';
export const REQUESTED_WITH_VALUE = 'beta';

export function requireRequestedWith(): RequestHandler {
  return (req, _res, next) => {
    if (req.get(REQUESTED_WITH_HEADER) !== REQUESTED_WITH_VALUE) {
      next(
        unauthenticated(
          `This endpoint requires the "X-Requested-With: ${REQUESTED_WITH_VALUE}" header.`,
        ),
      );
      return;
    }
    next();
  };
}
