/**
 * External integration API — repository management.
 *
 * Allows listing, creating (onboarding), and managing tracked repositories.
 *
 * GET  /api/v1/repositories                              — List all tracked repositories
 * POST /api/v1/repositories                              — Onboard a new repository (runs coco init)
 * GET  /api/v1/repositories/:repoName                    — Get a specific repository
 * GET  /api/v1/repositories/:repoName/prs                — Get PRs for a repository
 * GET  /api/v1/repositories/:repoName/workers/:name/logs — Get worker logs
 * GET  /api/v1/repositories/:repoName/workers/:name/messages — Get worker messages
 */

import { Router } from "express";
import { spawn } from "child_process";
import type { StateManager } from "../../state/index.js";
import type { EventStore } from "../../state/event-store.js";
import type { WorkerStatus } from "../../state/schemas.js";
import { createApiError } from "../../server/middleware/error-handler.js";

export interface RepositoriesDeps {
  stateManager: StateManager;
  eventStore?: EventStore;
}

/**
 * Map worker status to a PR pipeline stage.
 */
function workerStatusToPRStage(status: WorkerStatus): string {
  switch (status) {
    case "starting":
    case "working":
      return "draft";
    case "completed":
      return "ready";
    case "stuck":
      return "ci_running";
    case "failed":
    case "terminated":
      return "ci_failed";
    default:
      return "draft";
  }
}

export function extRepositoriesRoutes(deps: RepositoriesDeps): Router {
  const { stateManager } = deps;
  const router = Router();

  // GET / — List all tracked repositories
  router.get("/", (_req, res) => {
    const repos = stateManager.getRepos();
    const repoList = Object.values(repos).map((repo) => ({
      name: repo.name,
      url: repo.url,
      defaultBranch: repo.defaultBranch,
      localPath: repo.localPath,
      mode: repo.mode,
      status: repo.status,
      workers: repo.workers,
      agents: repo.agents,
      createdAt: repo.createdAt,
      updatedAt: repo.updatedAt,
    }));
    res.json({ repositories: repoList });
  });

  // POST / — Onboard a new repository
  router.post("/", async (req, res) => {
    let { url } = req.body;

    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Missing required field: url" });
      return;
    }

    // Normalize URL: remove trailing slash and .git suffix for validation
    url = url.trim().replace(/\/$/, "");

    // Validate URL format
    const urlPattern = /^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+(\.git)?$/i;
    if (!urlPattern.test(url)) {
      res.status(400).json({ 
        error: "Invalid repository URL. Please provide a valid GitHub, GitLab, or Bitbucket URL." 
      });
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
      res.status(500).json({ 
        error: "Failed to onboard repository",
        message: errorMessage,
      });
    }
  });

  // GET /:repoName — Get a specific repository
  router.get("/:repoName", (req, res, next) => {
    const { repoName } = req.params;
    const repo = stateManager.getRepo(repoName);
    
    if (!repo) {
      next(createApiError(404, `Repository "${repoName}" not found`));
      return;
    }

    res.json({
      name: repo.name,
      url: repo.url,
      defaultBranch: repo.defaultBranch,
      localPath: repo.localPath,
      mode: repo.mode,
      status: repo.status,
      workers: repo.workers,
      agents: repo.agents,
      createdAt: repo.createdAt,
      updatedAt: repo.updatedAt,
    });
  });

  // GET /:repoName/prs — Get PRs for a repository (from worker state)
  router.get("/:repoName/prs", (req, res, next) => {
    const { repoName } = req.params;
    const repo = stateManager.getRepo(repoName);
    
    if (!repo) {
      next(createApiError(404, `Repository "${repoName}" not found`));
      return;
    }

    // Collect PRs from workers that have PR information
    const prs: Array<{
      number: number;
      title: string;
      url: string;
      branch: string;
      author: string;
      stage: string;
      workerName?: string;
      createdAt: string;
      updatedAt: string;
    }> = [];

    for (const worker of Object.values(repo.workers)) {
      if (worker.prNumber && worker.prUrl) {
        prs.push({
          number: worker.prNumber,
          title: worker.task,
          url: worker.prUrl,
          branch: worker.branch,
          author: worker.name,
          stage: workerStatusToPRStage(worker.status),
          workerName: worker.name,
          createdAt: worker.createdAt,
          updatedAt: worker.updatedAt,
        });
      }
    }

    res.json({ prs });
  });

  // GET /:repoName/workers/:workerName/logs — Get worker logs (stub - returns recent activity)
  router.get("/:repoName/workers/:workerName/logs", (req, res, next) => {
    const { repoName, workerName } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const repo = stateManager.getRepo(repoName);
    
    if (!repo) {
      next(createApiError(404, `Repository "${repoName}" not found`));
      return;
    }

    const worker = repo.workers[workerName];
    if (!worker) {
      next(createApiError(404, `Worker "${workerName}" not found`));
      return;
    }

    // Return basic log entries from worker state - real streaming comes via socket
    const logs = [];
    
    // Add worker lifecycle events as log entries
    logs.push({
      timestamp: worker.createdAt,
      content: `Worker ${workerName} started - Task: ${worker.task}`,
      stream: "stdout",
    });

    if (worker.status === "working") {
      logs.push({
        timestamp: worker.updatedAt,
        content: `Working on branch: ${worker.branch}`,
        stream: "stdout",
      });
    }

    if (worker.status === "completed") {
      logs.push({
        timestamp: worker.updatedAt,
        content: `Worker completed task successfully`,
        stream: "stdout",
      });
    }

    if (worker.prUrl) {
      logs.push({
        timestamp: worker.updatedAt,
        content: `PR created: ${worker.prUrl}`,
        stream: "stdout",
      });
    }

    res.json({ logs: logs.slice(-limit) });
  });

  // GET /:repoName/workers/:workerName/messages — Get worker messages
  router.get("/:repoName/workers/:workerName/messages", (req, res, next) => {
    const { repoName, workerName } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const repo = stateManager.getRepo(repoName);
    
    if (!repo) {
      next(createApiError(404, `Repository "${repoName}" not found`));
      return;
    }

    const worker = repo.workers[workerName];
    if (!worker) {
      next(createApiError(404, `Worker "${workerName}" not found`));
      return;
    }

    // Return empty array - real-time messages come via socket
    // In a future version, we could store message history in Redis
    res.json({ messages: [], limit });
  });

  return router;
}

/**
 * Run `coco init <url>` command and return the output
 */
function runCocoInit(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // SECURITY: Do NOT use shell: true - it enables command injection
    const child = spawn("coco", ["init", url], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    // Store timeout reference so we can clear it
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error("coco init timed out after 60 seconds"));
      }
    }, 60000);

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        reject(new Error(`Failed to run coco init: ${err.message}`));
      }
    });

    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        if (code === 0) {
          resolve(stdout || "Repository initialized successfully");
        } else {
          reject(new Error(stderr || stdout || `coco init exited with code ${code}`));
        }
      }
    });
  });
}

/**
 * Extract repository name from URL
 */
function extractRepoName(url: string): string {
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match ? match[1] : url;
}
