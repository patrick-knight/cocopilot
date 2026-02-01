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

    return message;
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
