/**
 * Export and import controller (SPEC.md §3, §9).
 */
import type { RequestHandler } from 'express';
import { importBodySchema } from '@beta/core';

import { asyncHandler } from '../../http/asyncHandler';
import { requireUserId } from '../../http/authenticate';
import { getValidated } from '../../http/validate';
import type { TransferService } from './service';

export const transferSchemas = {
  import: { body: importBodySchema },
} as const;

export type TransferController = {
  export: RequestHandler;
  exportToCloud: RequestHandler;
  import: RequestHandler;
};

/** `beta-export-2026-09-21.json` — a name that sorts and says what it is. */
export function exportFilename(exportedAt: string): string {
  return `beta-export-${exportedAt.slice(0, 10)}.json`;
}

export function createTransferController(deps: { service: TransferService }): TransferController {
  return {
    export: asyncHandler(async (req, res) => {
      const data = await deps.service.export(requireUserId(req));
      // A download rather than something the browser renders.
      res
        .status(200)
        .set('Content-Disposition', `attachment; filename="${exportFilename(data.exportedAt)}"`)
        .json(data);
    }),

    exportToCloud: asyncHandler(async (req, res) => {
      res.status(201).json(await deps.service.exportToCloud(requireUserId(req)));
    }),

    import: asyncHandler(async (req, res) => {
      const { body } = getValidated(req, transferSchemas.import);
      res.status(200).json(await deps.service.import(requireUserId(req), body));
    }),
  };
}
