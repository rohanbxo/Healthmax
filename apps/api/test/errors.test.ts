/**
 * The error envelope (SPEC.md §9): every non-2xx response is exactly
 * `{ error: { code, message, details } }`, with the documented status for each
 * code, and never a stack trace or a driver message.
 */
import { expect } from 'chai';
import request from 'supertest';
import type { Express } from 'express';
import { useTestApp } from './helpers/testApp';
import { createFaultApp, faultBodySchema, SECRET_FAILURE_MESSAGE } from './helpers/faultApp';
import { GENERIC_INTERNAL_MESSAGE, STATUS_BY_CODE } from '../src/http/errors';

/** Asserts the body is the envelope and nothing else. */
function expectEnvelope(
  body: unknown,
  code: keyof typeof STATUS_BY_CODE,
): { message: string; details: unknown[] } {
  expect(body).to.be.an('object');
  expect(Object.keys(body as object)).to.deep.equal(['error']);
  const error = (body as { error: Record<string, unknown> }).error;
  expect(Object.keys(error).sort()).to.deep.equal(['code', 'details', 'message']);
  expect(error.code).to.equal(code);
  expect(error.message).to.be.a('string').and.not.equal('');
  expect(error.details).to.be.an('array');
  return { message: error.message as string, details: error.details as unknown[] };
}

function expectNoLeak(body: unknown): void {
  const serialized = JSON.stringify(body);
  expect(serialized).to.not.include(SECRET_FAILURE_MESSAGE);
  expect(serialized).to.not.include('at Object.');
  expect(serialized).to.not.include('node_modules');
  expect(serialized).to.not.match(/stack/i);
}

describe('error envelope', () => {
  describe('through the real app', () => {
    const harness = useTestApp();

    it('returns NOT_FOUND for an unknown path', async () => {
      const res = await request(harness().app).get('/api/nope').expect(404);
      expectEnvelope(res.body, 'NOT_FOUND');
    });

    it('returns NOT_FOUND for a known path with the wrong method', async () => {
      const res = await request(harness().app).delete('/api/health').expect(404);
      expectEnvelope(res.body, 'NOT_FOUND');
    });

    it('rejects a body over the 100kb limit with VALIDATION_ERROR 400', async () => {
      const oversized = { blob: 'x'.repeat(200 * 1024) };
      const res = await request(harness().app)
        .post('/api/health')
        .set('Content-Type', 'application/json')
        .send(oversized)
        .expect(400);

      const { message } = expectEnvelope(res.body, 'VALIDATION_ERROR');
      expect(message).to.include('too large');
      expectNoLeak(res.body);
    });

    it('rejects malformed JSON with VALIDATION_ERROR 400', async () => {
      const res = await request(harness().app)
        .post('/api/health')
        .set('Content-Type', 'application/json')
        .send('{"name": ')
        .expect(400);

      expectEnvelope(res.body, 'VALIDATION_ERROR');
    });
  });

  describe('through failing routes', () => {
    let app: Express;

    before(() => {
      app = createFaultApp();
    });

    it('turns an unknown thrown error into a generic INTERNAL 500', async () => {
      const res = await request(app).get('/boom').expect(500);
      const { message } = expectEnvelope(res.body, 'INTERNAL');
      expect(message).to.equal(GENERIC_INTERNAL_MESSAGE);
      expectNoLeak(res.body);
    });

    it('does the same for a rejected promise', async () => {
      const res = await request(app).get('/boom-async').expect(500);
      expectEnvelope(res.body, 'INTERNAL');
      expectNoLeak(res.body);
    });

    it('maps each ApiError helper to its documented status', async () => {
      const cases = [
        { path: '/not-found', code: 'NOT_FOUND' },
        { path: '/unauthenticated', code: 'UNAUTHENTICATED' },
        { path: '/conflict', code: 'CONFLICT' },
        { path: '/unprocessable', code: 'UNPROCESSABLE' },
      ] as const;

      for (const testCase of cases) {
        const res = await request(app).get(testCase.path).expect(STATUS_BY_CODE[testCase.code]);
        expectEnvelope(res.body, testCase.code);
      }
    });

    it('reports a zod failure as VALIDATION_ERROR with path/message details', async () => {
      const res = await request(app).post('/validated').send({ name: 'ab', count: 'three' }).expect(400);

      const { details } = expectEnvelope(res.body, 'VALIDATION_ERROR');
      expect(details).to.have.length(2);
      const paths = details.map((detail) => (detail as { path: string }).path).sort();
      expect(paths).to.deep.equal(['body.count', 'body.name']);
      for (const detail of details) {
        expect(detail).to.have.property('message').that.is.a('string');
      }
    });

    it('rejects unknown body fields', async () => {
      const res = await request(app)
        .post('/validated')
        .send({ name: 'push-ups', count: 3, admin: true })
        .expect(400);

      const { details } = expectEnvelope(res.body, 'VALIDATION_ERROR');
      expect(details.map((detail) => (detail as { path: string }).path)).to.include('body.admin');
    });

    it('accepts a valid body and exposes it through getValidated', async () => {
      const res = await request(app).post('/validated').send({ name: 'push-ups', count: 3 }).expect(200);
      expect(res.body).to.deep.equal({ name: 'push-ups', count: 3 });
    });

    it('exposes the schemas the routes validate with', () => {
      expect(Object.keys(faultBodySchema)).to.deep.equal(['body']);
    });
  });
});
