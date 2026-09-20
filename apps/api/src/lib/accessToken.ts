/**
 * Access tokens (SPEC.md §9 "Token rules").
 *
 * JWT HS256, 15 minutes, payload `{ sub, iat, exp }` and nothing else — no
 * email, no name, no role. `iat`/`exp` are computed from an injected instant
 * rather than the wall clock, and verification is given the same instant, so a
 * `FixedClock` can drive expiry in tests (SPEC.md §3, §13).
 */
import jwt, { type JwtPayload } from 'jsonwebtoken';

/** SPEC.md §9: "Access token: JWT HS256, 15 minutes". */
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

export const ACCESS_TOKEN_ALGORITHM = 'HS256' as const;

/** The complete claim set. Anything else in a token makes it invalid. */
export type AccessTokenClaims = { sub: string; iat: number; exp: number };

export type AccessTokenVerification =
  { ok: true; claims: AccessTokenClaims } | { ok: false; reason: 'expired' | 'invalid' };

/** Epoch milliseconds → the integer seconds JWT uses for `iat`/`exp`. */
function toSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

export function signAccessToken(input: { userId: string; secret: string; nowMs: number }): string {
  const iat = toSeconds(input.nowMs);
  const exp = iat + ACCESS_TOKEN_TTL_MS / 1000;
  // `iat` and `exp` are supplied explicitly; jsonwebtoken keeps them as given.
  return jwt.sign({ sub: input.userId, iat, exp }, input.secret, {
    algorithm: ACCESS_TOKEN_ALGORITHM,
  });
}

/**
 * Verifies signature, algorithm and expiry against `nowMs`. Never throws: the
 * caller decides what a failure means for the response.
 */
export function verifyAccessToken(input: {
  token: string;
  secret: string;
  nowMs: number;
}): AccessTokenVerification {
  let payload: string | JwtPayload;
  try {
    payload = jwt.verify(input.token, input.secret, {
      // Pinning the algorithm is what stops an `alg: none` or HS/RS confusion.
      algorithms: [ACCESS_TOKEN_ALGORITHM],
      clockTimestamp: toSeconds(input.nowMs),
      clockTolerance: 0,
    });
  } catch (err) {
    return { ok: false, reason: err instanceof jwt.TokenExpiredError ? 'expired' : 'invalid' };
  }

  if (typeof payload === 'string') return { ok: false, reason: 'invalid' };
  const { sub, iat, exp } = payload;
  if (typeof sub !== 'string' || sub === '') return { ok: false, reason: 'invalid' };
  if (typeof iat !== 'number' || typeof exp !== 'number') return { ok: false, reason: 'invalid' };
  return { ok: true, claims: { sub, iat, exp } };
}
