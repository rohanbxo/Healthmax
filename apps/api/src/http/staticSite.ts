/**
 * Serving the built web app from the API (SPEC.md §13 "Docker").
 *
 * The production image runs one process with `ROLE=all`: the API under `/api`
 * and the web app on everything else. Same origin means no CORS anywhere and
 * first-party cookies, which is what lets the refresh cookie be
 * `SameSite=Strict`.
 *
 * Two caching rules, because the files differ:
 *  - `assets/*` carry a content hash in the name, so they can be cached for a
 *    year and never revalidated;
 *  - `index.html` and `sw.js` must not be, or a browser keeps an old shell or
 *    an old worker after a deploy.
 *
 * Anything not matched is the SPA fallback: React Router owns those paths.
 * `/api` is excluded from it. Mounting the API router first is not enough —
 * a path the router has no route for falls straight through to here, and an
 * unknown API route must answer with the JSON 404 envelope, not the SPA shell.
 */
import path from 'node:path';
import express, { type Express, type Request, type Response } from 'express';

/** A year, the standard for immutable hashed assets. */
const IMMUTABLE_MAX_AGE_SECONDS = 31_536_000;

/** Files that must always be revalidated. */
const NEVER_CACHED = new Set(['/index.html', '/sw.js', '/manifest.webmanifest']);

export type StaticSiteOptions = {
  /** Absolute path to the built web app (`apps/web/dist`). */
  root: string;
  /** Path prefix the API owns; never answered with the SPA shell. */
  apiBasePath: string;
};

export function serveStaticSite(app: Express, options: StaticSiteOptions): void {
  const { root, apiBasePath } = options;
  const ownedByApi = (urlPath: string): boolean =>
    urlPath === apiBasePath || urlPath.startsWith(`${apiBasePath}/`);

  app.use(
    express.static(root, {
      index: false,
      etag: true,
      setHeaders: (res, filePath) => {
        const url = `/${path.relative(root, filePath).split(path.sep).join('/')}`;
        if (NEVER_CACHED.has(url)) {
          res.setHeader('Cache-Control', 'no-cache');
          return;
        }
        if (url.startsWith('/assets/')) {
          res.setHeader('Cache-Control', `public, max-age=${IMMUTABLE_MAX_AGE_SECONDS}, immutable`);
          return;
        }
        res.setHeader('Cache-Control', 'public, max-age=3600');
      },
    }),
  );

  // The SPA fallback. A service worker must never be answered with HTML — that
  // is what made registration fail in development — so an unknown path that
  // looks like a script or an asset 404s instead.
  app.get(/.*/, (req: Request, res: Response, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (path.extname(req.path) !== '' || ownedByApi(req.path)) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(root, 'index.html'));
  });
}
