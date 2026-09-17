/**
 * Auth business rules (SPEC.md §9 "Auth", §12 security checklist).
 *
 * The service owns every decision: what counts as a valid credential, when a
 * refresh token may be rotated, what a replayed token means, and what the caller
 * is allowed to learn from a failure. The controller only moves bytes, and the
 * repository only moves rows.
 */
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import type {
  ForgotPasswordBody,
  LoginBody,
  MeDTO,
  RegisterBody,
  ResetPasswordBody,
} from '@beta/core';

import type { Config } from '../../config';
import type { Clock } from '../../lib/clock';
import type { Queues } from '../../jobs/queues';
import { signAccessToken } from '../../lib/accessToken';
import { fromDbInstant } from '../../lib/instant';
import { badRequest, conflict, unauthenticated } from '../../http/errors';
import { toMeDto, type MeRow } from '../me/dto';
import type { AuthRepository } from './repository';
import {
  generateToken,
  hashToken,
  newFamilyId,
  REFRESH_TOKEN_TTL_MS,
  RESET_TOKEN_TTL_MS,
} from './tokens';

/**
 * SPEC.md §9: login never reveals whether an address exists, so a wrong
 * password and an unknown user must produce byte-identical responses.
 */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';

/** A replayed refresh token means the cookie leaked (SPEC.md §9). */
export const REFRESH_REUSE_MESSAGE = 'Session expired. Please sign in again.';

export const RESET_TOKEN_MESSAGE = 'This password reset link is invalid or has expired.';

/**
 * Hashed once and compared against when the email is unknown, so a missing user
 * costs the same wall time as a wrong password. Without it, response latency is
 * an oracle for "does this address have an account?".
 */
const TIMING_DECOY_PASSWORD = 'beta-timing-decoy-not-a-real-password';
let timingDecoyHash: Promise<string> | undefined;
function decoyHash(): Promise<string> {
  timingDecoyHash ??= argon2Hash(TIMING_DECOY_PASSWORD);
  return timingDecoyHash;
}

/**
 * Argon2id (SPEC.md §12). `@node-rs/argon2` defaults to Argon2id with the
 * OWASP-recommended 19 MiB / 2-pass parameters; `auth.test.ts` asserts the
 * stored digest really carries the `$argon2id$` prefix rather than trusting it.
 */
function hashPassword(password: string): Promise<string> {
  return argon2Hash(password);
}

/** A malformed digest must read as "wrong password", not as a 500. */
async function passwordMatches(digest: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(digest, password);
  } catch {
    return false;
  }
}

/** What a successful auth call hands back. The raw token is cookie-bound only. */
export type AuthSession = {
  accessToken: string;
  me: MeDTO;
  /** 256-bit secret; the controller writes it to `beta_rt` and nowhere else. */
  refreshToken: string;
};

export type AuthServiceDeps = {
  repository: AuthRepository;
  clock: Clock;
  config: Pick<Config, 'JWT_SECRET' | 'APP_URL'>;
  queues: Queues;
};

export interface AuthService {
  register(body: RegisterBody): Promise<AuthSession>;
  login(body: LoginBody): Promise<AuthSession>;
  refresh(rawToken: string | undefined): Promise<AuthSession>;
  logout(rawToken: string | undefined): Promise<void>;
  forgotPassword(body: ForgotPasswordBody): Promise<void>;
  resetPassword(body: ResetPasswordBody): Promise<void>;
}

