/**
 * Worker Detail API Routes
 *
 * Express.js route handlers for the Truffle Inspector page.
 * Provides endpoints for worker details, logs, messages,
 * and manual intervention controls (nudge, terminate, pause, resume).
 *
 * Mount at: /api/v1/repositories/:repoName/workers
 */

import type { StateManager } from "../../state/index.js";
import type { ContainerManager } from "../../docker/index.js";
import { ContainerStatus } from "../../docker/index.js";
import type { MessageBroker } from "../../messaging/index.js";
import { MessageType } from "../../messaging/index.js";

// ---------------------------------------------------------------------------
// Minimal Express-compatible interfaces
// ---------------------------------------------------------------------------

/**
 * Minimal interfaces for Express compatibility. Avoids a hard compile-time
 * dependency on the `express` package (installed when the web server is set up).
 */
interface RouteRequest {
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
}

interface RouteResponse {
  status(code: number): RouteResponse;
  json(data: unknown): void;
}

type RouteHandler = (req: RouteRequest, res: RouteResponse) => Promise<void>;

/** Express-compatible router interface. */
export interface ExpressRouter {
  get(path: string, handler: RouteHandler): void;
  post(path: string, handler: RouteHandler): void;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Dependencies injected into the worker routes. */
export interface WorkerRouteDeps {
  stateManager: StateManager;
  containerManager: ContainerManager;
  messageBroker: MessageBroker;
}

/** Detailed worker information returned by the detail endpoint. */
export interface WorkerDetail {
  id: string;
  name: string;
  task: string;
  branch: string;
  status: string;
  model?: string;
  containerId?: string;
  containerStatus?: string;
  prNumber?: number;
  prUrl?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  resources?: ContainerResources;
}

/** Container resource usage stats. */
export interface ContainerResources {
  memoryUsageMb: number;
  memoryLimitMb: number;
  cpuPercent: number;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Create Express router for worker detail endpoints.
 *
 * Routes:
 *   GET    /:workerName          - Get worker detail
 *   GET    /:workerName/logs     - Get container logs
 *   GET    /:workerName/messages - Get messages to/from worker
 *   POST   /:workerName/nudge   - Send nudge to worker
 *   POST   /:workerName/terminate - Terminate worker
 *   POST   /:workerName/pause   - Pause worker container
 *   POST   /:workerName/resume  - Resume worker container
 */
/**
 * Register worker detail routes on an Express-compatible router.
 *
 * @param router - An Express Router instance (created externally).
 * @param deps   - Injected dependencies (state, containers, messaging).
 */
export function registerWorkerRoutes(
  router: ExpressRouter,
  deps: WorkerRouteDeps,
): void {
  router.get("/:workerName", getWorkerDetail(deps));
  router.get("/:workerName/logs", getWorkerLogs(deps));
  router.get("/:workerName/messages", getWorkerMessages(deps));
  router.post("/:workerName/nudge", nudgeWorker(deps));
  router.post("/:workerName/terminate", terminateWorker(deps));
  router.post("/:workerName/pause", pauseWorker(deps));
  router.post("/:workerName/resume", resumeWorker(deps));
}

// ---------------------------------------------------------------------------
// GET /:workerName — Worker detail
// ---------------------------------------------------------------------------

function getWorkerDetail(deps: WorkerRouteDeps): RouteHandler {
  return async (req, res) => {
    const { repoName, workerName } = req.params;

    const worker = deps.stateManager.getWorker(repoName, workerName);
    if (!worker) {
      res.status(404).json({ error: `Worker "${workerName}" not found` });
      return;
    }

    const detail: WorkerDetail = {
      id: worker.id,
      name: worker.name,
      task: worker.task,
      branch: worker.branch,
      status: worker.status,
      model: worker.model,
      containerId: worker.containerId,
      prNumber: worker.prNumber,
      prUrl: worker.prUrl,
      createdAt: worker.createdAt,
      updatedAt: worker.updatedAt,
      completedAt: worker.completedAt,
      error: worker.error,
    };

    // Enrich with live container status and resource usage
    if (worker.containerId) {
      try {
        const info = await deps.containerManager.inspect(worker.containerId);
        detail.containerStatus = info.status;

        // Fetch resource stats if container is running
        if (info.status === ContainerStatus.RUNNING) {
          const stats = await deps.containerManager.stats(worker.containerId);
          detail.resources = {
            memoryUsageMb: stats.memoryUsage / (1024 * 1024),
            memoryLimitMb: stats.memoryLimit / (1024 * 1024),
            cpuPercent: stats.cpuPercent,
          };
        }
      } catch {
        detail.containerStatus = ContainerStatus.UNKNOWN;
      }
    }

    res.json(detail);
  };
}

// ---------------------------------------------------------------------------
// GET /:workerName/logs — Container logs
// ---------------------------------------------------------------------------

function getWorkerLogs(deps: WorkerRouteDeps): RouteHandler {
  return async (req, res) => {
    const { repoName, workerName } = req.params;

    const worker = deps.stateManager.getWorker(repoName, workerName);
    if (!worker) {
      res.status(404).json({ error: `Worker "${workerName}" not found` });
      return;
    }

    if (!worker.containerId) {
      res.status(404).json({ error: "Worker has no container" });
      return;
    }

    const tail = parseInt(req.query.tail as string) || 200;
    const since = req.query.since
      ? parseInt(req.query.since as string)
      : undefined;

    try {
      const logs = await deps.containerManager.logs(worker.containerId, {
        tail,
        since,
        timestamps: true,
      });
      res.json({ logs, containerId: worker.containerId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to retrieve logs: ${msg}` });
    }
  };
}

// ---------------------------------------------------------------------------
// GET /:workerName/messages — Messages to/from worker
// ---------------------------------------------------------------------------

function getWorkerMessages(deps: WorkerRouteDeps): RouteHandler {
  return async (req, res) => {
    const { workerName } = req.params;

    try {
      const messages = await deps.messageBroker.getHistory(workerName);
      res.json({ messages });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to retrieve messages: ${msg}` });
    }
  };
}

// ---------------------------------------------------------------------------
// POST /:workerName/nudge — Send nudge
// ---------------------------------------------------------------------------

function nudgeWorker(deps: WorkerRouteDeps): RouteHandler {
  return async (req, res) => {
    const { repoName, workerName } = req.params;

    const worker = deps.stateManager.getWorker(repoName, workerName);
    if (!worker) {
      res.status(404).json({ error: `Worker "${workerName}" not found` });
      return;
    }

    const { message } = req.body as { message?: string };
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Request body must include a 'message' string" });
      return;
    }

    try {
      await deps.messageBroker.send({
        type: MessageType.NUDGE,
        from: "dashboard",
        to: workerName,
        payload: { hint: message },
        priority: "high",
      });
      res.json({ nudged: true, worker: workerName });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to send nudge: ${msg}` });
    }
  };
}

// ---------------------------------------------------------------------------
// POST /:workerName/terminate — Terminate worker
// ---------------------------------------------------------------------------

function terminateWorker(deps: WorkerRouteDeps): RouteHandler {
  return async (req, res) => {
    const { repoName, workerName } = req.params;

    const worker = deps.stateManager.getWorker(repoName, workerName);
    if (!worker) {
      res.status(404).json({ error: `Worker "${workerName}" not found` });
      return;
    }

    // Stop and remove container if it exists
    if (worker.containerId) {
      try {
        await deps.containerManager.destroy(worker.containerId);
      } catch {
        // Container may already be stopped/removed
      }
    }

    // Update worker state
    try {
      await deps.stateManager.updateWorkerStatus(
        repoName,
        workerName,
        "terminated",
      );
    } catch {
      // Worker state may already be updated
    }

    res.json({ terminated: true, worker: workerName });
  };
}

// ---------------------------------------------------------------------------
// POST /:workerName/pause — Pause worker container
// ---------------------------------------------------------------------------

function pauseWorker(deps: WorkerRouteDeps): RouteHandler {
  return async (req, res) => {
    const { repoName, workerName } = req.params;

    const worker = deps.stateManager.getWorker(repoName, workerName);
    if (!worker) {
      res.status(404).json({ error: `Worker "${workerName}" not found` });
      return;
    }

    if (!worker.containerId) {
      res.status(400).json({ error: "Worker has no container to pause" });
      return;
    }

    try {
      await deps.containerManager.stop(worker.containerId);
      res.json({ paused: true, worker: workerName });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to pause worker: ${msg}` });
    }
  };
}

// ---------------------------------------------------------------------------
// POST /:workerName/resume — Resume worker container
// ---------------------------------------------------------------------------

function resumeWorker(deps: WorkerRouteDeps): RouteHandler {
  return async (req, res) => {
    const { repoName, workerName } = req.params;

    const worker = deps.stateManager.getWorker(repoName, workerName);
    if (!worker) {
      res.status(404).json({ error: `Worker "${workerName}" not found` });
      return;
    }

    if (!worker.containerId) {
      res.status(400).json({ error: "Worker has no container to resume" });
      return;
    }

    // Note: Docker "unpause" is what we need here, but the ContainerManager
    // doesn't expose it directly. For now we use the docker API.
    // In a real implementation the ContainerManager would have a resume method.
    res.status(501).json({
      error: "Resume is not yet implemented. Use the Docker CLI to unpause the container.",
      containerId: worker.containerId,
    });
  };
}
