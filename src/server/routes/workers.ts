/**
 * Worker management routes (nested under a repository).
 *
 * POST   /api/v1/repositories/:repoName/workers              -- Spawn worker
 * GET    /api/v1/repositories/:repoName/workers              -- List workers
 * GET    /api/v1/repositories/:repoName/workers/:workerName  -- Get worker
 * DELETE /api/v1/repositories/:repoName/workers/:workerName  -- Terminate worker
 * POST   /api/v1/repositories/:repoName/workers/:workerName/nudge -- Nudge worker
 */

import { Router } from "express";
import type { StateManager } from "../../state/index.js";
import type { MessageBroker } from "../../messaging/index.js";
import { MessageType } from "../../messaging/index.js";
import { createApiError } from "../middleware/error-handler.js";

interface RepoParams {
  repoName: string;
  [key: string]: string;
}

interface WorkerParams extends RepoParams {
  workerName: string;
}

export function workerRoutes(
  stateManager: StateManager,
  broker: MessageBroker,
): Router {
  const router = Router({ mergeParams: true });

  // POST /repositories/:repoName/workers -- Spawn worker
  router.post("/", async (req, res, next) => {
    const { repoName } = req.params as unknown as RepoParams;
    const { task, branch, name, model } = req.body ?? {};
    if (!task) {
      next(createApiError(400, "Missing required field: task"));
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
      } else if (message.includes("already exists") || message.includes("Maximum workers")) {
        next(createApiError(409, message));
      } else {
        next(err);
      }
    }
  });

  // GET /repositories/:repoName/workers -- List workers
  router.get("/", (req, res, next) => {
    const { repoName } = req.params as unknown as RepoParams;
    const repo = stateManager.getRepo(repoName);
    if (!repo) {
      next(createApiError(404, `Repository "${repoName}" not found`));
      return;
    }
    res.json(Object.values(repo.workers));
  });

  // GET /repositories/:repoName/workers/:workerName -- Get worker
  router.get("/:workerName", (req, res, next) => {
    const { repoName, workerName } = req.params as unknown as WorkerParams;
    const worker = stateManager.getWorker(repoName, workerName);
    if (!worker) {
      next(
        createApiError(
          404,
          `Worker "${workerName}" not found in "${repoName}"`,
        ),
      );
      return;
    }
    res.json(worker);
  });

  // DELETE /repositories/:repoName/workers/:workerName -- Terminate worker
  router.delete("/:workerName", async (req, res, next) => {
    const { repoName, workerName } = req.params as unknown as WorkerParams;
    try {
      await stateManager.removeWorker(repoName, workerName);
      res.status(204).end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found") || message.includes("not tracked")) {
        next(createApiError(404, message));
      } else {
        next(err);
      }
    }
  });

  // POST /repositories/:repoName/workers/:workerName/nudge -- Nudge worker
  router.post("/:workerName/nudge", async (req, res, next) => {
    const { repoName, workerName } = req.params as unknown as WorkerParams;
    const { hint, context } = req.body ?? {};
    if (!hint) {
      next(createApiError(400, "Missing required field: hint"));
      return;
    }

    const worker = stateManager.getWorker(repoName, workerName);
    if (!worker) {
      next(
        createApiError(
          404,
          `Worker "${workerName}" not found in "${repoName}"`,
        ),
      );
      return;
    }

    try {
      await broker.send({
        type: MessageType.NUDGE,
        from: "api",
        to: workerName,
        payload: { hint, context },
      });
      res.json({ ok: true, worker: workerName, hint });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
