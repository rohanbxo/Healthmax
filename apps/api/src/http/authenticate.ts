/**
 * Bearer authentication (SPEC.md §9 "Token rules", §12 "Authorization").
 *
 * Every protected route from M4 onwards hangs off this one middleware: it
 * verifies the access token and puts the caller's id on `req.userId`. A missing,
 * malformed, expired or forged token is `UNAUTHENTICATED` 401 in the standard
 * envelope — the reason is in the message, never in the status code.
 */
import type { Request, RequestHandler } from 'express';
import type { Config } from '../config';
import type { Clock } from '../lib/clock';
import { verifyAccessToken } from '../lib/accessToken';
import { unauthenticated } from './errors';

export type AuthenticateDeps = {
  config: Pick<Config, 'JWT_SECRET'>;
  clock: Clock;
};

const BEARER = /^Bearer (.+)$/;

/** Extracts the raw token from an `Authorization: Bearer <token>` header. */
export function bearerToken(req: Request): string | undefined {
  const header = req.get('authorization');
  if (!header) return undefined;
  const match = BEARER.exec(header.trim());
  const token = match?.[1]?.trim();
  return token === undefined || token === '' ? undefined : token;
}

/**
 * Guards a route. On success `req.userId` is set; services take it from the
 * controller and scope every query by it (SPEC.md §8 "Query rules").
 */
export function authenticate(deps: AuthenticateDeps): RequestHandler {
  return (req, _res, next) => {
    const token = bearerToken(req);
    if (token === undefined) {
      next(unauthenticated('Authentication required.'));
      return;
    }

    const result = verifyAccessToken({
      token,
      secret: deps.config.JWT_SECRET,
      nowMs: deps.clock.now(),
    });
    if (!result.ok) {
      next(
        unauthenticated(
          result.reason === 'expired' ? 'Access token has expired.' : 'Access token is invalid.',
        ),
      );
      return;
    }

    req.userId = result.claims.sub;
    next();
  };
}

/**
 * Reads the id `authenticate` established. Throws rather than returning
 * `undefined`, so an unguarded route fails loudly in development instead of
 * quietly serving somebody else's data.
 */
export function requireUserId(req: Request): string {
  if (!req.userId) {
    throw new Error('requireUserId() called on a route without authenticate() middleware');
  }
  return req.userId;
}
