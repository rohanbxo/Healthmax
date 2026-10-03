/**
 * OpenAPI for export and import (SPEC.md §9). Imported for its side effect by
 * `routes.ts`.
 */
import { z } from 'zod';
import { exportDtoSchema, importBodySchema, instantSchema } from '@beta/core';

import { apiRegistry } from '../../http/openapi';
import { UNAUTHENTICATED_RESPONSE, errorResponse, security } from '../habits/openapi';
import { CLOUD_EXPORT_RATE_LIMIT } from './rateLimits';

const importReportSchema = z.object({
  habits: z.number().int().min(0),
  logs: z.number().int().min(0),
});

apiRegistry.registerPath({
  method: 'get',
  path: '/api/export',
  summary: 'Download everything in this account',
  description:
    'The caller’s habits and logs in the same shapes the rest of the API uses, so the file can be handed straight ' +
    'back to `POST /import`. Served as an attachment.',
  tags: ['transfer'],
  security,
  responses: {
    200: {
      description: 'The export file.',
      content: { 'application/json': { schema: exportDtoSchema } },
    },
    401: UNAUTHENTICATED_RESPONSE,
  },
});

const cloudExportSchema = z.object({
  url: z.url().meta({ description: 'Presigned GET to the stored file. Needs no token.' }),
  expiresAt: instantSchema.meta({ description: 'When `url` stops working.' }),
  key: z.string().meta({ example: 'exports/<userId>/2026-09-17T06:00:00.000Z-<uuid>.json' }),
});

apiRegistry.registerPath({
  method: 'post',
  path: '/api/export/cloud',
  summary: 'Save an export to cloud storage and get a download link',
  description:
    'Writes the same file `GET /export` serves to the export bucket (encrypted at rest) and answers with a ' +
    'presigned link to it. The link points at the bucket directly, not at this API, carries no token, and works ' +
    'for `EXPORT_URL_TTL_SECONDS` (15 minutes by default) — anyone holding it until then can download the file. ' +
    `Rate limited to ${CLOUD_EXPORT_RATE_LIMIT.limit} per hour per user.`,
  tags: ['transfer'],
  security,
  responses: {
    201: {
      description: 'Stored; the link is ready.',
      content: { 'application/json': { schema: cloudExportSchema } },
    },
    401: UNAUTHENTICATED_RESPONSE,
    404: errorResponse('Cloud export is not configured.'),
    429: errorResponse('Too many cloud exports.'),
  },
});

apiRegistry.registerPath({
  method: 'post',
  path: '/api/import',
  summary: 'Replace all habits and logs with a file',
  description:
    'Destructive and atomic: the caller’s habits and logs are replaced by the file in one transaction, so a bad ' +
    'file leaves the account exactly as it was. `me` in the file is ignored — an import can never change who you ' +
    'are or move data between accounts.',
  tags: ['transfer'],
  security,
  request: { body: { content: { 'application/json': { schema: importBodySchema } } } },
  responses: {
    200: {
      description: 'How much was written.',
      content: { 'application/json': { schema: importReportSchema } },
    },
    400: errorResponse('The file is not a Beta export.'),
    401: UNAUTHENTICATED_RESPONSE,
    422: errorResponse('The file is well formed but inconsistent, e.g. a log with no habit.'),
  },
});
