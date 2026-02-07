/**
 * Unified Message Broker (Ganache Bus)
 *
 * Combines Redis pub/sub for real-time delivery with file-based persistence
 * for durability. Every message published via the broker is:
 *   1. Persisted to disk (FileMessageStore)
 *   2. Published via Redis pub/sub (RedisMessageBus) — if available
 *
 * On recovery (e.g., after a daemon restart), unacknowledged messages
 * are replayed to their subscribers so no messages are lost.
 *
 * If Redis becomes unavailable, the broker automatically falls back to
 * file store only and polls for new messages. When Redis recovers, it
 * resumes real-time delivery.
 */

import { v4 as uuidv4 } from "uuid";
import {
  CocoMessage,
  CreateMessageOptions,
  MessageHandler,
  MessageType,
  streamChannel,
} from "./types.js";
import { RedisMessageBus, RedisConfig } from "./redis-bus.js";
import { FileMessageStore, FileStoreConfig } from "./file-store.js";

export interface MessageBrokerConfig {
  redis: Partial<RedisConfig>;
  fileStore: FileStoreConfig;
}

export interface BrokerHealth {
  redis: boolean;
  fileStore: boolean;
}

const REDIS_RECONNECT_INTERVAL_MS = 30_000;
const FILE_POLL_INTERVAL_MS = 5_000;

/**
 * MessageBroker is the primary API for CoCoPilot's inter-agent messaging.
 * It coordinates real-time delivery (Redis) with durable persistence (files).
 */
export class MessageBroker {
  private readonly bus: RedisMessageBus;
  private readonly store: FileMessageStore;
  private readonly agentHandlers: Map<string, MessageHandler> = new Map();
  private redisAvailable = false;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  // Track last poll time per agent to only deliver new messages
  private lastPollTimestamps: Map<string, number> = new Map();

  constructor(config: MessageBrokerConfig) {
    this.bus = new RedisMessageBus(config.redis);
    this.store = new FileMessageStore(config.fileStore);

    // Listen for Redis connection state changes
    this.bus.onConnectionStateChange((connected) => {
      if (connected && !this.redisAvailable) {
        console.log("[MessageBroker] Redis connection recovered");
        this.redisAvailable = true;
        this.resubscribeAll().catch(() => {});
        this.stopFilePolling();
      } else if (!connected && this.redisAvailable) {
        console.warn("[MessageBroker] Redis connection lost, falling back to file store");
        this.redisAvailable = false;
        this.startFilePolling();
      }
    });
  }

  /** Get the underlying message store (for API access to historical messages). */
  get messageStore(): FileMessageStore {
    return this.store;
  }

  /** Connect to Redis. Must be called before publishing or subscribing. */
  async connect(): Promise<void> {
    try {
      await this.bus.connect();
      this.redisAvailable = true;
    } catch {
      console.warn("[MessageBroker] Redis connect failed, operating in file-store-only mode");
      this.redisAvailable = false;
      this.startFilePolling();
    }
    this.startReconnectTimer();
  }

  /**
   * Create and send a message. The message is assigned a UUID and timestamp,
   * persisted to disk, then published via Redis (if available).
   * Returns the message as long as file store write succeeds.
   */
  async send<T extends MessageType>(
    options: CreateMessageOptions<T>,
  ): Promise<CocoMessage<T>> {
    const message: CocoMessage<T> = {
      id: uuidv4(),
      type: options.type,
      from: options.from,
      to: options.to,
      payload: options.payload,
      priority: options.priority ?? "normal",
      timestamp: Date.now(),
      ack_required: options.ack_required ?? false,
    };

    // Persist first for durability — this is the guarantee
    await this.store.save(message as CocoMessage);

    // Attempt Redis publish only if available
    if (this.redisAvailable) {
      const ok = await this.bus.publish(message as CocoMessage);
      if (!ok) {
        console.warn("[MessageBroker] Redis publish failed, marking unavailable");
        this.redisAvailable = false;
        this.startFilePolling();
      }
    }

    // Publish ALL messages to stream for Live Output visibility
    this.publishToStream(message as CocoMessage);

    return message;
  }

