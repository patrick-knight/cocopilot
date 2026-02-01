/**
 * Worker Stream — Socket.IO <-> Redis Bridge
 *
 * Bridges Redis pub/sub stream channels to Socket.IO rooms so the
 * Truffle Inspector page can receive real-time output from a worker.
 *
 * Redis channels used:
 *   cocopilot:stream:{agentName}  — streaming output from an agent
 *   cocopilot:completions         — task completion notifications
 *
 * Socket.IO events emitted to clients:
 *   worker:output     — new output line from a worker
 *   worker:status     — worker status change
 *   worker:completed  — worker task completed
 *   worker:failed     — worker task failed
 *
 * Batched variants (via MessageBatcher):
 *   batch:worker:output     — array of output events
 *   batch:worker:status     — array of status events
 *   batch:worker:completed  — array of completion events
 *
 * Room-based subscriptions:
 *   worker:{name}  — per-worker output rooms (existing)
 *   repo:{id}      — per-repository event rooms (new)
 */

// Max length for room/channel names to prevent DoS
const MAX_NAME_LENGTH = 128;
// Allowed characters for room/channel names (alphanumeric, dash, underscore)
const VALID_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Minimal Socket.IO interfaces to avoid hard dependency on socket.io types.
 * The actual socket.io package will be installed when the web layer is set up.
 */
interface SocketIOSocket {
  join(room: string): Promise<void>;
  leave(room: string): Promise<void>;
  on(event: string, handler: (...args: any[]) => void): void;
}

interface SocketIORoom {
  emit(event: string, data: unknown): void;
  fetchSockets(): Promise<unknown[]>;
}

interface SocketIOServer {
  on(event: string, handler: (...args: any[]) => void): void;
  to(room: string): SocketIORoom;
  in(room: string): SocketIORoom;
  emit(event: string, data: unknown): void;
}

interface RedisSubscriber {
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  on(event: string, handler: (...args: any[]) => void): void;
}

import {
  STREAM_CHANNEL_PREFIX,
  COMPLETIONS_CHANNEL,
  streamChannel,
} from "../../messaging/index.js";
import type { StateManager } from "../../state/index.js";
import { MessageBatcher } from "./batching.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the worker stream bridge. */
export interface WorkerStreamConfig {
  /** Socket.IO server instance. */
  io: SocketIOServer;
  /** Redis subscriber instance (must be dedicated for subscriptions). */
  redisSub: RedisSubscriber;
  /** StateManager for worker state change events. */
  stateManager: StateManager;
  /** Batching window in milliseconds. Defaults to 100. */
  batchWindowMs?: number;
}

/** Output event sent to Socket.IO clients. */
export interface WorkerOutputEvent {
  workerName: string;
  type: "output" | "tool_call" | "tool_result" | "error";
  content: string;
  timestamp: number;
}

/** Status change event sent to Socket.IO clients. */
export interface WorkerStatusEvent {
  workerName: string;
  status: string;
  timestamp: number;
  error?: string;
}

/** Completion event sent to Socket.IO clients. */
export interface WorkerCompletionEvent {
  workerName: string;
  summary: string;
  prUrl?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Worker Stream Manager
// ---------------------------------------------------------------------------

/**
 * Manages Socket.IO rooms for individual workers, subscribing to their
 * Redis stream channels when clients join and cleaning up when they leave.
 *
 * Integrates with {@link MessageBatcher} to aggregate high-frequency events
 * (e.g. worker output) over configurable time windows and emit batched
 * arrays, reducing per-frame overhead.
 *
 * Supports room-based selective subscriptions:
 * - `worker:{name}` — receive output for a specific worker
 * - `repo:{id}`     — receive events for all workers in a repository
 *
 * Usage:
 * ```ts
 * const wsm = new WorkerStreamManager(config);
 * await wsm.start();
 * // ... later
 * await wsm.stop();
 * ```
 */
export class WorkerStreamManager {
  private readonly io: SocketIOServer;
  private readonly redisSub: RedisSubscriber;
  private readonly stateManager: StateManager;
  private readonly batcher: MessageBatcher;

