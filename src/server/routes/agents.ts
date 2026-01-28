/**
 * Agent listing and messaging routes (nested under a repository).
 *
 * GET  /api/v1/repositories/:repoName/agents                    -- List agents
 * POST /api/v1/repositories/:repoName/agents/:agentName/message -- Message agent
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

interface AgentParams extends RepoParams {
  agentName: string;
}

export function agentRoutes(
  stateManager: StateManager,
  broker: MessageBroker,
): Router {
  const router = Router({ mergeParams: true });

  // GET /repositories/:repoName/agents -- List agents
  router.get("/", (req, res, next) => {
    const { repoName } = req.params as unknown as RepoParams;
    const repo = stateManager.getRepo(repoName);
    if (!repo) {
      next(createApiError(404, `Repository "${repoName}" not found`));
      return;
    }
    res.json(Object.values(repo.agents));
  });

  // POST /repositories/:repoName/agents/:agentName/message -- Message agent
  router.post("/:agentName/message", async (req, res, next) => {
    const { repoName, agentName } = req.params as unknown as AgentParams;
    const { type, payload, from, priority } = req.body ?? {};

    const repo = stateManager.getRepo(repoName);
    if (!repo) {
      next(createApiError(404, `Repository "${repoName}" not found`));
      return;
    }

    if (!repo.agents[agentName]) {
      next(createApiError(404, `Agent "${agentName}" not found in "${repoName}"`));
      return;
    }

    if (!type || !payload) {
      next(createApiError(400, "Missing required fields: type, payload"));
      return;
    }

    try {
      const message = await broker.send({
        type: type as MessageType,
        from: from ?? "api",
        to: agentName,
        payload,
        priority,
      });
      res.status(201).json(message);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
