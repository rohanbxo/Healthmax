import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/**
 * One MSW server for the whole suite; `src/test/setup.ts` starts it, resets
 * handlers after each test and closes it at the end. Tests add one-off
 * overrides with `server.use(...)`.
 */
export const server = setupServer(...handlers);
