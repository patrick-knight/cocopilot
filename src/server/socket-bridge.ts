/**
 * Socket Bridge — wires StateManager events to Socket.IO emissions.
 *
 * Listens for state change events from the StateManager and broadcasts
 * them to all connected Socket.IO clients on the default namespace.
 *
 * Also records activity events to the EventStore and emits `activity:new`
 * Socket.IO events for the Batch Log timeline.
 */

import type { Server as SocketIOServer } from "socket.io";
import type { StateManager } from "../state/index.js";
import type { EventStore } from "../state/index.js";
import type { WorkerState, WorkerStatus } from "../state/index.js";
import type { MessageBroker } from "../messaging/index.js";
import { MessageType, type CocoMessage } from "../messaging/index.js";

export interface SocketBridgeDeps {
  io: SocketIOServer;
  stateManager: StateManager;
  broker: MessageBroker;
  eventStore?: EventStore;
}

/**
 * Wire StateManager events to Socket.IO event emissions.
 * Returns a cleanup function to remove all listeners.
 */
export function createSocketBridge(
  io: SocketIOServer,
  stateManager: StateManager,
  broker: MessageBroker,
  eventStore?: EventStore,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners: Array<{ event: string; handler: (...args: any[]) => void }> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function addListener(event: string, handler: (...args: any[]) => void): void {
    stateManager.on(event, handler);
    listeners.push({ event, handler });
  }

  // Worker events
  addListener("workerAdded", (repoName: string, worker: WorkerState) => {
    io.emit("worker_spawned", { repository: repoName, worker });

    if (eventStore) {
      const event = eventStore.add({
        type: "worker_spawned",
        repository: repoName,
        description: `Worker ${worker.name} spawned for: ${worker.task}`,
        agent: worker.name,
        workerName: worker.name,
      });
      io.emit("activity:new", event);
    }
  });

  addListener("workerUpdated", (repoName: string, worker: WorkerState) => {
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

    if (eventStore) {
      if (worker.status === "completed") {
        const event = eventStore.add({
          type: "worker_completed",
          repository: repoName,
          description: `Worker ${worker.name} completed: ${worker.task}`,
          agent: worker.name,
          workerName: worker.name,
          prNumber: worker.prNumber,
        });
        io.emit("activity:new", event);
      } else if (worker.status === "failed") {
        const event = eventStore.add({
          type: "worker_failed",
          repository: repoName,
          description: `Worker ${worker.name} failed: ${worker.error ?? worker.task}`,
          agent: worker.name,
          workerName: worker.name,
        });
        io.emit("activity:new", event);
      }
    }
  });

  addListener("workerRemoved", (repoName: string, workerName: string) => {
    io.emit("worker_removed", { repository: repoName, worker: workerName });
  });

  // Repository events
  addListener("repoAdded", (repo: { name: string; id: string }) => {
    io.emit("repo_added", { repository: repo.name, id: repo.id });

    if (eventStore) {
      const event = eventStore.add({
        type: "repo_initialized",
        repository: repo.name,
        description: `Repository ${repo.name} initialized`,
      });
      io.emit("activity:new", event);
    }
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
      const mergedPayload = message.payload as { pr_number: number; repository?: string; worker?: string };
      io.emit("pr:status_changed", {
        number: mergedPayload.pr_number,
        stage: "merged",
        updatedAt: new Date().toISOString(),
      });

      if (eventStore) {
        const event = eventStore.add({
          type: "pr_merged",
          repository: mergedPayload.repository ?? "unknown",
          description: `PR #${mergedPayload.pr_number ?? "?"} merged`,
          agent: mergedPayload.worker,
          prNumber: mergedPayload.pr_number,
          workerName: mergedPayload.worker,
        });
        io.emit("activity:new", event);
      }
    } else if (message.type === MessageType.PR_CREATED) {
      const createdPayload = message.payload as { pr_number: number };
      io.emit("pr:status_changed", {
        number: createdPayload.pr_number,
        stage: "draft",
        updatedAt: new Date().toISOString(),
      });
    } else if (message.type === MessageType.CI_FAILED) {
      io.emit("ci_failed", message.payload);
      const failedPayload = message.payload as { pr_number: number; repository?: string; worker?: string };
      io.emit("pr:status_changed", {
        number: failedPayload.pr_number,
        stage: "ci_failed",
        updatedAt: new Date().toISOString(),
      });

      if (eventStore) {
        const event = eventStore.add({
          type: "ci_failed",
          repository: failedPayload.repository ?? "unknown",
          description: `CI failed on PR #${failedPayload.pr_number ?? "?"}`,
          agent: failedPayload.worker,
          prNumber: failedPayload.pr_number,
          workerName: failedPayload.worker,
        });
        io.emit("activity:new", event);
      }
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
