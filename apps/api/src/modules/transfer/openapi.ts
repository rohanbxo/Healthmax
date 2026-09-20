/**
 * OpenAPI for export and import (SPEC.md §9). Imported for its side effect by
 * `routes.ts`.
 */
import { z } from 'zod';
import { exportDtoSchema, importBodySchema } from '@beta/core';

import { apiRegistry } from '../../http/openapi';
import { UNAUTHENTICATED_RESPONSE, errorResponse, security } from '../habits/openapi';

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
