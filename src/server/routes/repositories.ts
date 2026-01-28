/**
 * Repository CRUD routes.
 *
 * POST   /api/v1/repositories            -- Initialize repo tracking
 * GET    /api/v1/repositories             -- List all repos
 * GET    /api/v1/repositories/:repoName   -- Get repo detail
 * DELETE /api/v1/repositories/:repoName   -- Remove repo
 */

import { Router } from "express";
import type { StateManager } from "../../state/index.js";
import { createApiError } from "../middleware/error-handler.js";

export function repositoryRoutes(stateManager: StateManager): Router {
  const router = Router();

  // POST /repositories -- Initialize repo tracking
  router.post("/", async (req, res, next) => {
    const { name, url, localPath, mode, defaultBranch } = req.body ?? {};
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

  return router;
}
