/**
 * Which client a rate limit counts against (SPEC.md §9 "Rate limits").
 *
 * Behind a reverse proxy every request arrives from the proxy's address, and
 * only `X-Forwarded-For` says who the client was. `TRUST_PROXY` decides which
 * hops may write that header. Trust too few and every user shares one bucket;
 * trust too many and a client picks its own IP. These tests drive the real
 * Redis-backed limiters with the forgot-password limit (3 per hour per IP)
 * and the global one.
 */
import { expect } from 'chai';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/app';
import type { Config, TrustProxy } from '../src/config';
import { RecordingEventBus } from '../src/events/bus';
import { globalRateLimitKey } from '../src/http/rateLimit';
import { FORGOT_PASSWORD_RATE_LIMIT } from '../src/modules/auth/rateLimits';
import { useTestApp } from './helpers/testApp';
import { bearer, registerUser } from './helpers/auth';

const FORGOT_URL = '/api/auth/forgot-password';

describe('client IP behind a proxy', () => {
  const harness = useTestApp();

  /** The app as deployed with `trustProxy`; a fresh bus so nothing double-subscribes. */
  const appTrusting = (trustProxy: TrustProxy): Express => {
    const config: Config = { ...harness().config, TRUST_PROXY: trustProxy };
    return createApp({ ...harness().deps, config, eventBus: new RecordingEventBus() });
  };

  /** One forgot-password request, as the proxy forwards it. */
  const forgot = (app: Express, forwardedFor?: string) => {
    const req = request(app).post(FORGOT_URL).send({ email: 'someone@example.com' });
    return forwardedFor === undefined ? req : req.set('X-Forwarded-For', forwardedFor);
  };

  /** Uses up the forgot-password limit for whoever `forwardedFor` resolves to. */
  const exhaust = async (app: Express, forwardedFor?: string): Promise<void> => {
    for (let i = 0; i < FORGOT_PASSWORD_RATE_LIMIT.limit; i += 1) {
      const res = await forgot(app, forwardedFor);
      expect(res.status, `request ${i + 1}`).to.equal(204);
    }
    expect((await forgot(app, forwardedFor)).status).to.equal(429);
  };

  describe('one trusted hop (the production default)', () => {
    it('gives each client behind the proxy its own bucket', async () => {
      const app = appTrusting(1);
      await exhaust(app, '203.0.113.10');

      // A different user behind the same proxy is unaffected.
      expect((await forgot(app, '203.0.113.20')).status).to.equal(204);
    });

    it('keys on the address the proxy saw, not one the client wrote', async () => {
      const app = appTrusting(1);
      // The proxy appends the real peer to whatever the client sent, so the
      // client-chosen entries come first and the trusted one last.
      await exhaust(app, '203.0.113.10');

      const spoofed = await forgot(app, '198.51.100.99, 203.0.113.10');
      expect(spoofed.status).to.equal(429);
    });
  });

  describe('two trusted hops (e.g. a CDN in front of a load balancer)', () => {
    it('reaches past both proxies to the client', async () => {
      const app = appTrusting(2);
      await exhaust(app, '203.0.113.10, 10.0.0.5');

      expect((await forgot(app, '203.0.113.20, 10.0.0.5')).status).to.equal(204);
    });

    it('puts everyone in one bucket when only one hop is trusted', async () => {
      // The misconfiguration this setting exists to fix: with one hop trusted
      // behind two proxies, every client "is" the inner proxy.
      const app = appTrusting(1);
      await exhaust(app, '203.0.113.10, 10.0.0.5');

      expect((await forgot(app, '203.0.113.20, 10.0.0.5')).status).to.equal(429);
    });
  });

  describe('no trusted proxy (reached directly)', () => {
    it('ignores X-Forwarded-For, so a client cannot dodge the limit', async () => {
      const app = appTrusting(false);
      await exhaust(app, '203.0.113.10');

      expect((await forgot(app, '203.0.113.20')).status).to.equal(429);
    });
  });

  describe('trusted proxy addresses', () => {
    it('reads the header only from a listed proxy', async () => {
      // supertest connects over loopback, so the "proxy" is 127.0.0.1.
      const app = appTrusting(['loopback']);
      await exhaust(app, '203.0.113.10');

      expect((await forgot(app, '203.0.113.20')).status).to.equal(204);
    });

    it('ignores the header from anything else', async () => {
      const app = appTrusting(['10.0.0.0/8']);
      await exhaust(app, '203.0.113.10');

      expect((await forgot(app, '203.0.113.20')).status).to.equal(429);
    });
  });

  describe('global limit', () => {
    const keyFor = (headers: Record<string, string>): string => {
      const key = globalRateLimitKey({ config: harness().config, clock: harness().clock });
      const req = {
        ip: '203.0.113.10',
        get: (name: string) => headers[name.toLowerCase()],
      } as unknown as Parameters<typeof key>[0];
      return key(req);
    };

    it('counts a signed-in request against the user, not the IP', async () => {
      const session = await registerUser(harness().app);
      expect(keyFor({ authorization: bearer(session.accessToken)[1] })).to.equal(
        `u:${session.me.id}`,
      );
    });

    it('counts a missing or forged token against the IP', () => {
      expect(keyFor({})).to.equal('ip:203.0.113.10');
      expect(keyFor({ authorization: 'Bearer not-a-real-token' })).to.equal('ip:203.0.113.10');
    });

    it('gives two signed-in users behind one IP separate buckets', async () => {
      const app = appTrusting(1);
      const alice = await registerUser(harness().app);
      const bob = await registerUser(harness().app);
      const meAs = (session: typeof alice) =>
        request(app)
          .get('/api/me')
          .set(...bearer(session.accessToken))
          .set('X-Forwarded-For', '203.0.113.10');

      const first = await meAs(alice);
      const second = await meAs(bob);
      expect(first.status).to.equal(200);
      expect(second.status).to.equal(200);
      // Each started its own window: neither request drew on the other's.
      expect(first.headers['ratelimit']).to.match(/remaining=299\b/);
      expect(second.headers['ratelimit']).to.match(/remaining=299\b/);
    });
  });
});