  /**
   * Publish a message to the stream channel for Live Output visibility.
   * Extracts repoName from the scoped agent/worker names.
   */
  private publishToStream(message: CocoMessage): void {
    if (!this.redisAvailable) return;

    // Extract repoName from scoped names (format: "agentType:repoName" or "workerName:repoName")
    const fromParts = message.from.split(":");
    const toParts = message.to.split(":");
    const repoName = fromParts[1] || toParts[1] || "global";
    
    // Determine the agent name for the stream channel
    const agentName = message.from;
    const channel = streamChannel(agentName);

    // Format message content for human readability
    let content: string;
    const payload = message.payload as unknown as Record<string, unknown>;
    
    switch (message.type) {
      case MessageType.BROADCAST:
        content = `📢 ${(payload as { message?: string }).message || JSON.stringify(payload)}`;
        break;
      case MessageType.NUDGE:
        content = `💡 Nudge to ${message.to}: ${(payload as { hint?: string }).hint || ""}`;
        break;
      case MessageType.TASK_ASSIGNED:
        content = `📋 Task assigned to ${message.to}: ${(payload as { task?: string }).task || ""}`;
        break;
      case MessageType.TASK_COMPLETE:
        content = `✅ Task complete: ${(payload as { summary?: string }).summary || ""}`;
        break;
      case MessageType.TASK_FAILED:
        content = `❌ Task failed: ${(payload as { error?: string }).error || ""}`;
        break;
      case MessageType.PR_CREATED:
        content = `🔗 PR created: ${(payload as { prUrl?: string }).prUrl || ""}`;
        break;
      case MessageType.PR_MERGED:
        content = `🎉 PR merged: ${(payload as { prUrl?: string }).prUrl || ""}`;
        break;
      case MessageType.CI_FAILED:
        content = `🔴 CI failed: ${(payload as { reason?: string }).reason || ""}`;
        break;
      case MessageType.REVIEW_COMPLETE:
        content = `📝 Review complete: ${(payload as { verdict?: string }).verdict || "approved"}`;
        break;
      case MessageType.SECURITY_REVIEW_PASSED:
        content = `🛡️ Security review passed`;
        break;
      case MessageType.SECURITY_REVIEW_FAILED:
        content = `⚠️ Security review failed: ${(payload as { reason?: string }).reason || ""}`;
        break;
      case MessageType.SPAWN_WORKER:
        content = `🚀 Spawn worker requested: ${(payload as { task?: string }).task || ""}`;
        break;
      case MessageType.WORKER_ACTIVITY:
        content = `📊 Activity: ${(payload as { activityType?: string }).activityType || ""}`;
        break;
      default:
        content = `[${message.type}] ${message.from} → ${message.to}`;
    }

    const streamEvent = {
      type: "message" as const,
      content,
      timestamp: message.timestamp,
      agent: agentName,
      sessionId: message.id,
      eventType: message.type,
      messageType: message.type,
      from: message.from,
      to: message.to,
      repoName,
    };

    // Fire-and-forget; don't block the message send
    this.bus.publishRaw(channel, JSON.stringify(streamEvent)).catch(() => {});

    // Also publish to a global messages channel for the repo
    const globalChannel = streamChannel(`messages:${repoName}`);
    this.bus.publishRaw(globalChannel, JSON.stringify(streamEvent)).catch(() => {});
  }

  /**
   * Subscribe an agent to receive messages. The handler is invoked for
   * both direct messages and broadcasts.
   * If Redis is unavailable, falls back to file store polling.
   */
  async subscribe(agentName: string, handler: MessageHandler): Promise<void> {
    if (!agentName.includes(":")) {
      console.warn(
        `[MessageBroker] Warning: subscribing with unscoped name "${agentName}". ` +
        `Use scopedAgentName() or scopedWorkerName() to avoid cross-repo collisions.`,
      );
    }
    
    // Wrap handler to update timestamp watermark on every delivery
    const wrappedHandler: MessageHandler = async (msg) => {
      await handler(msg);
      // Update watermark to prevent re-delivery during Redis→file fallback
      const currentTs = this.lastPollTimestamps.get(agentName) ?? 0;
      if (msg.timestamp > currentTs) {
        this.lastPollTimestamps.set(agentName, msg.timestamp);
      }
    };
    
    this.agentHandlers.set(agentName, wrappedHandler);
    // Initialize to 0 to replay pending messages when Redis is unavailable
    this.lastPollTimestamps.set(agentName, 0);

    if (this.redisAvailable) {
      const ok = await this.bus.subscribe(agentName, wrappedHandler);
      if (!ok) {
        console.warn("[MessageBroker] Redis subscribe failed, falling back to file store polling");
        this.redisAvailable = false;
        this.startFilePolling();
      }
    } else {
      this.startFilePolling();
    }
  }

  /** Unsubscribe an agent from message delivery. */
  async unsubscribe(agentName: string): Promise<void> {
    this.agentHandlers.delete(agentName);
    this.lastPollTimestamps.delete(agentName);
    try {
      await this.bus.unsubscribe(agentName);
    } catch {
      // Ignore Redis errors during unsubscribe
    }
  }

  /**
   * Acknowledge a message. Marks it as acknowledged in the file store.
   * Returns true if the message was found and acknowledged.
   */
  async acknowledge(agentName: string, messageId: string): Promise<boolean> {
    return this.store.acknowledge(agentName, messageId);
  }

