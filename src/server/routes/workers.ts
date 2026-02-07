/**
 * Worker management routes (nested under a repository).
 *
 * POST   /api/v1/repositories/:repoName/workers              -- Spawn worker
 * GET    /api/v1/repositories/:repoName/workers              -- List workers
 * GET    /api/v1/repositories/:repoName/workers/:workerName  -- Get worker
 * GET    /api/v1/repositories/:repoName/workers/:workerName/messages -- Get messages
 * DELETE /api/v1/repositories/:repoName/workers/:workerName  -- Terminate worker
 * POST   /api/v1/repositories/:repoName/workers/:workerName/nudge -- Nudge worker
 */

import { Router } from "express";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { promisify } from "node:util";
import type { StateManager } from "../../state/index.js";
import type { MessageBroker } from "../../messaging/index.js";
import { MessageType } from "../../messaging/index.js";
import { getWorktreePath } from "../../git/worktree.js";
import { chocolatierAgentName } from "../../agents/chocolatier.js";
import { scopedWorkerName } from "../../agents/scoped-name.js";
import { createApiError } from "../middleware/error-handler.js";
import { resolveTemplate } from "../../api/v1/templates.js";
import type { TaskTemplate } from "../../state/schemas.js";
import { loadRepoConfig } from "../../utils/index.js";

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
  const execFileAsync = promisify(execFile);

  // POST /repositories/:repoName/workers -- Spawn worker
  // Sends SPAWN_WORKER message to Chocolatier which actually spawns the container
  router.post("/", async (req, res, next) => {
    const { repoName } = req.params as unknown as RepoParams;
    const body = req.body ?? {};
    let { task } = body;
    const { branch, name, model, pushTo, templateId } = body;

    // Verify repository exists
    const repo = stateManager.getRepo(repoName);
    if (!repo) {
      next(createApiError(404, `Repository "${repoName}" not tracked`));
      return;
    }

    // Get repo-specific templates if resolving from templateId
    let repoTemplates: TaskTemplate[] | undefined;
    if (templateId) {
      const repoConfig = loadRepoConfig(repo.localPath);
      repoTemplates = repoConfig.templates;
    }

    // Resolve task from template if templateId is provided
    if (templateId && !task) {
      const template = resolveTemplate(templateId, repoTemplates);
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

    // Don't pass branch if it's the default branch (let worker auto-generate work/<name>)
    // The `branch` field from the UI typically means "base branch to start from"
    // but the worker needs its own unique branch, not the main branch
    const workerBranch = branch === repo.defaultBranch ? undefined : branch;

    try {
      // Send SPAWN_WORKER message to Chocolatier
      // Include repoName so the correct Chocolatier handles it
      await broker.send({
        type: MessageType.SPAWN_WORKER,
        from: "api",
        to: chocolatierAgentName(repoName),
        payload: {
          task,
          repoName,
          branch: workerBranch,
          name,
          model,
          pushTo,
        },
      });

      // Return accepted response - actual worker will be created by Chocolatier
      // Client should poll /workers endpoint or listen to socket for updates
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

  // GET /repositories/:repoName/workers/:workerName/git-log -- Git log
  router.get("/:workerName/git-log", async (req, res, next) => {
    const { repoName, workerName } = req.params as unknown as WorkerParams;
    const worker = stateManager.getWorker(repoName, workerName);
    if (!worker) {
      next(createApiError(404, `Worker "${workerName}" not found in "${repoName}"`));
      return;
    }

    const worktreePath = getWorktreePath(repoName, workerName);
    if (!fs.existsSync(worktreePath)) {
      // Return empty commits if worktree doesn't exist yet
      res.json({ commits: [], message: "Worktree not yet created" });
      return;
    }

    try {
      const format = "%H|%h|%an|%ad|%s";
      const { stdout } = await execFileAsync(
        "git",
        ["-C", worktreePath, "log", "-n", "50", `--pretty=${format}`, "--date=iso"],
      );

      const commits = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [hash, shortHash, author, date, message] = line.split("|");
          return { hash, shortHash, author, date, message };
        });

      res.json({ commits });
    } catch (err) {
      // Return empty on git errors (e.g., no commits yet)
      res.json({ commits: [], message: "No commits available" });
    }
  });

  // GET /repositories/:repoName/workers/:workerName/messages -- Get message history
  router.get("/:workerName/messages", async (req, res, next) => {
    const { repoName, workerName } = req.params as unknown as WorkerParams;

    try {
      const messages = await broker.getHistory(scopedWorkerName(workerName, repoName));
      res.json({ messages });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      next(createApiError(500, `Failed to retrieve messages: ${message}`));
    }
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
        to: scopedWorkerName(workerName, repoName),
        payload: { hint, context },
      });
      res.json({ ok: true, worker: workerName, hint });
    } catch (err) {
      next(err);
    }
  });

  // POST /repositories/:repoName/workers/:workerName/restart -- Restart worker
  router.post("/:workerName/restart", async (req, res, next) => {
    const { repoName, workerName } = req.params as unknown as WorkerParams;

    const worker = stateManager.getWorker(repoName, workerName);
    if (!worker) {
      next(createApiError(404, `Worker "${workerName}" not found in "${repoName}"`));
      return;
    }

    try {
      // Send SPAWN_WORKER message to Chocolatier with same task
      await broker.send({
        type: MessageType.SPAWN_WORKER,
        from: "api",
        to: chocolatierAgentName(repoName),
        payload: {
          task: worker.task,
          repoName,
          branch: worker.branch,
          name: workerName, // Reuse the same name
          model: worker.model,
        },
      });

      // Update worker status to indicate restart requested
      await stateManager.updateWorkerStatus(repoName, workerName, "starting", undefined);

      res.json({
        status: "accepted",
        message: `Restart request sent for worker "${workerName}"`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      next(createApiError(500, `Failed to restart worker: ${message}`));
    }
  });

  return router;
}
