/**
 * Wave report API routes.
 *
 * GET  /api/v1/waves/reports           — List all wave reports
 * GET  /api/v1/waves/:waveId/report    — Get specific wave report
 * POST /api/v1/waves/:waveId/report    — Generate/regenerate a report
 */

import { Router } from "express";
import type { StateManager } from "../../state/index.js";
import { createApiError } from "../middleware/error-handler.js";
import {
  VALID_WAVE_IDS,
  buildWaveReport,
  saveReport,
  loadReport,
  listReports,
} from "../../wave-reporter/index.js";
import type { WaveId, BuildWaveReportOptions } from "../../wave-reporter/index.js";

export function waveReportRoutes(stateManager: StateManager): Router {
  const router = Router();

  // GET /waves/reports — List all wave reports
  router.get("/reports", async (_req, res, next) => {
    try {
      const baseDir = stateManager.getBaseDir();
      const reports = await listReports(baseDir);
      res.json(reports);
    } catch (err) {
      next(err);
    }
  });

  // GET /waves/:waveId/report — Get specific wave report
  router.get("/:waveId/report", async (req, res, next) => {
    const { waveId } = req.params;
    if (!VALID_WAVE_IDS.has(waveId)) {
      next(
        createApiError(
          400,
          `Invalid waveId "${waveId}". Must be one of: ${Array.from(VALID_WAVE_IDS).join(", ")}`,
        ),
      );
      return;
    }

    try {
      const baseDir = stateManager.getBaseDir();
      const report = await loadReport(waveId as WaveId, baseDir);
      if (!report) {
        next(createApiError(404, `No report found for ${waveId}`));
        return;
      }
      res.json(report);
    } catch (err) {
      next(err);
    }
  });

  // POST /waves/:waveId/report — Generate/regenerate a report
  router.post("/:waveId/report", async (req, res, next) => {
    const { waveId } = req.params;
    if (!VALID_WAVE_IDS.has(waveId)) {
      next(
        createApiError(
          400,
          `Invalid waveId "${waveId}". Must be one of: ${Array.from(VALID_WAVE_IDS).join(", ")}`,
        ),
      );
      return;
    }

    try {
      const opts: BuildWaveReportOptions = req.body ?? {};
      const report = buildWaveReport(
        stateManager,
        waveId as WaveId,
        opts,
      );
      const baseDir = stateManager.getBaseDir();
      await saveReport(report, baseDir);
      res.status(201).json(report);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
