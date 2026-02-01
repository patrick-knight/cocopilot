/**
 * Unified Message Broker (Ganache Bus)
 *
 * Combines Redis pub/sub for real-time delivery with file-based persistence
 * for durability. Every message published via the broker is:
 *   1. Persisted to disk (FileMessageStore)
 *   2. Published via Redis pub/sub (RedisMessageBus)
 *
 * On recovery (e.g., after a daemon restart), unacknowledged messages
 * are replayed to their subscribers so no messages are lost.
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

/**
 * MessageBroker is the primary API for CoCoPilot's inter-agent messaging.
 * It coordinates real-time delivery (Redis) with durable persistence (files).
 */
export class MessageBroker {
  private readonly bus: RedisMessageBus;
  private readonly store: FileMessageStore;
  private readonly agentHandlers: Map<string, MessageHandler> = new Map();

  constructor(config: MessageBrokerConfig) {
    this.bus = new RedisMessageBus(config.redis);
    this.store = new FileMessageStore(config.fileStore);
  }

  /** Get the underlying message store (for API access to historical messages). */
  get messageStore(): FileMessageStore {
    return this.store;
  }

  /** Connect to Redis. Must be called before publishing or subscribing. */
  async connect(): Promise<void> {
    await this.bus.connect();
  }

  /**
   * Create and send a message. The message is assigned a UUID and timestamp,
   * persisted to disk, then published via Redis.
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

    // Persist first for durability, then publish for real-time delivery
    await this.store.save(message as CocoMessage);
    await this.bus.publish(message as CocoMessage);

    // Publish ALL messages to stream for Live Output visibility
    this.publishToStream(message as CocoMessage);

    return message;
  }

  /**
   * Publish a message to the stream channel for Live Output visibility.
   * Extracts repoName from the scoped agent/worker names.
   */
  private publishToStream(message: CocoMessage): void {
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
    this.bus.publishRaw(channel, JSON.stringify(streamEvent)).catch(err => {
      console.error('[MessageBroker] Failed to publish stream event:', err instanceof Error ? err.message : err);
    });

    // Also publish to a global messages channel for the repo
    const globalChannel = streamChannel(`messages:${repoName}`);
    this.bus.publishRaw(globalChannel, JSON.stringify(streamEvent)).catch(err => {
      console.error('[MessageBroker] Failed to publish to global channel:', err instanceof Error ? err.message : err);
    });
  }

  /**
   * Subscribe an agent to receive messages. The handler is invoked for
   * both direct messages and broadcasts.
   */
  async subscribe(agentName: string, handler: MessageHandler): Promise<void> {
    if (!agentName.includes(":")) {
      console.warn(
        `[MessageBroker] Warning: subscribing with unscoped name "${agentName}". ` +
        `Use scopedAgentName() or scopedWorkerName() to avoid cross-repo collisions.`,
      );
    }
    this.agentHandlers.set(agentName, handler);
    await this.bus.subscribe(agentName, handler);
  }

  /** Unsubscribe an agent from message delivery. */
  async unsubscribe(agentName: string): Promise<void> {
    this.agentHandlers.delete(agentName);
    await this.bus.unsubscribe(agentName);
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

  /** Gracefully shut down the broker. */
  async close(): Promise<void> {
    this.agentHandlers.clear();
    await this.bus.close();
  }
}
