import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { resetSessionState } from '@/api/client';
import { resetMswState } from './msw/handlers';
import { server } from './msw/server';

// Any request the handlers do not cover is a bug in the test, not a silent
// pass-through to the network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  resetMswState();
  resetSessionState();
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  server.events.removeAllListeners();
  resetSessionState();
  resetMswState();
});

afterAll(() => server.close());
