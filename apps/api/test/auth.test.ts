/**
 * Auth endpoints (SPEC.md §9 "Auth", §12 security checklist, §13 "API tests").
 *
 * Runs against real Postgres and real Redis, so argon2, the rotation
 * transaction and the Redis-backed limiters are all genuinely exercised. The
 * clock is a `FixedClock`, so expiry is driven rather than waited for.
 */
import { decode } from 'jsonwebtoken';
import { expect } from 'chai';
import request from 'supertest';
import { authDtoSchema } from '@beta/core';

import { useTestApp } from './helpers/testApp';
import {
  AUTH,
  bearer,
  detailPaths,
  expectEnvelope,
  ME_PATH,
  postRefresh,
  refreshCookie,
  refreshSetCookie,
  refreshTokenFrom,
  registerUser,
  requestedWith,
  TEST_PASSWORD,
} from './helpers/auth';
import { ACCESS_TOKEN_TTL_MS } from '../src/lib/accessToken';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  refreshCookieOptions,
} from '../src/modules/auth/cookies';
import {
  AUTH_ATTEMPT_RATE_LIMIT,
  FORGOT_PASSWORD_RATE_LIMIT,
} from '../src/modules/auth/rateLimits';
import { INVALID_CREDENTIALS_MESSAGE, REFRESH_REUSE_MESSAGE } from '../src/modules/auth/service';

/** Pulls the single-use reset token out of the queued `send-email` job. */
function resetTokenFromEmail(text: string): string {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) throw new Error(`No reset token in the email body:\n${text}`);
  return match[1];
}