  /** Set of worker names with active Redis subscriptions. */
  private subscribedWorkers = new Set<string>();
  private started = false;

  constructor(config: WorkerStreamConfig) {
    this.io = config.io;
    this.redisSub = config.redisSub;
    this.stateManager = config.stateManager;

    this.batcher = new MessageBatcher({
      windowMs: config.batchWindowMs ?? 100,
      roomResolver: (room: string) => this.io.to(room),
      broadcastEmitter: { emit: (event, data) => this.io.emit(event, data) },
    });
  }

  /**
   * Start listening for Socket.IO connections and bridging streams.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Start the batcher
    this.batcher.start();

    // Subscribe to completions channel (always active)
    await this.redisSub.subscribe(COMPLETIONS_CHANNEL);

    // Handle incoming Redis messages
    this.redisSub.on("message", (channel: string, message: string) => {
      this.handleRedisMessage(channel, message);
    });

    // Listen for state changes from StateManager
    this.stateManager.on(
      "workerUpdated",
      (repoName: string, worker: { name: string; status: string; error?: string }) => {
        const event: WorkerStatusEvent = {
          workerName: worker.name,
          status: worker.status,
          timestamp: Date.now(),
          error: worker.error,
        };

        // Emit unbatched for immediate status visibility
        this.io.to(`worker:${worker.name}`).emit("worker:status", event);

        // Also batch to repo room for dashboard consumers
        this.batcher.enqueue({
          event: "worker:status",
          data: event,
          room: `repo:${repoName}`,
          dedupeKey: `worker-status:${worker.name}`,
        });
      },
    );

    // Handle Socket.IO namespace for worker streams
    this.io.on("connection", (socket: SocketIOSocket) => {
      this.handleConnection(socket);
    });
  }

  /**
   * Stop all Redis subscriptions and clean up.
   */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    // Stop the batcher (flushes remaining events)
    this.batcher.stop();

    // Unsubscribe from all worker channels
    const channels = [
      COMPLETIONS_CHANNEL,
      ...Array.from(this.subscribedWorkers).map(streamChannel),
    ];
    if (channels.length > 0) {
      await this.redisSub.unsubscribe(...channels);
    }
    this.subscribedWorkers.clear();
  }

  // -----------------------------------------------------------------------
  // Socket.IO connection handling
  // -----------------------------------------------------------------------

  private handleConnection(socket: SocketIOSocket): void {
    // Client joins a worker room to receive its output stream
    socket.on("worker:join", async (workerName: string) => {
      // SECURITY: Validate input to prevent arbitrary room injection
      if (typeof workerName !== "string" || 
          workerName.length === 0 || 
          workerName.length > MAX_NAME_LENGTH ||
          !VALID_NAME_PATTERN.test(workerName)) {
        return;
      }

      const room = `worker:${workerName}`;
      await socket.join(room);

      // Subscribe to Redis channel if not already subscribed
      if (!this.subscribedWorkers.has(workerName)) {
        await this.subscribeToWorker(workerName);
      }
    });

    // Client leaves a worker room
    socket.on("worker:leave", async (workerName: string) => {
      // SECURITY: Validate input
      if (typeof workerName !== "string" || 
          workerName.length === 0 || 
          workerName.length > MAX_NAME_LENGTH ||
          !VALID_NAME_PATTERN.test(workerName)) {
        return;
      }

      const room = `worker:${workerName}`;
      await socket.leave(room);

      // Unsubscribe from Redis if no clients remain in the room
      const roomSockets = await this.io.in(room).fetchSockets();
      if (roomSockets.length === 0) {
        await this.unsubscribeFromWorker(workerName);
      }
    });

    // Client joins a repo room (selective subscription)
    socket.on("repo:join", async (repoId: string) => {
      // SECURITY: Validate input
      if (typeof repoId !== "string" || 
          repoId.length === 0 || 
          repoId.length > MAX_NAME_LENGTH ||
          !VALID_NAME_PATTERN.test(repoId)) {
        return;
      }
      await socket.join(`repo:${repoId}`);
    });

    // Client leaves a repo room
    socket.on("repo:leave", async (repoId: string) => {
      // SECURITY: Validate input
      if (typeof repoId !== "string" || 
          repoId.length === 0 || 
          repoId.length > MAX_NAME_LENGTH ||
          !VALID_NAME_PATTERN.test(repoId)) {
        return;
      }
      await socket.leave(`repo:${repoId}`);
    });

    // Clean up on disconnect
    socket.on("disconnect", async () => {
      // Check all subscribed workers and unsubscribe if empty
      for (const workerName of this.subscribedWorkers) {
        const room = `worker:${workerName}`;
        const roomSockets = await this.io.in(room).fetchSockets();
        if (roomSockets.length === 0) {
          await this.unsubscribeFromWorker(workerName);
        }
      }
    });
  }

