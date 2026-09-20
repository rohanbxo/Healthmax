/**
 * The dev server must serve the service worker at `/sw.js` (SPEC.md §10).
 *
 * This is the test that would have caught the bug the jsdom suite could not:
 * the production build emits `/sw.js` as a second entry, but `vite dev` only
 * knows `/src/sw/sw.ts`, so the request fell through to the SPA fallback and
 * returned `index.html`. Registration then failed with "unsupported MIME type
 * ('text/html')" and push could never be enabled in development.
 *
 * So this boots the real Vite server from the real config and asks for the
 * file the browser asks for.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

const SERVICE_WORKER_PATH = '/sw.js';

describe('dev server', () => {
  let server: ViteDevServer;
  let origin: string;

  beforeAll(async () => {
    server = await createServer({
      // Vitest runs with the package root as the working directory.
      configFile: path.resolve(process.cwd(), 'vite.config.ts'),
      root: process.cwd(),
      // Port 0: never collide with a dev server the developer already has up.
      server: { port: 0, host: '127.0.0.1' },
      logLevel: 'error',
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error('The Vite server did not bind a port');
    }
    origin = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  it('serves the service worker as JavaScript, not the SPA fallback', async () => {
    const response = await fetch(`${origin}${SERVICE_WORKER_PATH}`);

    expect(response.status).toBe(200);
    // The whole point: `text/html` here means the browser refuses to register.
    expect(response.headers.get('content-type')).toMatch(/javascript/);

    const body = await response.text();
    expect(body, 'served index.html instead of the worker').not.toContain('<!doctype html>');
    // The two handlers the worker exists for (SPEC.md §10 "Web client").
    expect(body).toContain('push');
    expect(body).toContain('notificationclick');
  }, 30_000);

  it('claims the whole origin, so the worker can control every route', async () => {
    const response = await fetch(`${origin}${SERVICE_WORKER_PATH}`);

    expect(response.headers.get('service-worker-allowed')).toBe('/');
  }, 30_000);
});
