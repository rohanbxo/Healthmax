/**
 * Terminal 404 (SPEC.md §9 "Middleware order"). Unknown paths get the same
 * envelope as everything else, so clients only ever parse one error shape.
 */
import type { RequestHandler } from 'express';
import { notFound as notFoundError } from './errors';

export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => {
    next(notFoundError(`Cannot ${req.method} ${req.path}`));
  };
}
