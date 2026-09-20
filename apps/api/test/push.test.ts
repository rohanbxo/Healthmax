/**
 * Push subscription endpoints (SPEC.md §9 "Push", §12 authorization).
 */
import { expect } from 'chai';
import request from 'supertest';

import { createPushDelivery } from '../src/modules/push/delivery';
import { createPushSubscriptionRepository } from '../src/modules/push/repository';
import { createPushService } from '../src/modules/push/service';
import { TEST_NOW_MS, useTestApp } from './helpers/testApp';
import { bearer, expectEnvelope, registerUser, type Session } from './helpers/auth';
import { createPushSubscription } from './helpers/factories';

const VAPID_URL = '/api/push/vapid-public-key';
const SUBSCRIPTIONS_URL = '/api/push/subscriptions';
const TEST_URL = '/api/push/test';

const ENDPOINT = 'https://push.example.com/device-1';

const subscriptionBody = (endpoint = ENDPOINT) => ({
  endpoint,
  keys: { p256dh: 'BPk-client-public-key', auth: 'client-auth-secret' },
  userAgent: 'Chrome on Windows',
});

describe('push', () => {
  const harness = useTestApp();
  const app = () => harness().app;

  const subscribe = async (session: Session, endpoint = ENDPOINT): Promise<void> => {
    await request(app())
      .post(SUBSCRIPTIONS_URL)
      .set(...bearer(session.accessToken))
      .send(subscriptionBody(endpoint))
      .expect(204);
  };

  describe('GET /vapid-public-key', () => {
    it('serves the application server key without a token', async () => {
      const res = await request(app()).get(VAPID_URL).expect(200);
      // Whatever the harness was configured with: a real key from `.env` when
      // the developer has generated one, otherwise the test fallback.
      expect(res.body).to.deep.equal({ publicKey: harness().config.VAPID_PUBLIC_KEY });
      expect(res.body.publicKey).to.be.a('string').and.not.equal('');
    });

    it('404s while push is not configured on the server', () => {
      const service = createPushService({
        subscriptions: createPushSubscriptionRepository(harness().prisma),
        delivery: createPushDelivery({
          subscriptions: createPushSubscriptionRepository(harness().prisma),
          pushSender: harness().pushSender,
          clock: harness().clock,
        }),
        config: { ...harness().config, VAPID_PUBLIC_KEY: undefined },
      });

      expect(() => service.vapidPublicKey()).to.throw(/not configured/);
    });
  });

  describe('POST /subscriptions', () => {
    it('registers the browser and stores its keys', async () => {
      const session = await registerUser(app());

      await subscribe(session);

      const rows = await harness().prisma.pushSubscription.findMany({
        where: { userId: session.me.id },
      });
      expect(rows).to.have.length(1);
      expect(rows[0]).to.include({
        endpoint: ENDPOINT,
        p256dh: 'BPk-client-public-key',
        auth: 'client-auth-secret',
        userAgent: 'Chrome on Windows',
        failureCount: 0,
      });
    });

    it('upserts by endpoint rather than piling up rows', async () => {
      const session = await registerUser(app());
      await subscribe(session);
      await harness().prisma.pushSubscription.updateMany({
        where: { endpoint: ENDPOINT },
        data: { failureCount: 3 },
      });

      await subscribe(session);

      const rows = await harness().prisma.pushSubscription.findMany({
        where: { endpoint: ENDPOINT },
      });
      expect(rows).to.have.length(1);
      expect(rows[0]?.failureCount, 'a working endpoint starts clean again').to.equal(0);
    });

    it('moves a shared device to whoever is signed in now', async () => {
      const first = await registerUser(app());
      const second = await registerUser(app());
      await subscribe(first);

      await subscribe(second);

      const rows = await harness().prisma.pushSubscription.findMany({
        where: { endpoint: ENDPOINT },
      });
      expect(rows).to.have.length(1);
      expect(rows[0]?.userId).to.equal(second.me.id);
    });

    it('rejects a malformed subscription and requires a token', async () => {
      const session = await registerUser(app());

      const bad = await request(app())
        .post(SUBSCRIPTIONS_URL)
        .set(...bearer(session.accessToken))
        .send({ endpoint: 'not-a-url', keys: { p256dh: 'x', auth: 'y' } })
        .expect(400);
      expectEnvelope(bad.body, 'VALIDATION_ERROR');

      const unknownField = await request(app())
        .post(SUBSCRIPTIONS_URL)
        .set(...bearer(session.accessToken))
        .send({ ...subscriptionBody(), colour: 'red' })
        .expect(400);
      expectEnvelope(unknownField.body, 'VALIDATION_ERROR');

      const anonymous = await request(app())
        .post(SUBSCRIPTIONS_URL)
        .send(subscriptionBody())
        .expect(401);
      expectEnvelope(anonymous.body, 'UNAUTHENTICATED');
    });
  });

  describe('DELETE /subscriptions', () => {
    it('removes the caller’s subscription and is idempotent', async () => {
      const session = await registerUser(app());
      await subscribe(session);

      for (const _attempt of [1, 2]) {
        await request(app())
          .delete(SUBSCRIPTIONS_URL)
          .set(...bearer(session.accessToken))
          .send({ endpoint: ENDPOINT })
          .expect(204);
      }

      expect(await harness().prisma.pushSubscription.count()).to.equal(0);
    });

    it("leaves another user's device registered (SPEC §9: never 403, never theirs)", async () => {
      const owner = await registerUser(app());
      const intruder = await registerUser(app());
      await subscribe(owner);

      await request(app())
        .delete(SUBSCRIPTIONS_URL)
        .set(...bearer(intruder.accessToken))
        .send({ endpoint: ENDPOINT })
        .expect(204);

      const rows = await harness().prisma.pushSubscription.findMany({
        where: { endpoint: ENDPOINT },
      });
      expect(rows.map((row) => row.userId)).to.deep.equal([owner.me.id]);
    });
  });

  describe('POST /test', () => {
    it('sends to every device the caller has, and to nobody else’s', async () => {
      const session = await registerUser(app());
      const stranger = await registerUser(app());
      const mine = await createPushSubscription(harness().prisma, { userId: session.me.id });
      const alsoMine = await createPushSubscription(harness().prisma, { userId: session.me.id });
      const theirs = await createPushSubscription(harness().prisma, { userId: stranger.me.id });

      const res = await request(app())
        .post(TEST_URL)
        .set(...bearer(session.accessToken))
        .expect(200);

      expect(res.body).to.deep.equal({ sent: 2, removed: 0, failed: 0 });
      const endpoints = harness().pushSender.sent.map((record) => record.sub.endpoint);
      expect(endpoints.sort()).to.deep.equal([mine.endpoint, alsoMine.endpoint].sort());
      expect(endpoints).to.not.include(theirs.endpoint);
      expect(harness().pushSender.sent[0]?.payload.title).to.equal('Beta');
    });

    it('prunes a dead endpoint and stamps a live one', async () => {
      const session = await registerUser(app());
      const dead = await createPushSubscription(harness().prisma, { userId: session.me.id });
      const alive = await createPushSubscription(harness().prisma, { userId: session.me.id });
      harness().pushSender.script(dead.endpoint, { status: 'gone', statusCode: 410 });

      const res = await request(app())
        .post(TEST_URL)
        .set(...bearer(session.accessToken))
        .expect(200);

      expect(res.body).to.deep.equal({ sent: 1, removed: 1, failed: 0 });
      const rows = await harness().prisma.pushSubscription.findMany();
      expect(rows.map((row) => row.endpoint)).to.deep.equal([alive.endpoint]);
      expect(rows[0]?.lastSuccessAt?.valueOf()).to.equal(TEST_NOW_MS);
    });

    it('requires a token', async () => {
      expectEnvelope((await request(app()).post(TEST_URL).expect(401)).body, 'UNAUTHENTICATED');
    });
  });
});
