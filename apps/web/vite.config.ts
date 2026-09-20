import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
