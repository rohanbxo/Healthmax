/**
 * Route-boundary validation (SPEC.md §12: "All input validated with zod at the
 * route boundary (body, params, query); unknown body fields rejected").
 *
 * Parsed values land on `req.validated` — Express 5 makes `req.query` a getter,
 * and overwriting inputs in place hides what the client actually sent.
 */
import type { Request, RequestHandler } from 'express';
import { z, type ZodType } from 'zod';
import { badRequest, type ErrorDetail } from './errors';

export type ValidationSchemas = {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
};

type Out<S extends ZodType | undefined> = S extends ZodType ? z.infer<S> : undefined;

export type Validated<S extends ValidationSchemas> = {
  body: Out<S['body']>;
  params: Out<S['params']>;
  query: Out<S['query']>;
};

/** Unknown body keys are an error, not something to silently drop. */
function strictify(schema: ZodType): ZodType {
  return schema instanceof z.ZodObject ? schema.strict() : schema;
}

function detailsFor(source: string, error: z.ZodError): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  for (const issue of error.issues) {
    const base = [source, ...issue.path.map(String)];
    // zod reports unknown keys once, against the parent object; name each one.
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        details.push({ path: [...base, key].join('.'), message: `Unrecognized field "${key}".` });
      }
      continue;
    }
    details.push({ path: base.join('.'), message: issue.message });
  }
  return details;
}

/**
 * Validates `body`, `params` and `query` and stores the parsed output on
 * `req.validated`. Failures become `VALIDATION_ERROR` 400 with a `details`
 * array of `{ path, message }`.
 */
export function validate<S extends ValidationSchemas>(schemas: S): RequestHandler {
  const body = schemas.body ? strictify(schemas.body) : undefined;
  const { params, query } = schemas;

  return (req, _res, next) => {
    const details: ErrorDetail[] = [];
    const validated: { body?: unknown; params?: unknown; query?: unknown } = {};

    if (body) {
      const result = body.safeParse(req.body);
      if (result.success) validated.body = result.data;
      else details.push(...detailsFor('body', result.error));
    }
    if (params) {
      const result = params.safeParse(req.params);
      if (result.success) validated.params = result.data;
      else details.push(...detailsFor('params', result.error));
    }
    if (query) {
      const result = query.safeParse(req.query);
      if (result.success) validated.query = result.data;
      else details.push(...detailsFor('query', result.error));
    }

    if (details.length > 0) {
      next(badRequest('Request validation failed.', details));
      return;
    }

    req.validated = validated;
    next();
  };
}

/**
 * Typed accessor for what `validate(schemas)` parsed. Pass the same schemas
 * object so the types line up:
 *
 *     const schemas = { body: createHabitBody } as const;
 *     router.post('/habits', validate(schemas), (req, res) => {
 *       const { body } = getValidated(req, schemas);
 *     });
 */
export function getValidated<S extends ValidationSchemas>(req: Request, _schemas: S): Validated<S> {
  if (!req.validated) {
    throw new Error('getValidated() called on a route without validate() middleware');
  }
  return req.validated as Validated<S>;
}
