/**
 * Notification configuration routes.
 *
 * GET  /api/v1/repositories/:repoName/notifications  -- Get notification config
 * PUT  /api/v1/repositories/:repoName/notifications  -- Update notification config
 */

import { Router } from "express";
import type { StateManager } from "../../state/index.js";
import { createApiError } from "../middleware/error-handler.js";
import { DEFAULT_NOTIFICATION_CONFIG } from "../../github/index.js";
import { loadRepoConfig, saveRepoConfig } from "../../utils/index.js";

interface RepoParams {
  repoName: string;
  [key: string]: string;
}

export function notificationRoutes(stateManager: StateManager): Router {
  const router = Router({ mergeParams: true });

  // GET / — Get notification config for a repository
  router.get("/", (req, res, next) => {
    const { repoName } = req.params as unknown as RepoParams;
    const repo = stateManager.getRepo(repoName);

    if (!repo) {
      next(createApiError(404, `Repository "${repoName}" not found`));
      return;
    }

    const repoConfig = loadRepoConfig(repo.localPath);
    const notifications = repoConfig.notifications ?? DEFAULT_NOTIFICATION_CONFIG;

    res.json({ notifications });
  });

  // PUT / — Update notification config for a repository
  router.put("/", (req, res, next) => {
    const { repoName } = req.params as unknown as RepoParams;
    const repo = stateManager.getRepo(repoName);

    if (!repo) {
      next(createApiError(404, `Repository "${repoName}" not found`));
      return;
    }

    const body = req.body;
    if (!body || typeof body !== "object") {
      next(createApiError(400, "Request body must be a JSON object"));
      return;
    }

    // Validate fields
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      next(createApiError(400, '"enabled" must be a boolean'));
      return;
    }
    if (body.events !== undefined) {
      if (!Array.isArray(body.events) || !body.events.every((e: unknown) => typeof e === "string")) {
        next(createApiError(400, '"events" must be an array of strings'));
        return;
      }
    }
    if (body.labels !== undefined) {
      if (!Array.isArray(body.labels) || !body.labels.every((l: unknown) => typeof l === "string")) {
        next(createApiError(400, '"labels" must be an array of strings'));
        return;
      }
    }

    try {
      const existing = loadRepoConfig(repo.localPath);
      const currentNotifications = existing.notifications ?? DEFAULT_NOTIFICATION_CONFIG;
      const updated = {
        enabled: body.enabled ?? currentNotifications.enabled,
        events: body.events ?? currentNotifications.events,
        labels: body.labels ?? currentNotifications.labels,
      };

      existing.notifications = updated;
      saveRepoConfig(repo.localPath, existing);

      res.json({ notifications: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      next(createApiError(500, `Failed to update notification config: ${message}`));
    }
  });

  return router;
}
