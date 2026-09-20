/**
 * Structured logging (SPEC.md §2 "Logging", §12). Every line carries the
 * request id; `authorization`, `cookie` and `set-cookie` are removed before
 * anything is written.
 */
import pinoHttp, { type HttpLogger } from 'pino-http';
import { pino, type Logger } from 'pino';
import type { Config } from '../config';
import { REQUEST_ID_HEADER } from './requestId';

/** Header values that must never be written to a log. */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.token',
];

export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
    base: { service: 'beta-api' },
    redact: { paths: REDACTED_PATHS, remove: true },
  });
}

/**
 * `pino-http` middleware. Health checks log at `debug` so a once-a-minute probe
 * does not drown the log.
 */
export function httpLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id =
        (req as { requestId?: string }).requestId ?? String(req.headers[REQUEST_ID_HEADER] ?? '');
      if (id) res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      if (req.url?.startsWith('/api/health')) return 'debug';
      return 'info';
    },
    // The error handler already logs the cause with full context.
    customErrorMessage: () => 'request errored',
  });
}
