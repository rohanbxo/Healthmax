/**
 * Adapter for async route handlers: forwards a rejected promise to the error
 * middleware so every failure leaves through the one envelope (SPEC.md §9).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
