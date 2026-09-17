/**
 * Refresh- and reset-token primitives (SPEC.md §9 "Token rules", §12).
 *
 * Both tokens are 256 bits of `crypto.randomBytes`. Only the SHA-256 digest is
 * ever written to the database; the raw value exists in the cookie (refresh) or
 * in the emailed link (reset) and nowhere else, so a database leak yields
 * nothing usable. SHA-256 is right here — unlike a password these are
 * high-entropy secrets, so there is nothing to brute-force and no need for a
 * slow KDF on the hot path.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** SPEC.md §9: "Refresh token: 256-bit random, 30 days". */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Short-lived by design (SPEC.md §9 forgot-password). */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

const TOKEN_BYTES = 32; // 256 bits

/** A fresh opaque token. base64url so it survives cookies, URLs and email. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** The at-rest form of a token. Hex so it fits the `tokenHash` unique index. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** A new login starts a new rotation family (SPEC.md §8 `RefreshToken`). */
export function newFamilyId(): string {
  return randomUUID();
}
