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
