/**
 * Request correlation (SPEC.md §2 "Logging"). Accepts an inbound
 * `x-request-id` so a proxy or the web client can stitch traces together, and
 * always echoes the value it settled on.
 */
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Inbound ids are untrusted input: bound the length and the alphabet. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function requestId(): RequestHandler {
  return (req, res, next) => {
    const inbound = req.get(REQUEST_ID_HEADER);
    const id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
    req.requestId = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  };
}
