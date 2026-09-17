/**
 * Express request augmentation. Kept in one place so the middleware contract is
 * discoverable: what is on `req` and which middleware put it there.
 */
import 'express';

/** Output of `validate()` — parsed, typed copies of the request inputs. */
export type ValidatedData = {
  body?: unknown;
  params?: unknown;
  query?: unknown;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express augments through a namespace.
  namespace Express {
    interface Request {
      /** Set by `requestId` middleware; echoed in the `x-request-id` header. */
      requestId: string;
      /** Set by `validate()`. Read through `getValidated()` for types. */
      validated?: ValidatedData;
      /** Set by `authenticate` (M4). Used by the global rate limiter. */
      userId?: string;
    }
  }
}

export {};
