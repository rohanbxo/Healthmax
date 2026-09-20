import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';

/** Where the worker lives, and the URL it must be served from. */
const SERVICE_WORKER_SOURCE = '/src/sw/sw.ts';
export const SERVICE_WORKER_PATH = '/sw.js';

/**
 * Serves the service worker at `/sw.js` during development.
 *
 * The production build emits it as a second entry, but `vite dev` only knows
 * about `/src/sw/sw.ts`: a request for `/sw.js` falls through to the SPA
 * fallback and returns `index.html`. The browser then refuses to register it
 * — "The script has an unsupported MIME type ('text/html')" — and push can
 * never be enabled in dev.
 *
 * Registering the source path instead would not do: a worker's scope is its
 * own directory, so `/src/sw/sw.ts` could only control `/src/sw/`. It has to
 * be served from the root.
 *
 * The middleware is added inside `configureServer`'s body, which places it
 * ahead of Vite's own fallback.
 */
function devServiceWorker(): Plugin {
  return {
    name: 'beta-dev-service-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === undefined || req.url.split('?')[0] !== SERVICE_WORKER_PATH) {
          next();
          return;
        }
        server.transformRequest(SERVICE_WORKER_SOURCE).then((result) => {
          if (result === null) {
            next();
            return;
          }
          res.setHeader('Content-Type', 'text/javascript');
          // A worker must never be served stale while it is being edited.
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Service-Worker-Allowed', '/');
          res.end(result.code);
        }, next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devServiceWorker()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: {
    // `@beta/core` builds to CommonJS, because the API runs it that way. A
    // linked workspace package is not pre-bundled by default, and the browser
    // cannot take named exports straight from CJS — without this, every
    // `import { … } from '@beta/core'` fails at runtime with "does not provide
    // an export named …". Pre-bundling converts it to ESM once.
    include: ['@beta/core'],
  },
  server: {
    port: 5173,
    // In Docker the server must listen on every interface, or the published
    // port reaches nothing. Harmless outside Docker.
    host: true,
    // Bind mounts on Windows and macOS do not deliver file events, so the
    // container asks for polling instead (docker-compose.yml).
    watch: process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true } : undefined,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      // The service worker is a second entry, emitted at the root as `/sw.js`
      // so its scope covers the whole app (SPEC.md §10). It is registered with
      // `{ type: 'module' }`, so it may keep its imports.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        sw: fileURLToPath(new URL('./src/sw/sw.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
