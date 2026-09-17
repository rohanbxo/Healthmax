/**
 * `GET /api/health` (SPEC.md §9): checks Postgres and Redis, public, and never
 * rate limited.
 */
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { useTestApp } from './helpers/testApp';
import { REQUEST_ID_HEADER } from '../src/http/requestId';
import { errorHandler } from '../src/http/errors';
import { createHealthRouter } from '../src/modules/health/routes';

describe('GET /api/health', () => {
  const harness = useTestApp();

  it('reports ok when Postgres and Redis both answer', async () => {
    const res = await request(harness().app).get('/api/health').expect(200);

    expect(res.body).to.have.property('status', 'ok');
    expect(res.body.checks.database.ok).to.equal(true);
    expect(res.body.checks.redis.ok).to.equal(true);
    expect(res.body.checks.database).to.not.have.property('error');
    expect(res.body.checks.redis).to.not.have.property('error');
  });

  it('needs no authentication', async () => {
    await request(harness().app).get('/api/health').expect(200);
  });

  it('is exempt from the global rate limit', async () => {
    const res = await request(harness().app).get('/api/health').expect(200);
    // The draft-7 `RateLimit` header only appears on requests that were counted.
    expect(res.headers).to.not.have.property('ratelimit');
  });

  it('echoes a caller-supplied request id', async () => {
    const res = await request(harness().app)
      .get('/api/health')
      .set(REQUEST_ID_HEADER, 'req-from-the-proxy')
      .expect(200);

    expect(res.headers[REQUEST_ID_HEADER]).to.equal('req-from-the-proxy');
  });

  it('generates a request id when the caller omits one', async () => {
    const res = await request(harness().app).get('/api/health').expect(200);
    expect(res.headers[REQUEST_ID_HEADER]).to.be.a('string').with.length.greaterThan(10);
  });

  it('answers 503 and names the failing dependency', async () => {
    const { deps } = harness();
    const brokenRedis = {
      ping: () => Promise.reject(new Error('redis is down')),
    } as unknown as typeof deps.redis;

    const app = express();
    app.use('/api', createHealthRouter({ prisma: deps.prisma, redis: brokenRedis, clock: deps.clock }));
    app.use(errorHandler({ logger: deps.logger }));

    const res = await request(app).get('/api/health').expect(503);
    expect(res.body.status).to.equal('degraded');
    expect(res.body.checks.redis.ok).to.equal(false);
    expect(res.body.checks.redis.error).to.be.a('string');
    expect(res.body.checks.database.ok).to.equal(true);
  });
});
