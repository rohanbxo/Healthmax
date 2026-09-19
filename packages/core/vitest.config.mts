import { defineConfig } from 'vitest/config';

// A zone no fixture uses, so a machine whose offset matches a fixture's can
// never make a timezone bug pass by accident. Set before the workers fork, so
// every one of them inherits it.
process.env.TZ = 'America/Los_Angeles';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: { provider: 'v8', reporter: ['text', 'lcov'], reportsDirectory: 'coverage' },
  },
});
