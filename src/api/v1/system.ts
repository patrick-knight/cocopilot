/**
 * System control endpoints for daemon management.
 */

import type { Request, Response } from "express";
import type { StateManager } from "../../state/index.js";

export interface SystemDeps {
  stateManager: StateManager;
}

/**
 * POST /api/v1/system/reload-state
 * Force the daemon to reload state from disk.
 * Used by CLI commands that modify state.json directly.
 */
export async function reloadState(
  req: Request,
  res: Response,
  deps: SystemDeps,
): Promise<void> {
  try {
    await deps.stateManager.reloadState();
    res.json({
      success: true,
      message: "State reloaded successfully",
      repositories: Object.keys(deps.stateManager.getRepos()),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * GET /api/v1/system/backups
 * List available state backups.
 */
export function listBackups(
  _req: Request,
  res: Response,
  deps: SystemDeps,
): void {
  const backups = deps.stateManager.listBackups();
  res.json({ backups });
}

/**
 * POST /api/v1/system/restore
 * Restore state from a backup.
 * Body: { backupIndex?: number }
 */
export async function restoreBackup(
  req: Request,
  res: Response,
  deps: SystemDeps,
): Promise<void> {
  const { backupIndex } = req.body ?? {};

  if (backupIndex !== undefined && (typeof backupIndex !== "number" || backupIndex < 1)) {
    res.status(400).json({ success: false, error: "backupIndex must be a positive integer" });
    return;
  }

  try {
    const ok = await deps.stateManager.restoreFromBackup(backupIndex);
    if (ok) {
      res.json({
        success: true,
        message: `State restored from backup ${backupIndex ?? 1}`,
        repositories: Object.keys(deps.stateManager.getRepos()),
      });
    } else {
      res.status(400).json({ success: false, error: "Restore failed — backup missing or invalid" });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
