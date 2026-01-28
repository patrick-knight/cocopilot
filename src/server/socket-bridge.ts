/**
 * Socket Bridge — wires StateManager events to Socket.IO emissions.
 *
 * Listens for state change events from the StateManager and broadcasts
 * them to all connected Socket.IO clients on the default namespace.
 */

import type { Server as SocketIOServer } from "socket.io";
import type { StateManager } from "../state/index.js";
import type { WorkerState, WorkerStatus } from "../state/index.js";
import type { MessageBroker } from "../messaging/index.js";
import { MessageType, type CocoMessage } from "../messaging/index.js";

/**
 * Wire StateManager events to Socket.IO event emissions.
 * Returns a cleanup function to remove all listeners.
 */
export function createSocketBridge(
  io: SocketIOServer,
  stateManager: StateManager,
  broker: MessageBroker,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners: Array<{ event: string; handler: (...args: any[]) => void }> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function addListener(event: string, handler: (...args: any[]) => void): void {
    stateManager.on(event, handler);
    listeners.push({ event, handler });
  }

  // Worker events
  addListener("workerAdded", (repoName: string, worker: unknown) => {
    io.emit("worker_spawned", { repository: repoName, worker });
  });

  addListener("workerUpdated", (repoName: string, worker: unknown) => {
    io.emit("worker_updated", { repository: repoName, worker });

    // Emit PR pipeline update when a worker with a PR changes status
    const w = worker as WorkerState;
    if (w.prNumber != null) {
      io.emit("pr:status_changed", {
        number: w.prNumber,
        stage: workerStatusToPRStage(w.status),
        updatedAt: w.updatedAt,
      });
    }
  });

  addListener("workerRemoved", (repoName: string, workerName: string) => {
    io.emit("worker_removed", { repository: repoName, worker: workerName });
  });

  // Repository events
  addListener("repoAdded", (repo: { name: string; id: string }) => {
    io.emit("repo_added", { repository: repo.name, id: repo.id });
  });

  addListener("repoRemoved", (repoName: string) => {
    io.emit("repo_removed", { repository: repoName });
  });

  // Agent events
  addListener("agentUpdated", (repoName: string, agent: unknown) => {
    io.emit("agent_updated", { repository: repoName, agent });
  });

  // Full state change
  addListener("stateChanged", (state: unknown) => {
    io.emit("state_changed", { state });
  });

  // Subscribe to broker broadcast channel for PR_MERGED, PR_CREATED, and CI_FAILED
  const broadcastHandler = (message: CocoMessage): void => {
    if (message.type === MessageType.PR_MERGED) {
      io.emit("pr_merged", message.payload);
      // Also emit pipeline stage change
      const payload = message.payload as { pr_number: number };
      io.emit("pr:status_changed", {
        number: payload.pr_number,
        stage: "merged",
        updatedAt: new Date().toISOString(),
      });
    } else if (message.type === MessageType.PR_CREATED) {
      const payload = message.payload as { pr_number: number };
      io.emit("pr:status_changed", {
        number: payload.pr_number,
        stage: "draft",
        updatedAt: new Date().toISOString(),
      });
    } else if (message.type === MessageType.CI_FAILED) {
      io.emit("ci_failed", message.payload);
      const payload = message.payload as { pr_number: number };
      io.emit("pr:status_changed", {
        number: payload.pr_number,
        stage: "ci_failed",
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const brokerAgentName = "__socket_bridge__";
  broker.subscribe(brokerAgentName, broadcastHandler).catch(() => {
    // Broker may not be connected yet; non-fatal
  });

  // Return cleanup function
  return () => {
    for (const { event, handler } of listeners) {
      stateManager.removeListener(event, handler);
    }
    listeners.length = 0;
    broker.unsubscribe(brokerAgentName).catch(() => {});
  };
}

/**
 * Map worker status to a PR pipeline stage for real-time updates.
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
