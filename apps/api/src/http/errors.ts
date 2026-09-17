/**
 * The single error vocabulary of the API (SPEC.md §9).
 *
 * Every non-2xx response — thrown, rejected, or produced by a middleware we do
 * not own — leaves through `errorHandler` as:
 *
 *     { "error": { "code": "...", "message": "...", "details": [] } }
 *
 * Stack traces and driver messages never reach the client; they are logged
 * server-side against the request id instead.
 */
import type { ErrorRequestHandler, Request } from 'express';
import type { Logger } from 'pino';

/** SPEC.md §9 "Codes". Mirrors `ApiErrorCode` in packages/core. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/** The documented status for each code (SPEC.md §9). */
export const STATUS_BY_CODE: Readonly<Record<ApiErrorCode, number>> = Object.freeze({
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
});

export type ErrorDetail = { path: string; message: string };

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string; details: unknown[] };
};

/** An error whose message is safe to show the caller. */
export class ApiError extends Error {
  public override readonly name = 'ApiError';
  public readonly status: number;

  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details: readonly unknown[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.status = STATUS_BY_CODE[code];
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, details: [...this.details] } };
  }
}

export const badRequest = (message = 'Invalid request.', details: readonly unknown[] = []): ApiError =>
  new ApiError('VALIDATION_ERROR', message, details);

export const unauthenticated = (message = 'Authentication required.'): ApiError =>
  new ApiError('UNAUTHENTICATED', message);

export const notFound = (message = 'Not found.'): ApiError => new ApiError('NOT_FOUND', message);

export const conflict = (message = 'Already exists.'): ApiError => new ApiError('CONFLICT', message);

export const unprocessable = (message = 'Request cannot be processed.', details: readonly unknown[] = []): ApiError =>
  new ApiError('UNPROCESSABLE', message, details);

export const rateLimited = (message = 'Too many requests. Try again shortly.'): ApiError =>
  new ApiError('RATE_LIMITED', message);

export const internal = (cause?: unknown): ApiError =>
  new ApiError('INTERNAL', GENERIC_INTERNAL_MESSAGE, [], { cause });

export const GENERIC_INTERNAL_MESSAGE = 'Something went wrong. Please try again.';

/** Errors thrown by `express.json()` that the caller can actually fix. */
function fromBodyParser(err: unknown): ApiError | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const type = (err as { type?: unknown }).type;
  if (type === 'entity.too.large') {
    return badRequest('Request body is too large (limit 100kb).');
  }
  if (type === 'entity.parse.failed') {
    return badRequest('Request body is not valid JSON.');
  }
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    return badRequest('Unsupported request body encoding.');
  }
  return undefined;
}

function toApiError(err: unknown): { error: ApiError; unexpected: boolean } {
  if (err instanceof ApiError) return { error: err, unexpected: err.code === 'INTERNAL' };
  const parserError = fromBodyParser(err);
  if (parserError) return { error: parserError, unexpected: false };
  return { error: internal(err), unexpected: true };
}

/**
 * Terminal error middleware. Must be registered last (SPEC.md §9 "Middleware
 * order").
 */
export function errorHandler(deps: { logger: Logger }): ErrorRequestHandler {
  return (err, req: Request, res, next) => {
    // Express 5 still hands off to the default handler once headers are sent.
    if (res.headersSent) {
      next(err);
      return;
    }

    const { error, unexpected } = toApiError(err);
    const log = req.log ?? deps.logger;

    if (unexpected) {
      log.error(
        { err: error.cause ?? err, requestId: req.requestId, path: req.originalUrl, method: req.method },
        'Unhandled error',
      );
    } else {
      log.debug(
        { code: error.code, requestId: req.requestId, path: req.originalUrl, method: req.method },
        'Request rejected',
      );
    }

    res.status(error.status).json(error.toBody());
  };
}
