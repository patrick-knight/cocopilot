/**
 * Socket Bridge — wires StateManager events to Socket.IO emissions.
 *
 * Listens for state change events from the StateManager and broadcasts
 * them to all connected Socket.IO clients on the default namespace.
 *
 * Also records activity events to the EventStore and emits `activity:new`
 * Socket.IO events for the Batch Log timeline.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { StateManager } from "../state/index.js";
import type { EventStore } from "../state/index.js";
import type { WorkerState, WorkerStatus } from "../state/index.js";
import type { MessageBroker } from "../messaging/index.js";
import type { RedisMessageBus } from "../messaging/index.js";
import { MessageType, type CocoMessage } from "../messaging/index.js";
import { streamChannel } from "../messaging/types.js";

export interface SocketBridgeDeps {
  io: SocketIOServer;
  stateManager: StateManager;
  broker: MessageBroker;
  redisBus?: RedisMessageBus;
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
  redisBus?: RedisMessageBus,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners: Array<{ event: string; handler: (...args: any[]) => void }> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function addListener(event: string, handler: (...args: any[]) => void): void {
    stateManager.on(event, handler);
    listeners.push({ event, handler });
  }

  // Socket client handlers
  io.on("connection", (socket) => {
    socket.on("repo:subscribe", (repoName: string) => {
      const repo = stateManager.getRepo(repoName);
      if (!repo) {
        socket.emit("repo:error", {
          repoName,
          message: `Repository "${repoName}" not found`,
        });
        return;
      }
      socket.join(`repo:${repoName}`);
      socket.emit("repo:state", repo);
    });

    socket.on("repo:unsubscribe", (repoName: string) => {
      socket.leave(`repo:${repoName}`);
    });

    socket.on("worker:spawn", async (payload: { repoName?: string; repoId?: string; task: string; branch?: string; model?: string; name?: string }, callback?: (result: { success: boolean; error?: string; workerName?: string }) => void) => {
      try {
        const repoName = payload.repoName ?? payload.repoId;
        if (!repoName) {
          throw new Error("Missing repo name");
        }
        const worker = await stateManager.addWorker(repoName, {
          task: payload.task,
          branch: payload.branch,
          model: payload.model,
          name: payload.name,
        });
        callback?.({ success: true, workerName: worker.name });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        callback?.({ success: false, error: message });
      }
    });

    socket.on("worker:stop", async (workerName: string) => {
      const repos = stateManager.getRepos();
      for (const [repoName, repo] of Object.entries(repos)) {
        if (repo.workers[workerName]) {
          await stateManager.removeWorker(repoName, workerName).catch(() => {});
          break;
        }
      }
    });

    // Agent output streaming via Redis
    if (redisBus) {
      setupAgentStreamHandlers(socket, redisBus);
    }
  });

  // Worker events
  addListener("workerAdded", (repoName: string, worker: WorkerState) => {
    // Emit globally for activity feed
    io.emit("worker_spawned", { repository: repoName, worker });
    
    // Emit to repo room for real-time active workers update
    io.to(`repo:${repoName}`).emit("worker:update", worker);

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
    // Emit globally for activity feed
    io.emit("worker_updated", { repository: repoName, worker });
    
    // Emit to repo room for real-time active workers update
    io.to(`repo:${repoName}`).emit("worker:update", worker);

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
    // Emit globally for activity feed
    io.emit("worker_removed", { repository: repoName, worker: workerName });
    
    // Emit to repo room for real-time active workers update
    io.to(`repo:${repoName}`).emit("worker:removed", workerName);
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
 * Set up agent streaming handlers on a socket so the frontend can
 * subscribe to live output from any agent via the default namespace.
 *
 * Listens for both event name patterns:
 *   - agent:join / agent:leave (legacy)
 *   - agent:stream:subscribe / agent:stream:unsubscribe (current)
 *   - worker:join / worker:leave (used by LiveOutput component)
 *
 * When a client subscribes, we subscribe to the Redis stream channel
 * for that agent and forward every message as `agent:output`.
 * On unsubscribe (or disconnect), we unsubscribe from Redis.
 */
function setupAgentStreamHandlers(socket: Socket, redisBus: RedisMessageBus): void {
  // Track current subscription so we can clean up on leave/disconnect
  let currentAgent: string | null = null;
  let currentHandler: ((message: unknown) => void) | null = null;

  const leave = (): void => {
    if (currentAgent && currentHandler) {
      const channel = streamChannel(currentAgent);
      redisBus.unsubscribeChannel(channel).catch(() => {});
    }
    currentAgent = null;
    currentHandler = null;
  };

  const join = (agentName: string): void => {
    if (typeof agentName !== "string" || !agentName) return;
    
    // Leave previous agent if any
    leave();

    currentAgent = agentName;
    const channel = streamChannel(agentName);

    currentHandler = (message: unknown): void => {
      // Parse the message and emit as AgentOutputLine format
      try {
        const parsed = typeof message === "string" ? JSON.parse(message) : message;
        const outputLine = {
          agent: agentName,
          timestamp: parsed.timestamp ?? Date.now(),
          text: parsed.content ?? (typeof message === "string" ? message : JSON.stringify(message)),
          stream: parsed.type === "error" ? "stderr" : "stdout",
        };
        socket.emit("agent:output", outputLine);
        // Also emit as worker:output for LiveOutput component compatibility
        socket.emit("worker:output", {
          workerName: agentName,
          type: parsed.type === "error" ? "error" : "output",
          content: outputLine.text,
          timestamp: outputLine.timestamp,
        });
      } catch {
        // Fallback for non-JSON messages
        const text = String(message);
        socket.emit("agent:output", {
          agent: agentName,
          timestamp: Date.now(),
          text,
          stream: "stdout",
        });
        socket.emit("worker:output", {
          workerName: agentName,
          type: "output",
          content: text,
          timestamp: Date.now(),
        });
      }
    };

    redisBus.subscribeChannel(channel, currentHandler as never).catch(() => {
      // Redis may not be ready — non-fatal
    });
  };

  // Listen for all event patterns (agent:* for agents, worker:* for LiveOutput)
  socket.on("agent:join", join);
  socket.on("agent:stream:subscribe", join);
  socket.on("worker:join", join);

  socket.on("agent:leave", () => {
    leave();
  });
  socket.on("agent:stream:unsubscribe", () => {
    leave();
  });
  socket.on("worker:leave", () => {
    leave();
  });

  socket.on("disconnect", () => {
    leave();
  });
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
