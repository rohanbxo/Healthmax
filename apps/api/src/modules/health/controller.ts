/**
 * Health controller: calls the service and maps the report onto a status code
 * (SPEC.md §9 — 200 when everything answers, 503 otherwise).
 */
import type { RequestHandler } from 'express';
import type { HealthService } from './service';

export function healthController(service: HealthService): RequestHandler {
  return (_req, res, next) => {
    service
      .check()
      .then((report) => {
        res.status(report.status === 'ok' ? 200 : 503).json(report);
      })
      .catch(next);
  };
}