function resetEmail(appUrl: string, to: string, rawToken: string) {
  const link = `${appUrl.replace(/\/+$/, '')}/reset?token=${encodeURIComponent(rawToken)}`;
  const minutes = RESET_TOKEN_TTL_MS / 60_000;
  return {
    to,
    subject: 'Reset your Beta password',
    html:
      `<p>Someone asked to reset the Beta password for this address.</p>` +
      `<p><a href="${link}">Choose a new password</a></p>` +
      `<p>The link works once and expires in ${minutes} minutes. ` +
      `If this was not you, you can ignore this email.</p>`,
    text:
      `Someone asked to reset the Beta password for this address.\n\n${link}\n\n` +
      `The link works once and expires in ${minutes} minutes. ` +
      `If this was not you, you can ignore this email.`,
  };
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  /** Opens a brand new rotation family: one login, one family (SPEC.md §8). */
  async function startSession(user: MeRow): Promise<AuthSession> {
    const nowMs = deps.clock.now();
    const refreshToken = generateToken();
    await deps.repository.insertRefreshToken({
      userId: user.id,
      familyId: newFamilyId(),
      tokenHash: hashToken(refreshToken),
      expiresAtMs: nowMs + REFRESH_TOKEN_TTL_MS,
    });
    return {
      accessToken: signAccessToken({ userId: user.id, secret: deps.config.JWT_SECRET, nowMs }),
      me: toMeDto(user),
      refreshToken,
    };
  }

  return {
    async register(body) {
      // `emailSchema` already lowercases; repeated here so the invariant holds
      // even if this service is ever called from somewhere else.
      const email = body.email.toLowerCase();
      const user = await deps.repository.createUser({
        email,
        passwordHash: await hashPassword(body.password),
        name: body.name,
        timeZone: body.timeZone,
      });
      // SPEC.md §9: a taken email is a 409, and registration is the one place
      // where saying so is unavoidable — the form has to tell the user.
      if (!user) throw conflict('That email address is already registered.');
      return startSession(user);
    },

    async login(body) {
      const email = body.email.toLowerCase();
      const user = await deps.repository.findUserByEmail(email);

      if (!user) {
        // Burn the same argon2 work an existing user would have cost.
        await passwordMatches(await decoyHash(), body.password);
        throw unauthenticated(INVALID_CREDENTIALS_MESSAGE);
      }
      if (!(await passwordMatches(user.passwordHash, body.password))) {
        throw unauthenticated(INVALID_CREDENTIALS_MESSAGE);
      }
      return startSession(user);
    },

    async refresh(rawToken) {
      if (rawToken === undefined) throw unauthenticated('Refresh token is missing.');

      const nowMs = deps.clock.now();
      const current = await deps.repository.findRefreshTokenByHash(hashToken(rawToken));
      if (!current) throw unauthenticated('Refresh token is invalid.');

      // Reuse detection (SPEC.md §9): a token that was already rotated away can
      // only have been replayed, which means the cookie leaked. The whole
      // family dies — including the token the thief or the victim now holds.
      if (current.revokedAt !== null) {
        await deps.repository.revokeFamily(current.familyId, nowMs);
        throw unauthenticated(REFRESH_REUSE_MESSAGE);
      }
      if (fromDbInstant(current.expiresAt) <= nowMs) {
        throw unauthenticated('Refresh token has expired.');
      }

      const refreshToken = generateToken();
      const rotated = await deps.repository.rotateRefreshToken({
        currentId: current.id,
        userId: current.userId,
        familyId: current.familyId,
        tokenHash: hashToken(refreshToken),
        expiresAtMs: nowMs + REFRESH_TOKEN_TTL_MS,
        nowMs,
      });
      // Lost the race against a concurrent rotation of the same token: that is
      // the same replay signal, just detected one step later.
      if (!rotated) {
        await deps.repository.revokeFamily(current.familyId, nowMs);
        throw unauthenticated(REFRESH_REUSE_MESSAGE);
      }

      return {
        accessToken: signAccessToken({
          userId: current.userId,
          secret: deps.config.JWT_SECRET,
          nowMs,
        }),
        me: toMeDto(current.user),
        refreshToken,
      };
    },

    async logout(rawToken) {
      // Idempotent by design: signing out is never an error, and an unknown
      // cookie must not tell the caller whether it was ever valid.
      if (rawToken === undefined) return;
      const current = await deps.repository.findRefreshTokenByHash(hashToken(rawToken));
      if (!current) return;
      await deps.repository.revokeFamily(current.familyId, deps.clock.now());
    },

    async forgotPassword(body) {
      const email = body.email.toLowerCase();
      const user = await deps.repository.findUserByEmail(email);
      // SPEC.md §9: always 204. An unknown address enqueues nothing at all, so
      // neither the status code nor the mail queue leaks who has an account.
      if (!user) return;

      const rawToken = generateToken();
      await deps.repository.createPasswordReset({
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAtMs: deps.clock.now() + RESET_TOKEN_TTL_MS,
      });
      // Sending goes through the `send-email` job (SPEC.md §9, §10).
      await deps.queues.sendEmail(resetEmail(deps.config.APP_URL, user.email, rawToken));
    },

    async resetPassword(body) {
      const nowMs = deps.clock.now();
      const reset = await deps.repository.findPasswordResetByHash(hashToken(body.token));
      if (!reset || reset.usedAt !== null || fromDbInstant(reset.expiresAt) <= nowMs) {
        throw badRequest(RESET_TOKEN_MESSAGE);
      }

      // One conditional update marks it used, sets the password and revokes
      // every refresh token of that user (SPEC.md §12). A second concurrent
      // request finds the token already consumed and is rejected.
      const consumed = await deps.repository.consumePasswordReset({
        tokenId: reset.id,
        userId: reset.userId,
        passwordHash: await hashPassword(body.password),
        nowMs,
      });
      if (!consumed) throw badRequest(RESET_TOKEN_MESSAGE);
    },
  };
}
