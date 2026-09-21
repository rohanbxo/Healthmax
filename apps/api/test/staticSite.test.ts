/**
 * Serving the built web app from the API (SPEC.md §13 "Docker").
 *
 * These run against a fixture `dist/` rather than a real build, so they test
 * the routing and the cache headers, not Vite. The first case is the one that
 * matters: the production container answered `GET /api/nope` with a 500,
 * because an unmatched `/api` path fell through the API router into the SPA
 * fallback. Mounting the router first does not exclude the prefix.
 */
import { expect } from 'chai';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';

import { createApp } from '../src/app';
import { useTestApp } from './helpers/testApp';

const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';
const SERVICE_WORKER = 'self.addEventListener("push", () => {});\n';

describe('static site', () => {
  const harness = useTestApp();
  let root: string;
  let app: Express;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'beta-dist-'));
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'index.html'), INDEX_HTML);
    fs.writeFileSync(path.join(root, 'sw.js'), SERVICE_WORKER);
    fs.writeFileSync(path.join(root, 'manifest.webmanifest'), '{"name":"Beta"}');
    fs.writeFileSync(path.join(root, 'assets', 'app-abc123.js'), 'export default 1;\n');
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    const { deps } = harness();
    app = createApp({ ...deps, config: { ...deps.config, WEB_ROOT: root } });
  });

  it('answers an unknown API route with the JSON envelope, not the SPA shell', async () => {
    const response = await request(app).get('/api/nope');

    expect(response.status).to.equal(404);
    expect(response.type).to.equal('application/json');
    expect(response.body.error.code).to.equal('NOT_FOUND');
  });

  it('still serves the API when the web app is mounted', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).to.equal(200);
    expect(response.body.status).to.equal('ok');
  });

  it('serves the service worker as JavaScript, uncached', async () => {
    const response = await request(app).get('/sw.js');

    expect(response.status).to.equal(200);
    expect(response.type).to.match(/javascript/);
    expect(response.headers['cache-control']).to.equal('no-cache');
  });

  it('serves a hashed asset as immutable for a year', async () => {
    const response = await request(app).get('/assets/app-abc123.js');

    expect(response.status).to.equal(200);
    expect(response.headers['cache-control']).to.equal('public, max-age=31536000, immutable');
  });

  it('serves the SPA shell on a client route', async () => {
    const response = await request(app).get('/settings');

    expect(response.status).to.equal(200);
    expect(response.type).to.equal('text/html');
    expect(response.text).to.contain('id="root"');
    expect(response.headers['cache-control']).to.equal('no-cache');
  });

  it('404s a missing script rather than answering it with HTML', async () => {
    // A service worker answered with the SPA shell is what broke registration
    // in development; a 404 is the only safe answer.
    const response = await request(app).get('/assets/gone.js');

    expect(response.status).to.equal(404);
    expect(response.type).to.equal('application/json');
  });

  it('serves only the API when WEB_ROOT is unset', async () => {
    const { deps } = harness();
    const apiOnly = createApp({ ...deps, config: { ...deps.config, WEB_ROOT: undefined } });

    const response = await request(apiOnly).get('/settings');

    expect(response.status).to.equal(404);
    expect(response.type).to.equal('application/json');
  });
});