  // -----------------------------------------------------------------------
  // Redis subscription management
  // -----------------------------------------------------------------------

  private async subscribeToWorker(workerName: string): Promise<void> {
    const channel = streamChannel(workerName);
    await this.redisSub.subscribe(channel);
    this.subscribedWorkers.add(workerName);
  }

  private async unsubscribeFromWorker(workerName: string): Promise<void> {
    const channel = streamChannel(workerName);
    await this.redisSub.unsubscribe(channel);
    this.subscribedWorkers.delete(workerName);
  }

  // -----------------------------------------------------------------------
  // Redis message handling
  // -----------------------------------------------------------------------

  private handleRedisMessage(channel: string, message: string): void {
    if (channel === COMPLETIONS_CHANNEL) {
      this.handleCompletionMessage(message);
      return;
    }

    // Worker stream channel: cocopilot:stream:{workerName}
    if (channel.startsWith(STREAM_CHANNEL_PREFIX + ":")) {
      const workerName = channel.slice(STREAM_CHANNEL_PREFIX.length + 1);
      this.handleStreamMessage(workerName, message);
    }
  }

  private handleStreamMessage(workerName: string, raw: string): void {
    try {
      const parsed = JSON.parse(raw) as {
        type?: string;
        content?: string;
        eventType?: string;
      };

      // Handle activity events specially
      if (parsed.type === "activity" || parsed.eventType) {
        const activityData = parsed.content ? JSON.parse(parsed.content) : parsed;
        this.batcher.enqueue({
          event: "worker:activity",
          data: {
            workerName,
            ...activityData,
            timestamp: Date.now(),
          },
          room: `worker:${workerName}`,
          dedupeKey: `activity:${workerName}:${parsed.eventType ?? "unknown"}`,
        });
        return;
      }

      const event: WorkerOutputEvent = {
        workerName,
        type: (parsed.type as WorkerOutputEvent["type"]) ?? "output",
        content: parsed.content ?? raw,
        timestamp: Date.now(),
      };

      // Batch high-frequency output events
      this.batcher.enqueue({
        event: "worker:output",
        data: event,
        room: `worker:${workerName}`,
        // No dedupeKey — each output line is unique
      });
    } catch {
      // Non-JSON message — emit as raw output
      const event: WorkerOutputEvent = {
        workerName,
        type: "output",
        content: raw,
        timestamp: Date.now(),
      };
      this.batcher.enqueue({
        event: "worker:output",
        data: event,
        room: `worker:${workerName}`,
      });
    }
  }

  private handleCompletionMessage(raw: string): void {
    try {
      const parsed = JSON.parse(raw) as {
        agent?: string;
        summary?: string;
        pr_url?: string;
        timestamp?: number;
      };

      if (!parsed.agent) return;

      const event: WorkerCompletionEvent = {
        workerName: parsed.agent,
        summary: parsed.summary ?? "Task completed",
        prUrl: parsed.pr_url,
        timestamp: parsed.timestamp ?? Date.now(),
      };

      // Completion events are rare — emit immediately (not batched)
      this.io
        .to(`worker:${parsed.agent}`)
        .emit("worker:completed", event);
    } catch {
      // Ignore malformed completion messages
    }
  }
}
