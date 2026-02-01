/**
 * External integration API — system health / status.
 *
 * Returns a snapshot of the system's health including daemon state,
 * Redis connectivity, GitHub auth, Copilot CLI, worker counts, and uptime.
 *
 * GET /api/v1/status
 */

import { Router } from "express";
import { spawn } from "child_process";
import type { StateManager } from "../../state/index.js";

export interface StatusDeps {
  stateManager: StateManager;
  redisConnected?: () => boolean;
}

/**
 * Check if user is logged into GitHub CLI
 */
async function checkGitHubAuth(): Promise<{ authenticated: boolean; user?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("gh", ["auth", "status"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve({ authenticated: false, error: "GitHub auth check timed out" });
      }
    }, 5000);

    child.stdout?.on("data", (data) => { stdout += data.toString(); });
    child.stderr?.on("data", (data) => { stderr += data.toString(); });

    child.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        resolve({ authenticated: false, error: "GitHub CLI not installed" });
      }
    });

    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        if (code === 0) {
          // Parse username from output like "Logged in to github.com account username"
          const match = (stdout + stderr).match(/account\s+(\S+)/i);
          resolve({ authenticated: true, user: match?.[1] });
        } else {
          resolve({ authenticated: false, error: "Not logged in to GitHub" });
        }
      }
    });
  });
}

/**
 * Check if CoCoPilot CLI (coco) is installed
 */
async function checkCopilotCli(): Promise<{ installed: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("coco", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve({ installed: false, error: "coco CLI check timed out" });
      }
    }, 5000);

    child.stdout?.on("data", (data) => { stdout += data.toString(); });
    child.stderr?.on("data", (data) => { stderr += data.toString(); });

    child.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        resolve({ installed: false, error: "coco CLI not installed" });
      }
    });

    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        if (code === 0) {
          const version = (stdout + stderr).trim().split("\n")[0] || "installed";
          resolve({ installed: true, version });
        } else {
          resolve({ installed: false, error: "coco CLI not installed" });
        }
      }
    });
  });
}

export function extStatusRoutes(deps: StatusDeps): Router {
  const { stateManager, redisConnected } = deps;
  const router = Router();

  router.get("/", async (_req, res) => {
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

    // Check GitHub auth and Copilot CLI in parallel
    const [githubAuth, copilotCli] = await Promise.all([
      checkGitHubAuth(),
      checkCopilotCli(),
    ]);

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
      github: {
        authenticated: githubAuth.authenticated,
        user: githubAuth.user ?? null,
        error: githubAuth.error ?? null,
      },
      copilot: {
        installed: copilotCli.installed,
        version: copilotCli.version ?? null,
        error: copilotCli.error ?? null,
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
