/**
 * External integration API — flat worker management.
 *
 * Aggregates workers across all tracked repositories so external
 * tools don't need to know about the repo hierarchy.
 *
 * POST   /api/v1/workers           -- Spawn a worker
 * GET    /api/v1/workers           -- List all workers
 * GET    /api/v1/workers/:name     -- Get worker by name
 * DELETE /api/v1/workers/:name     -- Stop / remove worker
 */

import { Router } from "express";
import type { StateManager } from "../../state/index.js";
import type { MessageBroker } from "../../messaging/index.js";
import { createApiError } from "../../server/middleware/error-handler.js";

export function extWorkerRoutes(
  stateManager: StateManager,
  broker: MessageBroker,
): Router {
  const router = Router();

  // POST / -- Spawn a worker in a specific repository
  router.post("/", async (req, res, next) => {
    const { task, repoName, branch, name, model } = req.body ?? {};

    if (!task) {
      next(createApiError(400, "Missing required field: task"));
      return;
    }
    if (!repoName) {
      next(createApiError(400, "Missing required field: repoName"));
      return;
    }

    try {
      const worker = await stateManager.addWorker(repoName, {
        task,
        branch,
        name,
        model,
      });
      res.status(201).json(worker);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not tracked")) {
        next(createApiError(404, message));
      } else if (
        message.includes("already exists") ||
        message.includes("Maximum workers")
      ) {
        next(createApiError(409, message));
      } else {
        next(err);
      }
    }
  });

  // GET / -- List workers across all repositories
  router.get("/", (_req, res) => {
    const repos = stateManager.getRepos();
    const workers: Array<Record<string, unknown>> = [];

    for (const [repoName, repo] of Object.entries(repos)) {
      for (const worker of Object.values(repo.workers)) {
        workers.push({ ...worker, repoName });
      }
    }

    res.json(workers);
  });

  // GET /:name -- Get a specific worker by name (searches all repos)
  router.get("/:name", (req, res, next) => {
    const { name } = req.params;
    const repos = stateManager.getRepos();

    for (const [repoName, repo] of Object.entries(repos)) {
      const worker = repo.workers[name];
      if (worker) {
        res.json({ ...worker, repoName });
        return;
      }
    }

    next(createApiError(404, `Worker "${name}" not found`));
  });

  // DELETE /:name -- Remove a worker by name (searches all repos)
  router.delete("/:name", async (req, res, next) => {
    const { name } = req.params;
    const repos = stateManager.getRepos();

    for (const [repoName, repo] of Object.entries(repos)) {
      if (repo.workers[name]) {
        try {
          await stateManager.removeWorker(repoName, name);
          res.status(204).end();
          return;
        } catch (err) {
          next(err);
          return;
        }
      }
    }

    next(createApiError(404, `Worker "${name}" not found`));
  });

  return router;
}
