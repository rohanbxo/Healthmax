/**
 * Nothing secret reaches the log (SPEC.md §12).
 *
 * This exists because redacting the obvious fields was not enough. A password
 * reset link is a live credential, and it travels in the URL — so when the
 * browser posted the reset form, it sent `Referer: /reset?token=…` and
 * `pino-http` wrote the whole thing out. `req.body.token` was already
 * redacted; the header was not, and the token sat in the API log in clear.
 *
 * The app is built here with a logger writing into memory, so these assertions
 * run against the real middleware and the real redaction config.
 */
import { expect } from 'chai';
import request from 'supertest';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import type { Express } from 'express';

import { createApp } from '../src/app';
import { REDACTED_PATHS } from '../src/http/logger';
import { useTestApp } from './helpers/testApp';

/** A value that must never appear in the output, whatever carries it. */
const SECRET = 'S3CRET-t0ken-value-do-not-log-me';

describe('logging', () => {
  const harness = useTestApp();
  let lines: string[];
  let app: Express;

  beforeEach(() => {
    lines = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const logger = pino(
      {
        level: 'info',
        base: { service: 'beta-api' },
        redact: { paths: REDACTED_PATHS, remove: true },
      },
      sink,
    );
    app = createApp({ ...harness().deps, logger });
  });

  const output = (): string => lines.join('\n');

  it('keeps a reset token out of the log, however it arrives', async () => {
    await request(app)
      .post('/api/auth/reset-password')
      // Exactly what a browser sends when the reset form is submitted from
      // `/reset?token=…`: the token rides along in the Referer.
      .set('Referer', `http://localhost:5173/reset?token=${SECRET}`)
      .send({ token: SECRET, password: 'a-new-password-long-enough' });

    expect(output(), 'the token reached the log').to.not.include(SECRET);
    expect(output(), 'a reset link reached the log').to.not.include('reset?token=');
    expect(output(), 'nothing was logged at all — the test proves nothing').to.include('"req"');
  });

  it('keeps the bearer token and the refresh cookie out of the log', async () => {
    await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${SECRET}`)
      .set('Cookie', `beta_rt=${SECRET}`);

    expect(output()).to.not.include(SECRET);
    expect(output()).to.not.include('beta_rt');
  });

  it('keeps a password out of the log', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'rider@example.com', password: SECRET });

    expect(output()).to.not.include(SECRET);
  });
});