  /**
   * Replay all unacknowledged messages for an agent. Call this during
   * recovery (e.g., after daemon restart) to ensure no messages are lost.
   * Also replays pending broadcast messages.
   */
  async replay(agentName: string): Promise<CocoMessage[]> {
    const handler = this.agentHandlers.get(agentName);
    if (!handler) return [];

    const [pending, broadcasts] = await Promise.all([
      this.store.getPending(agentName),
      this.store.getPendingBroadcasts(),
    ]);

    const all = [...pending, ...broadcasts].sort(
      (a, b) => a.timestamp - b.timestamp,
    );

    for (const message of all) {
      await handler(message);
    }

    return all;
  }

  /** Get all pending messages for an agent (without replaying). */
  async getPending(agentName: string): Promise<CocoMessage[]> {
    return this.store.getPending(agentName);
  }

  /** Get all messages (pending + acknowledged) for an agent. */
  async getHistory(agentName: string): Promise<CocoMessage[]> {
    return this.store.getAll(agentName);
  }

  /**
   * Clean up old acknowledged messages. Removes ack files older than
   * the specified age. Defaults to 24 hours.
   */
  async cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    return this.store.cleanup(maxAgeMs);
  }

  /** Delete a specific message from the file store. */
  async deleteMessage(
    agentName: string,
    messageId: string,
  ): Promise<boolean> {
    return this.store.delete(agentName, messageId);
  }

  /** Check if the Redis connection is ready. */
  get isReady(): boolean {
    return this.bus.isReady;
  }

  /** Get the underlying Redis bus (for status checks, stream bridges, etc.) */
  get redisBus(): RedisMessageBus {
    return this.bus;
  }

  /** Return health status of broker subsystems. */
  getHealth(): BrokerHealth {
    return {
      redis: this.redisAvailable,
      fileStore: true, // file store is always available (local filesystem)
    };
  }

  /** Gracefully shut down the broker. */
  async close(): Promise<void> {
    this.agentHandlers.clear();
    this.lastPollTimestamps.clear();
    this.stopReconnectTimer();
    this.stopFilePolling();
    await this.bus.close();
  }

  /** Re-subscribe all registered agents to Redis after reconnection. */
  private async resubscribeAll(): Promise<void> {
    for (const [agentName, handler] of this.agentHandlers) {
      const ok = await this.bus.subscribe(agentName, handler);
      if (!ok) {
        // If resubscribe fails, remain in file-store-only mode
        console.warn("[MessageBroker] Resubscribe failed, reverting to file-store polling");
        this.redisAvailable = false;
        this.startFilePolling();
        return;
      }
    }
  }

  /** Attempt a single Redis reconnection. */
  private async attemptRedisReconnect(): Promise<void> {
    if (this.redisAvailable) return;
    try {
      await this.bus.connect();
      console.log("[MessageBroker] Redis reconnected successfully");
      this.redisAvailable = true;
      await this.resubscribeAll();
      // Only stop file polling if Redis is still marked available after resubscribeAll().
      if (this.redisAvailable) {
        this.stopFilePolling();
      }
    } catch {
      // Still unavailable, will retry next interval
    }
  }

  /** Start periodic Redis reconnection attempts. */
  private startReconnectTimer(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setInterval(() => {
      this.attemptRedisReconnect().catch(() => {});
    }, REDIS_RECONNECT_INTERVAL_MS);
    // Don't block process exit
    if (this.reconnectTimer && typeof this.reconnectTimer === "object" && "unref" in this.reconnectTimer) {
      this.reconnectTimer.unref();
    }
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Poll file store once for new messages across all subscribed agents. */
  private async pollFileStore(): Promise<void> {
    // Fetch broadcasts once per poll to reduce IO overhead
    let broadcasts: CocoMessage[] = [];
    try {
      broadcasts = await this.store.getPendingBroadcasts();
    } catch {
      // Broadcast read errors don't break per-agent polling
    }

    for (const [agentName, handler] of this.agentHandlers) {
      try {
        const lastTs = this.lastPollTimestamps.get(agentName) ?? 0;
        const pending = await this.store.getPending(agentName);
        const newMessages = [...pending, ...broadcasts]
          .filter((m) => m.timestamp > lastTs)
          .sort((a, b) => a.timestamp - b.timestamp);

        for (const msg of newMessages) {
          try {
            await handler(msg);
          } catch {
            // Handler errors don't break polling
          }
        }

        if (newMessages.length > 0) {
          const maxTs = Math.max(...newMessages.map((m) => m.timestamp));
          this.lastPollTimestamps.set(agentName, maxTs);
        }
      } catch {
        // File store read errors don't break polling
      }
    }
  }

  /** Start polling file store for new messages when Redis is unavailable. */
  private startFilePolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.pollFileStore().catch(() => {});
    }, FILE_POLL_INTERVAL_MS);
    // Don't block process exit
    if (this.pollTimer && typeof this.pollTimer === "object" && "unref" in this.pollTimer) {
      this.pollTimer.unref();
    }
  }

  private stopFilePolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
