/**
 * Account endpoints and the `authenticate` middleware
 * (SPEC.md §9 "Account", §12 "Authorization", §13 "API tests").
 */
import { expect } from 'chai';
import request from 'supertest';
import { meDtoSchema } from '@beta/core';

import { useTestApp } from './helpers/testApp';
import {
  bearer,
  detailPaths,
  expectEnvelope,
  expectHiddenFromOtherUser,
  forgeAccessToken,
  ME_PATH,
  postRefresh,
  registerUser,
} from './helpers/auth';
import { ACCESS_TOKEN_TTL_MS, signAccessToken } from '../src/lib/accessToken';

describe('account', () => {
  const harness = useTestApp();
  const app = () => harness().app;

  /* ------------------------------------------------------- authenticate */

  describe('authenticate middleware', () => {
    it('rejects a request with no Authorization header', async () => {
      const res = await request(app()).get(ME_PATH).expect(401);
      expectEnvelope(res.body, 'UNAUTHENTICATED');
    });

    it('rejects a malformed or empty Authorization header', async () => {
      for (const header of ['Bearer', 'Bearer ', 'Basic abc123', 'token abc123']) {
        const res = await request(app()).get(ME_PATH).set('Authorization', header).expect(401);
        expectEnvelope(res.body, 'UNAUTHENTICATED');
      }
    });

    it('rejects a token that is not a JWT, and one signed with another secret', async () => {
      await request(app())
        .get(ME_PATH)
        .set(...bearer('not.a.jwt'))
        .expect(401);

      const session = await registerUser(app());
      const forged = signAccessToken({
        userId: session.me.id,
        secret: 'a-different-secret-that-is-long-enough-x',
        nowMs: harness().clock.now(),
      });
      const res = await request(app())
        .get(ME_PATH)
        .set(...bearer(forged))
        .expect(401);
      expect(expectEnvelope(res.body, 'UNAUTHENTICATED').message).to.include('invalid');
    });

    it('rejects an expired access token', async () => {
      const session = await registerUser(app());
      await request(app())
        .get(ME_PATH)
        .set(...bearer(session.accessToken))
        .expect(200);

      // Drive expiry with the injected clock rather than waiting 15 minutes.
      harness().clock.advance(ACCESS_TOKEN_TTL_MS + 1_000);

      const res = await request(app())
        .get(ME_PATH)
        .set(...bearer(session.accessToken))
        .expect(401);
      expect(expectEnvelope(res.body, 'UNAUTHENTICATED').message).to.include('expired');
    });
  });

  /* ------------------------------------------------------------- GET /me */

  describe('GET /api/me', () => {
    it('returns the MeDTO for the bearer of the token', async () => {
      const session = await registerUser(app(), {
        email: 'ada@example.com',
        name: 'Ada',
        timeZone: 'Asia/Kolkata',
      });

      const res = await request(app())
        .get(ME_PATH)
        .set(...bearer(session.accessToken))
        .expect(200);

      const me = meDtoSchema.parse(res.body);
      expect(me).to.deep.equal({
        id: session.me.id,
        email: 'ada@example.com',
        name: 'Ada',
        timeZone: 'Asia/Kolkata',
        weekStart: 1,
        onboarded: false,
      });
      // Nothing beyond the DTO leaks out.
      expect(Object.keys(res.body).sort()).to.deep.equal([
        'email',
        'id',
        'name',
        'onboarded',
        'timeZone',
        'weekStart',
      ]);
    });
  });

  /* ----------------------------------------------------------- PATCH /me */

  describe('PATCH /api/me', () => {
    it('updates the name without touching the schedule', async () => {
      const session = await registerUser(app());

      const res = await request(app())
        .patch(ME_PATH)
        .set(...bearer(session.accessToken))
        .send({ name: 'Ada Lovelace', onboarded: true })
        .expect(200);

      const me = meDtoSchema.parse(res.body);
      expect(me.name).to.equal('Ada Lovelace');
      expect(me.onboarded).to.equal(true);
      expect(harness().eventBus.events).to.have.length(0);
    });

    it('emits user.scheduleChanged when the time zone changes', async () => {
      const session = await registerUser(app(), { timeZone: 'Asia/Dubai' });

      const res = await request(app())
        .patch(ME_PATH)
        .set(...bearer(session.accessToken))
        .send({ timeZone: 'Pacific/Kiritimati' })
        .expect(200);

      expect(res.body.timeZone).to.equal('Pacific/Kiritimati');
      expect(harness().eventBus.events).to.deep.equal([
        { type: 'user.scheduleChanged', userId: session.me.id },
      ]);
    });

    it('emits user.scheduleChanged when the week start changes', async () => {
      const session = await registerUser(app());

      const res = await request(app())
        .patch(ME_PATH)
        .set(...bearer(session.accessToken))
        .send({ weekStart: 0 })
        .expect(200);

      expect(res.body.weekStart).to.equal(0);
      expect(harness().eventBus.events).to.deep.equal([
        { type: 'user.scheduleChanged', userId: session.me.id },
      ]);
    });

    it('stays quiet when the schedule fields are written with their current values', async () => {
      const session = await registerUser(app(), { timeZone: 'Asia/Dubai' });

      await request(app())
        .patch(ME_PATH)
        .set(...bearer(session.accessToken))
        .send({ timeZone: 'Asia/Dubai', weekStart: 1 })
        .expect(200);

      expect(harness().eventBus.events).to.have.length(0);
    });

    it('rejects unknown fields, an empty body and a bad time zone', async () => {
      const session = await registerUser(app());
      const patch = (body: Record<string, unknown>) =>
        request(app())
          .patch(ME_PATH)
          .set(...bearer(session.accessToken))
          .send(body);

      const unknown = await patch({ name: 'Ada', weekStart: 7, isAdmin: true }).expect(400);
      expect(
        detailPaths(expectEnvelope(unknown.body, 'VALIDATION_ERROR').details),
      ).to.include.members(['body.isAdmin', 'body.weekStart']);

      const empty = await patch({}).expect(400);
      expectEnvelope(empty.body, 'VALIDATION_ERROR');

      const badZone = await patch({ timeZone: 'Nowhere/Nothing' }).expect(400);
      expect(detailPaths(expectEnvelope(badZone.body, 'VALIDATION_ERROR').details)).to.include(
        'body.timeZone',
      );

      expect(harness().eventBus.events).to.have.length(0);
    });

    it('requires authentication', async () => {
      await request(app()).patch(ME_PATH).send({ name: 'Anonymous' }).expect(401);
    });
  });

  /* ---------------------------------------------------------- DELETE /me */

  describe('DELETE /api/me', () => {
    it('refuses without the correct password', async () => {
      const session = await registerUser(app());

      const res = await request(app())
        .delete(ME_PATH)
        .set(...bearer(session.accessToken))
        .send({ password: 'not-the-password' })
        .expect(401);

      expectEnvelope(res.body, 'UNAUTHENTICATED');
      expect(await harness().prisma.user.count()).to.equal(1);
    });

    it('deletes the account and cascades its rows', async () => {
      const session = await registerUser(app());
      await request(app())
        .post('/api/auth/forgot-password')
        .send({ email: session.email })
        .expect(204);

      await request(app())
        .delete(ME_PATH)
        .set(...bearer(session.accessToken))
        .send({ password: session.password })
        .expect(204);

      expect(await harness().prisma.user.count()).to.equal(0);
      expect(await harness().prisma.refreshToken.count()).to.equal(0);
      expect(await harness().prisma.passwordResetToken.count()).to.equal(0);

      // The cookie it left behind cannot resurrect the session.
      await postRefresh(app(), session.refreshToken).expect(401);
    });

    it('rejects a body without the password confirmation', async () => {
      const session = await registerUser(app());
      const res = await request(app())
        .delete(ME_PATH)
        .set(...bearer(session.accessToken))
        .send({})
        .expect(400);

      expect(detailPaths(expectEnvelope(res.body, 'VALIDATION_ERROR').details)).to.include(
        'body.password',
      );
    });
  });

  /* --------------------------------------------------------------- IDOR */

  describe('authorization (SPEC §9: another owner is 404, never 403)', () => {
    it('serves each caller only their own account', async () => {
      const alice = await registerUser(app(), { email: 'alice@example.com', name: 'Alice' });
      const bob = await registerUser(app(), { email: 'bob@example.com', name: 'Bob' });

      const res = await request(app())
        .get(ME_PATH)
        .set(...bearer(bob.accessToken))
        .expect(200);

      expect(res.body.id).to.equal(bob.me.id);
      expect(res.body.id).to.not.equal(alice.me.id);
      expect(res.body.email).to.equal('bob@example.com');
    });

    it('hides an account that no longer exists behind 404', async () => {
      const alice = await registerUser(app(), { email: 'alice@example.com' });
      const bob = await registerUser(app(), { email: 'bob@example.com' });

      await request(app())
        .delete(ME_PATH)
        .set(...bearer(bob.accessToken))
        .send({ password: bob.password })
        .expect(204);

      // Bob's access token is still cryptographically valid but names nobody.
      await expectHiddenFromOtherUser(() =>
        request(app())
          .get(ME_PATH)
          .set(...bearer(bob.accessToken)),
      );
      await expectHiddenFromOtherUser(() =>
        request(app())
          .patch(ME_PATH)
          .set(...bearer(bob.accessToken))
          .send({ name: 'Ghost' }),
      );
      await expectHiddenFromOtherUser(() =>
        request(app())
          .delete(ME_PATH)
          .set(...bearer(bob.accessToken))
          .send({ password: bob.password }),
      );

      // A perfectly-signed token for an id that never existed reads the same.
      const stranger = forgeAccessToken(harness().config.JWT_SECRET, harness().clock.now());
      await expectHiddenFromOtherUser(() =>
        request(app())
          .get(ME_PATH)
          .set(...bearer(stranger)),
      );

      // Alice is untouched by any of it.
      await request(app())
        .get(ME_PATH)
        .set(...bearer(alice.accessToken))
        .expect(200);
    });
  });
});
