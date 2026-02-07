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
 * POST   /api/v1/workers/:name/pause   -- Pause a worker
 * POST   /api/v1/workers/:name/resume  -- Resume a paused worker
 */

import { Router } from "express";
import type { StateManager } from "../../state/index.js";
import type { MessageBroker } from "../../messaging/index.js";
import { MessageType } from "../../messaging/index.js";
import { chocolatierAgentName } from "../../agents/chocolatier.js";
import { createApiError } from "../../server/middleware/error-handler.js";
import { resolveTemplate, BUILTIN_TEMPLATES } from "./templates.js";

export function extWorkerRoutes(
  stateManager: StateManager,
  broker: MessageBroker,
): Router {
  const router = Router();

  // POST / -- Spawn a worker in a specific repository
  // Sends SPAWN_WORKER message to Chocolatier which actually spawns the container
  router.post("/", async (req, res, next) => {
    let { task, repoName, branch, name, model, pushTo, templateId } = req.body ?? {};

    // Resolve task from template if templateId is provided
    if (templateId && !task) {
      const template = resolveTemplate(templateId);
      if (!template) {
        next(createApiError(404, `Template "${templateId}" not found`));
        return;
      }
      task = template.task;
    }

    if (!task) {
      next(createApiError(400, "Missing required field: task"));
      return;
    }
    if (!repoName) {
      next(createApiError(400, "Missing required field: repoName"));
      return;
    }

    // Verify repository exists
    const repo = stateManager.getRepo(repoName);
    if (!repo) {
      next(createApiError(404, `Repository "${repoName}" not tracked`));
      return;
    }

    try {
      // Send SPAWN_WORKER message to Chocolatier
      await broker.send({
        type: MessageType.SPAWN_WORKER,
        from: "api",
        to: chocolatierAgentName(repoName),
        payload: {
          task,
          repoName,
          branch,
          name,
          model,
          pushTo,
        },
      });

      // Return accepted response - actual worker will be created by Chocolatier
      res.status(202).json({
        status: "accepted",
        message: "Worker spawn request sent to Chocolatier",
        task,
        repoName,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      next(createApiError(500, `Failed to send spawn request: ${message}`));
    }
  });

  // GET / -- List workers across all repositories (or filter by repo)
  router.get("/", (req, res) => {
    const repoFilter = req.query.repo as string | undefined;
    const repos = stateManager.getRepos();
    const workers: Array<Record<string, unknown>> = [];

    for (const [repoName, repo] of Object.entries(repos)) {
      // Skip if filtering by repo and doesn't match
      if (repoFilter && repoName !== repoFilter) continue;
      
      for (const worker of Object.values(repo.workers)) {
        workers.push({ ...worker, repoName });
      }
    }

    res.json({ workers });
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

  // POST /:name/pause -- Pause a running worker
  router.post("/:name/pause", async (req, res, next) => {
    const { name } = req.params;
    const repos = stateManager.getRepos();

    for (const [repoName, repo] of Object.entries(repos)) {
      const worker = repo.workers[name];
      if (worker) {
        if (worker.status !== "working") {
          next(createApiError(400, `Worker "${name}" is not running (status: ${worker.status})`));
          return;
        }

        try {
          // Send pause command via message broker
          await broker.send({
            type: MessageType.WORKER_CONTROL,
            from: "api",
            to: `worker:${repoName}:${name}`,
            payload: { action: "pause" },
          });

          // Update state
          await stateManager.updateWorkerStatus(repoName, name, "paused");
          
          res.json({
            status: "paused",
            message: `Worker "${name}" has been paused`,
            worker: { ...worker, status: "paused" },
          });
          return;
        } catch (err) {
          next(err);
          return;
        }
      }
    }

    next(createApiError(404, `Worker "${name}" not found`));
  });

  // POST /:name/resume -- Resume a paused worker
  router.post("/:name/resume", async (req, res, next) => {
    const { name } = req.params;
    const repos = stateManager.getRepos();

    for (const [repoName, repo] of Object.entries(repos)) {
      const worker = repo.workers[name];
      if (worker) {
        if (worker.status !== "paused") {
          next(createApiError(400, `Worker "${name}" is not paused (status: ${worker.status})`));
          return;
        }

        try {
          // Send resume command via message broker
          await broker.send({
            type: MessageType.WORKER_CONTROL,
            from: "api",
            to: `worker:${repoName}:${name}`,
            payload: { action: "resume" },
          });

          // Update state
          await stateManager.updateWorkerStatus(repoName, name, "working");
          
          res.json({
            status: "working",
            message: `Worker "${name}" has been resumed`,
            worker: { ...worker, status: "working" },
          });
          return;
        } catch (err) {
          next(err);
          return;
        }
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
