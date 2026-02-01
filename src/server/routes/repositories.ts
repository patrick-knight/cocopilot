/**
 * Repository CRUD routes.
 *
 * POST   /api/v1/repositories            -- Initialize repo tracking
 * GET    /api/v1/repositories             -- List all repos
 * GET    /api/v1/repositories/:repoName   -- Get repo detail
 * DELETE /api/v1/repositories/:repoName   -- Remove repo
 * POST   /api/v1/repositories/:repoName/repair -- Repair/recover repository
 */

import { Router } from "express";
import { spawn } from "child_process";
import type { StateManager } from "../../state/index.js";
import { cleanupWorktree } from "../../git/index.js";
import { createApiError } from "../middleware/error-handler.js";

/** Recovery function signature for the repair endpoint */
export type RecoverRepositoryFn = (repoName: string) => Promise<{
  agentsRestarted: number;
  workersCleanedUp: number;
  errors: string[];
}>;

export function repositoryRoutes(
  stateManager: StateManager,
  onRecoverRepository?: RecoverRepositoryFn,
): Router {
  const router = Router();

  // POST /repositories -- Initialize repo tracking
  // Accepts either:
  //   { url: "https://github.com/org/repo" } - runs coco init
  //   { name, url, localPath, mode, defaultBranch } - direct add
  router.post("/", async (req, res, next) => {
    const { name, url, localPath, mode, defaultBranch } = req.body ?? {};
    
    // If only URL provided, run coco init
    if (url && !name && !localPath && !mode) {
      // Validate URL format
      const urlPattern = /^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+/i;
      if (!urlPattern.test(url)) {
        next(createApiError(400, "Invalid repository URL. Please provide a valid GitHub, GitLab, or Bitbucket URL."));
        return;
      }

      try {
        // Run coco init command
        const result = await runCocoInit(url);
        
        // Reload state to pick up the new repository
        await stateManager.reloadState();
        
        // Get the newly added repo
        const repos = stateManager.getRepos();
        const repoName = extractRepoName(url);
        const newRepo = repos[repoName];

        if (newRepo) {
          res.status(201).json({
            message: "Repository onboarded successfully",
            repository: {
              name: newRepo.name,
              url: newRepo.url,
              defaultBranch: newRepo.defaultBranch,
              mode: newRepo.mode,
              status: newRepo.status,
            },
          });
        } else {
          res.status(201).json({
            message: "Repository onboarded successfully",
            output: result,
          });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        next(createApiError(500, `Failed to onboard repository: ${errorMessage}`));
      }
      return;
    }
    
    // Otherwise require all fields for direct add
    if (!name || !url || !localPath || !mode) {
      next(createApiError(400, "Missing required fields: name, url, localPath, mode"));
      return;
    }
    try {
      const repo = await stateManager.addRepo({
        name,
        url,
        localPath,
        mode,
        defaultBranch,
      });
      res.status(201).json(repo);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("already tracked")) {
        next(createApiError(409, message));
      } else {
        next(err);
      }
    }
  });

  // GET /repositories -- List all repos
  router.get("/", (_req, res) => {
    const repos = stateManager.getRepos();
    res.json(Object.values(repos));
  });

  // GET /repositories/:repoName -- Get repo detail
  router.get("/:repoName", (req, res, next) => {
    const repo = stateManager.getRepo(req.params.repoName);
    if (!repo) {
      next(createApiError(404, `Repository "${req.params.repoName}" not found`));
      return;
    }
    res.json(repo);
  });

  // DELETE /repositories/:repoName -- Remove repo
  router.delete("/:repoName", async (req, res, next) => {
    try {
      await stateManager.removeRepo(req.params.repoName);
      res.status(204).end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not tracked")) {
        next(createApiError(404, message));
      } else {
        next(err);
      }
    }
  });

  // POST /repositories/:repoName/repair -- Clean up orphaned workers, restart agents
  router.post("/:repoName/repair", async (req, res, next) => {
    const { repoName } = req.params;
    const repo = stateManager.getRepo(repoName);
    if (!repo) {
      next(createApiError(404, `Repository "${repoName}" not found`));
      return;
    }

    try {
      // If we have the full recovery function (from Concher), use it
      if (onRecoverRepository) {
        const result = await onRecoverRepository(repoName);
        const messages: string[] = [];
        
        if (result.workersCleanedUp > 0) {
          messages.push(`Cleaned up ${result.workersCleanedUp} orphaned worker(s)`);
        }
        if (result.agentsRestarted > 0) {
          messages.push(`Restarted ${result.agentsRestarted} agent(s)`);
        }
        if (messages.length === 0) {
          messages.push("No recovery needed");
        }

        res.json({
          message: messages.join(". "),
          workersCleanedUp: result.workersCleanedUp,
          agentsRestarted: result.agentsRestarted,
          errors: result.errors.length > 0 ? result.errors : undefined,
        });
        return;
      }

      // Fallback: basic cleanup without agent restart (if no recovery function)
      const workers = repo.workers || {};
      const orphanedStatuses = ["failed", "stuck", "terminated", "completed"];
      let cleaned = 0;
      const errors: string[] = [];

      for (const [workerName, worker] of Object.entries(workers)) {
        if (orphanedStatuses.includes(worker.status)) {
          // Clean up worktree first (if repo has localPath)
          if (repo.localPath) {
            try {
              await cleanupWorktree(repo.localPath, workerName);
            } catch (wtErr) {
              errors.push(`Worktree cleanup for ${workerName}: ${wtErr instanceof Error ? wtErr.message : String(wtErr)}`);
            }
          }
          // Remove from state
          await stateManager.removeWorker(repoName, workerName);
          cleaned++;
        }
      }

      res.json({
        message: cleaned > 0 
          ? `Cleaned up ${cleaned} orphaned worker(s)` 
          : "No orphaned workers found",
        workersCleanedUp: cleaned,
        agentsRestarted: 0,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      next(createApiError(500, `Failed to repair repository: ${message}`));
    }
  });

  return router;
}

/**
 * Run `coco init <url>` command and return the output
 */
function runCocoInit(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("coco", ["init", url], {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to run coco init: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout || "Repository initialized successfully");
      } else {
        reject(new Error(stderr || stdout || `coco init exited with code ${code}`));
      }
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      child.kill();
      reject(new Error("coco init timed out after 60 seconds"));
    }, 60000);
  });
}

/**
 * Extract repository name from URL
 */
function extractRepoName(url: string): string {
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match ? match[1] : url;
}
