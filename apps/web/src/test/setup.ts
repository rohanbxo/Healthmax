import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { resetSessionState } from '@/api/client';
import { resetMswState } from './msw/handlers';
import { server } from './msw/server';

/**
 * jsdom ships no `ResizeObserver`, and Radix measures with one — `Switch`
 * sizes its thumb through `@radix-ui/react-use-size`, so the habit form throws
 * on mount without this. A no-op observer is enough: nothing in these tests
 * asserts on measured geometry, only on state and on the requests that leave
 * the client.
 */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= ResizeObserverStub;

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
