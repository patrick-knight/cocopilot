/**
 * External integration API — system health / status.
 *
 * Returns a snapshot of the system's health including daemon state,
 * Redis connectivity, worker counts, and uptime.
 *
 * GET /api/v1/status
 */

import { Router } from "express";
import type { StateManager } from "../../state/index.js";

export interface StatusDeps {
  stateManager: StateManager;
  redisConnected?: () => boolean;
}

export function extStatusRoutes(deps: StatusDeps): Router {
  const { stateManager, redisConnected } = deps;
  const router = Router();

  router.get("/", (_req, res) => {
    const daemonState = stateManager.getDaemonState();
    const repos = stateManager.getRepos();

    // Aggregate worker counts across all repos
    let totalWorkers = 0;
    const byStatus: Record<string, number> = {};

    for (const repo of Object.values(repos)) {
      for (const worker of Object.values(repo.workers)) {
        totalWorkers++;
        byStatus[worker.status] = (byStatus[worker.status] ?? 0) + 1;
      }
    }

    // Calculate uptime in seconds
    let uptimeSeconds: number | null = null;
    if (daemonState.startedAt) {
      const startMs = new Date(daemonState.startedAt).getTime();
      uptimeSeconds = Math.floor((Date.now() - startMs) / 1000);
    }

    res.json({
      daemon: {
        up: daemonState.status === "running",
        status: daemonState.status,
        pid: daemonState.pid ?? null,
        uptimeSeconds,
        startedAt: daemonState.startedAt ?? null,
      },
      redis: {
        connected: redisConnected ? redisConnected() : false,
      },
      workers: {
        total: totalWorkers,
        byStatus,
      },
      repositories: Object.keys(repos).length,
      version: daemonState.version,
    });
  });

  return router;
}
