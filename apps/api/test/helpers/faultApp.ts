/**
 * A tiny app that exists only to make the error handler misbehave on purpose.
 *
 * `createApp` deliberately has no hook for injecting routes — production code
 * should not carry a test back door — so the error-envelope tests compose the
 * same middleware around a handful of failing routes.
 */
import express, { type Express } from 'express';
import { z } from 'zod';
import { pino } from 'pino';
import { requestId } from '../../src/http/requestId';
import { errorHandler, conflict, notFound, unauthenticated, unprocessable } from '../../src/http/errors';
import { notFoundHandler } from '../../src/http/notFound';
import { validate, getValidated } from '../../src/http/validate';

/** The message a leaking handler must never reveal. */
export const SECRET_FAILURE_MESSAGE = 'connect ECONNREFUSED 10.0.0.1:5432 password=hunter2';

export const faultBodySchema = { body: z.object({ name: z.string().min(3), count: z.number().int() }) };

export function createFaultApp(): Express {
  const app = express();
  const logger = pino({ level: 'silent' });

  app.use(requestId());
  app.use(express.json({ limit: '100kb' }));

  app.get('/boom', () => {
    throw new Error(SECRET_FAILURE_MESSAGE);
  });
  app.get('/boom-async', (_req, _res, next) => {
    Promise.reject(new Error(SECRET_FAILURE_MESSAGE)).catch(next);
  });
  app.get('/not-found', (_req, _res, next) => {
    next(notFound('Habit not found.'));
  });
  app.get('/unauthenticated', (_req, _res, next) => {
    next(unauthenticated());
  });
  app.get('/conflict', (_req, _res, next) => {
    next(conflict('Email already registered.'));
  });
  app.get('/unprocessable', (_req, _res, next) => {
    next(unprocessable('Future days cannot be logged.'));
  });
  app.post('/validated', validate(faultBodySchema), (req, res) => {
    res.json(getValidated(req, faultBodySchema).body);
  });

  app.use(notFoundHandler());
  app.use(errorHandler({ logger }));
  return app;
}