describe('auth', () => {
  const harness = useTestApp();
  const app = () => harness().app;

  /* ------------------------------------------------------------ register */

  describe('POST /api/auth/register', () => {
    it('creates the account, returns { accessToken, me } and sets the refresh cookie', async () => {
      const res = await request(app())
        .post(AUTH.register)
        .send({
          email: 'Ada@Example.COM',
          password: TEST_PASSWORD,
          name: 'Ada',
          timeZone: 'Europe/London',
        })
        .expect(201);

      const parsed = authDtoSchema.parse(res.body);
      expect(parsed.me.email).to.equal('ada@example.com');
      expect(parsed.me.name).to.equal('Ada');
      expect(parsed.me.timeZone).to.equal('Europe/London');
      expect(parsed.me.weekStart).to.equal(1);
      expect(parsed.me.onboarded).to.equal(false);
      expect(res.body.me).to.not.have.property('passwordHash');

      const cookie = refreshSetCookie(res);
      expect(cookie).to.include('HttpOnly');
      expect(cookie).to.include('SameSite=Strict');
      expect(cookie).to.include(`Path=${REFRESH_COOKIE_PATH}`);
      // NODE_ENV=test, so `Secure` would make the cookie unusable over http.
      expect(cookie).to.not.include('Secure');
    });

    it('stores the email lowercased and an argon2id digest, never the password', async () => {
      const session = await registerUser(app(), { email: 'Grace@Example.com' });
      const stored = await harness().prisma.user.findUniqueOrThrow({
        where: { id: session.me.id },
        select: { email: true, passwordHash: true },
      });

      expect(stored.email).to.equal('grace@example.com');
      expect(stored.passwordHash).to.match(/^\$argon2id\$/);
      expect(stored.passwordHash).to.not.include(TEST_PASSWORD);
    });

    it('issues a 15-minute HS256 access token carrying only { sub, iat, exp }', async () => {
      const session = await registerUser(app());
      const decoded = decode(session.accessToken, { complete: true });
      if (decoded === null || typeof decoded === 'string') throw new Error('undecodable token');

      expect(decoded.header.alg).to.equal('HS256');
      const payload = decoded.payload as Record<string, unknown>;
      expect(Object.keys(payload).sort()).to.deep.equal(['exp', 'iat', 'sub']);
      expect(payload.sub).to.equal(session.me.id);
      expect((payload.exp as number) - (payload.iat as number)).to.equal(
        ACCESS_TOKEN_TTL_MS / 1000,
      );
    });

    it('stores the refresh token hashed, never in the clear', async () => {
      const session = await registerUser(app());
      const rows = await harness().prisma.refreshToken.findMany({ select: { tokenHash: true } });

      expect(rows).to.have.length(1);
      expect(rows[0]?.tokenHash).to.be.a('string').with.length(64);
      expect(rows[0]?.tokenHash).to.not.equal(session.refreshToken);
    });

    it('rejects a duplicate email with CONFLICT 409', async () => {
      const session = await registerUser(app(), { email: 'taken@example.com' });
      expect(session.me.email).to.equal('taken@example.com');

      const res = await request(app())
        .post(AUTH.register)
        .send({
          email: 'TAKEN@example.com',
          password: TEST_PASSWORD,
          name: 'Impostor',
          timeZone: 'UTC',
        })
        .expect(409);

      expectEnvelope(res.body, 'CONFLICT');
      expect(await harness().prisma.user.count()).to.equal(1);
    });
  });

  /* -------------------------------------------------------- cookie flags */

  describe('the beta_rt cookie (SPEC §12)', () => {
    it('is Secure in production and only there', () => {
      // The harness runs with NODE_ENV=test, where `Secure` would make the
      // cookie unusable over http://localhost — so assert the flag directly.
      expect(refreshCookieOptions(true)).to.deep.equal({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: REFRESH_COOKIE_PATH,
      });
      expect(refreshCookieOptions(false).secure).to.equal(false);
    });
  });

  /* ---------------------------------------------------------- validation */

  describe('validation (SPEC §12: zod at the route boundary)', () => {
    it('rejects a password under 10 characters', async () => {
      const res = await request(app())
        .post(AUTH.register)
        .send({ email: 'a@example.com', password: 'short', name: 'A', timeZone: 'UTC' })
        .expect(400);

      const { details } = expectEnvelope(res.body, 'VALIDATION_ERROR');
      expect(details).to.have.length.greaterThan(0);
      expect(detailPaths(details)).to.include('body.password');
    });

    it('rejects an unknown IANA time zone', async () => {
      const res = await request(app())
        .post(AUTH.register)
        .send({
          email: 'a@example.com',
          password: TEST_PASSWORD,
          name: 'A',
          timeZone: 'Mars/Olympus_Mons',
        })
        .expect(400);

      const { details } = expectEnvelope(res.body, 'VALIDATION_ERROR');
      expect(detailPaths(details)).to.include('body.timeZone');
    });

    it('rejects unknown body fields by name', async () => {
      const res = await request(app())
        .post(AUTH.register)
        .send({
          email: 'a@example.com',
          password: TEST_PASSWORD,
          name: 'A',
          timeZone: 'UTC',
          weekStart: 0,
          isAdmin: true,
        })
        .expect(400);

      const { details } = expectEnvelope(res.body, 'VALIDATION_ERROR');
      expect(detailPaths(details)).to.include.members(['body.isAdmin', 'body.weekStart']);
      expect(await harness().prisma.user.count()).to.equal(0);
    });
  });

  /* --------------------------------------------------------------- login */

  describe('POST /api/auth/login', () => {
    it('signs in with the right password', async () => {
      const session = await registerUser(app(), { email: 'ada@example.com' });

      const res = await request(app())
        .post(AUTH.login)
        // Case-insensitive: the stored address is lowercased.
        .send({ email: 'ADA@example.com', password: session.password })
        .expect(200);

      const parsed = authDtoSchema.parse(res.body);
      expect(parsed.me.id).to.equal(session.me.id);
      expect(refreshTokenFrom(res)).to.not.equal(session.refreshToken);
    });

    it('answers a wrong password and an unknown address identically', async () => {
      await registerUser(app(), { email: 'ada@example.com' });

      const wrongPassword = await request(app())
        .post(AUTH.login)
        .send({ email: 'ada@example.com', password: 'definitely-not-it' })
        .expect(401);

      const unknownEmail = await request(app())
        .post(AUTH.login)
        .send({ email: 'nobody@example.com', password: 'definitely-not-it' })
        .expect(401);

      const { message } = expectEnvelope(wrongPassword.body, 'UNAUTHENTICATED');
      expect(message).to.equal(INVALID_CREDENTIALS_MESSAGE);
      expect(message).to.include('Invalid email or password');
      // Byte-identical: nothing distinguishes "no such user" from "bad password".
      expect(unknownEmail.body).to.deep.equal(wrongPassword.body);
      expect(unknownEmail.headers).to.not.have.property('set-cookie');
    });

    it(`returns RATE_LIMITED 429 after ${AUTH_ATTEMPT_RATE_LIMIT.limit} attempts per minute`, async () => {
      const session = await registerUser(app(), { email: 'ada@example.com' });
      const attempt = () =>
        request(app()).post(AUTH.login).send({ email: session.email, password: 'wrong-password' });

      for (let i = 0; i < AUTH_ATTEMPT_RATE_LIMIT.limit; i += 1) {
        await attempt().expect(401);
      }

      const blocked = await attempt().expect(429);
      expectEnvelope(blocked.body, 'RATE_LIMITED');

      // Keyed by IP *and* email, so another address is untouched.
      await request(app())
        .post(AUTH.login)
        .send({ email: 'someone-else@example.com', password: 'wrong-password' })
        .expect(401);
    });
  });

  /* ---------------------------------------------------- the full journey */

  describe('register → login → refresh → logout', () => {
    it('walks the whole flow and ends with a dead cookie', async () => {
      const registered = await registerUser(app(), { email: 'ada@example.com' });

      const loggedIn = await request(app())
        .post(AUTH.login)
        .send({ email: registered.email, password: registered.password })
        .expect(200);
      const loginToken = refreshTokenFrom(loggedIn);

      const refreshed = await postRefresh(app(), loginToken).expect(200);
      const rotated = refreshTokenFrom(refreshed);
      authDtoSchema.parse(refreshed.body);
      expect(refreshed.body.me.id).to.equal(registered.me.id);

      // The rotated access token opens a protected route.
      await request(app())
        .get(ME_PATH)
        .set(...bearer(refreshed.body.accessToken as string))
        .expect(200);

      const loggedOut = await request(app())
        .post(AUTH.logout)
        .set(...requestedWith())
        .set(...refreshCookie(rotated))
        .expect(204);

      const cleared = refreshSetCookie(loggedOut);
      expect(cleared).to.include(`${REFRESH_COOKIE_NAME}=;`);
      expect(cleared).to.include('HttpOnly');
      expect(cleared).to.include(`Path=${REFRESH_COOKIE_PATH}`);

      await postRefresh(app(), rotated).expect(401);
      // The original login token belonged to the same family and is dead too.
      await postRefresh(app(), loginToken).expect(401);
      // Registration opened a different family, which logout must not have touched.
      await postRefresh(app(), registered.refreshToken).expect(200);
    });
  });

  /* ------------------------------------------------------------- refresh */

  describe('POST /api/auth/refresh', () => {
    it('rotates: the old cookie stops working and the new one works', async () => {
      const session = await registerUser(app());

      const first = await postRefresh(app(), session.refreshToken).expect(200);
      const rotated = refreshTokenFrom(first);
      expect(rotated).to.not.equal(session.refreshToken);

      const second = await postRefresh(app(), rotated).expect(200);
      expect(refreshTokenFrom(second)).to.not.equal(rotated);

      // Rotation is recorded: revoked, and linked to its replacement.
      const rows = await harness().prisma.refreshToken.findMany({
        orderBy: { createdAt: 'asc' },
        select: { familyId: true, revokedAt: true, replacedById: true, id: true },
      });
      expect(rows).to.have.length(3);
      expect(new Set(rows.map((row) => row.familyId)).size).to.equal(1);
      expect(rows[0]?.revokedAt).to.not.equal(null);
      expect(rows[0]?.replacedById).to.equal(rows[1]?.id);
      expect(rows[2]?.revokedAt).to.equal(null);
    });

    it('revokes the entire family when a rotated token is presented again', async () => {
      const session = await registerUser(app());
      const original = session.refreshToken;

      const firstRotation = await postRefresh(app(), original).expect(200);
      const live = refreshTokenFrom(firstRotation);

      // Replaying the original is the leak signal (SPEC §9).
      const replay = await postRefresh(app(), original).expect(401);
      const { message } = expectEnvelope(replay.body, 'UNAUTHENTICATED');
      expect(message).to.equal(REFRESH_REUSE_MESSAGE);

      // ...and the token the first rotation issued is now dead as well.
      await postRefresh(app(), live).expect(401);

      const rows = await harness().prisma.refreshToken.findMany({
        select: { revokedAt: true },
      });
      expect(rows).to.have.length(2);
      expect(rows.every((row) => row.revokedAt !== null)).to.equal(true);

      // A fresh login opens a new family and still works.
      const loggedIn = await request(app())
        .post(AUTH.login)
        .send({ email: session.email, password: session.password })
        .expect(200);
      await postRefresh(app(), refreshTokenFrom(loggedIn)).expect(200);
    });

    it('rejects a request without the X-Requested-With: beta header', async () => {
      const session = await registerUser(app());

      const res = await request(app())
        .post(AUTH.refresh)
        .set(...refreshCookie(session.refreshToken))
        .expect(401);
      expectEnvelope(res.body, 'UNAUTHENTICATED');
      expect(res.body.error.message).to.include('X-Requested-With');

      // Wrong value is no better than a missing header.
      await request(app())
        .post(AUTH.refresh)
        .set('X-Requested-With', 'XMLHttpRequest')
        .set(...refreshCookie(session.refreshToken))
        .expect(401);

      // The token survived the rejection: nothing was rotated.
      await postRefresh(app(), session.refreshToken).expect(200);
    });

    it('rejects a missing or unknown cookie and clears it', async () => {
      const noCookie = await request(app())
        .post(AUTH.refresh)
        .set(...requestedWith())
        .expect(401);
      expectEnvelope(noCookie.body, 'UNAUTHENTICATED');

      const unknown = await postRefresh(app(), 'not-a-real-token').expect(401);
      expectEnvelope(unknown.body, 'UNAUTHENTICATED');
      expect(refreshSetCookie(unknown)).to.include(`${REFRESH_COOKIE_NAME}=;`);
    });

    it('rejects an expired refresh token', async () => {
      const session = await registerUser(app());
      // Age the stored row rather than the clock, so only expiry is under test.
      await harness().prisma.refreshToken.updateMany({
        data: { expiresAt: new Date(harness().clock.now() - 1_000) },
      });

      await postRefresh(app(), session.refreshToken).expect(401);
    });
  });

  /* -------------------------------------------------------------- logout */

  describe('POST /api/auth/logout', () => {
    it('requires the CSRF header', async () => {
      const session = await registerUser(app());
      const res = await request(app())
        .post(AUTH.logout)
        .set(...refreshCookie(session.refreshToken))
        .expect(401);

      expectEnvelope(res.body, 'UNAUTHENTICATED');
      await postRefresh(app(), session.refreshToken).expect(200);
    });

    it('is idempotent and never reveals whether the cookie was real', async () => {
      await request(app())
        .post(AUTH.logout)
        .set(...requestedWith())
        .expect(204);

      await request(app())
        .post(AUTH.logout)
        .set(...requestedWith())
        .set(...refreshCookie('never-existed'))
        .expect(204);
    });
  });

  /* ----------------------------------------------------- forgot password */

  describe('POST /api/auth/forgot-password', () => {
    it('answers 204 for an unknown address and enqueues nothing', async () => {
      await request(app()).post(AUTH.forgot).send({ email: 'ghost@example.com' }).expect(204);

      expect(harness().queues.emails).to.have.length(0);
      expect(await harness().prisma.passwordResetToken.count()).to.equal(0);
    });

    it('answers 204 for a known address and enqueues one send-email job', async () => {
      const session = await registerUser(app(), { email: 'ada@example.com' });

      await request(app()).post(AUTH.forgot).send({ email: 'ADA@example.com' }).expect(204);

      expect(harness().queues.emails).to.have.length(1);
      const job = harness().queues.emails[0];
      expect(job?.to).to.equal('ada@example.com');
      expect(job?.subject).to.be.a('string').and.not.equal('');
      expect(job?.text ?? '').to.include(`${harness().config.APP_URL}/reset?token=`);

      // Stored hashed, single-use, and short-lived.
      const stored = await harness().prisma.passwordResetToken.findFirstOrThrow();
      expect(stored.userId).to.equal(session.me.id);
      expect(stored.usedAt).to.equal(null);
      expect(stored.tokenHash).to.have.length(64);
      expect(stored.tokenHash).to.not.include(resetTokenFromEmail(job?.text ?? ''));
    });

    it(`returns 429 after ${FORGOT_PASSWORD_RATE_LIMIT.limit} requests per hour per IP`, async () => {
      for (let i = 0; i < FORGOT_PASSWORD_RATE_LIMIT.limit; i += 1) {
        await request(app())
          .post(AUTH.forgot)
          .send({ email: `x${i}@example.com` })
          .expect(204);
      }

      const blocked = await request(app())
        .post(AUTH.forgot)
        // A different address does not help: this limiter is keyed by IP alone.
        .send({ email: 'someone@example.com' })
        .expect(429);
      expectEnvelope(blocked.body, 'RATE_LIMITED');
    });
  });

  /* ------------------------------------------------------ reset password */

  describe('POST /api/auth/reset-password', () => {
    /** Runs forgot-password and returns the emailed single-use token. */
    async function requestReset(email: string): Promise<string> {
      await request(app()).post(AUTH.forgot).send({ email }).expect(204);
      const job = harness().queues.emails.at(-1);
      return resetTokenFromEmail(job?.text ?? '');
    }

    it('sets the new password and revokes every existing session', async () => {
      const session = await registerUser(app(), { email: 'ada@example.com' });
      // A second, independent session that must also die.
      const other = await request(app())
        .post(AUTH.login)
        .send({ email: session.email, password: session.password })
        .expect(200);
      const otherToken = refreshTokenFrom(other);

      const token = await requestReset(session.email);
      const newPassword = 'a-brand-new-passphrase';
      await request(app()).post(AUTH.reset).send({ token, password: newPassword }).expect(204);

      // Both refresh tokens minted before the reset are dead (SPEC §12).
      await postRefresh(app(), session.refreshToken).expect(401);
      await postRefresh(app(), otherToken).expect(401);

      await request(app())
        .post(AUTH.login)
        .send({ email: session.email, password: session.password })
        .expect(401);
      await request(app())
        .post(AUTH.login)
        .send({ email: session.email, password: newPassword })
        .expect(200);
    });

    it('consumes the token so it cannot be replayed', async () => {
      const session = await registerUser(app(), { email: 'ada@example.com' });
      const token = await requestReset(session.email);

      await request(app())
        .post(AUTH.reset)
        .send({ token, password: 'first-new-password' })
        .expect(204);
      expect((await harness().prisma.passwordResetToken.findFirstOrThrow()).usedAt).to.not.equal(
        null,
      );

      const replay = await request(app())
        .post(AUTH.reset)
        .send({ token, password: 'second-new-password' })
        .expect(400);
      expectEnvelope(replay.body, 'VALIDATION_ERROR');

      // The first new password is still the live one.
      await request(app())
        .post(AUTH.login)
        .send({ email: session.email, password: 'first-new-password' })
        .expect(200);
    });

    it('rejects an expired token', async () => {
      const session = await registerUser(app(), { email: 'ada@example.com' });
      const token = await requestReset(session.email);
      await harness().prisma.passwordResetToken.updateMany({
        data: { expiresAt: new Date(harness().clock.now() - 1_000) },
      });

      await request(app())
        .post(AUTH.reset)
        .send({ token, password: 'another-password' })
        .expect(400);
    });

    it('rejects an unknown token and a too-short password', async () => {
      const unknown = await request(app())
        .post(AUTH.reset)
        .send({ token: 'x'.repeat(43), password: 'a-long-enough-password' })
        .expect(400);
      expectEnvelope(unknown.body, 'VALIDATION_ERROR');

      const short = await request(app())
        .post(AUTH.reset)
        .send({ token: 'x'.repeat(43), password: 'short' })
        .expect(400);
      expect(detailPaths(expectEnvelope(short.body, 'VALIDATION_ERROR').details)).to.include(
        'body.password',
      );
    });
  });
});
