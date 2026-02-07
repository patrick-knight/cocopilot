/**
 * Redis Pub/Sub Message Bus
 *
 * Provides real-time inter-agent communication via Redis pub/sub.
 * Each agent subscribes to its own channel and the broadcast channel.
 * Messages are serialized as JSON.
 */

import IORedis, { type Redis as RedisClient } from "ioredis";
import {
  CocoMessage,
  MessageHandler,
  agentChannel,
  BROADCAST_CHANNEL,
} from "./types.js";

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
  retryStrategy?: (times: number) => number | null;
}

const DEFAULT_CONFIG: RedisConfig = {
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: 3,
};

/**
 * RedisMessageBus handles real-time message delivery between CoCoPilot agents
 * using Redis pub/sub. It manages two Redis connections: one for publishing
 * and one for subscribing (required by Redis pub/sub protocol).
 */
type RedisOptions = {
  host: string;
  port: number;
  password?: string;
  maxRetriesPerRequest?: number;
  retryStrategy?: (times: number) => number | null;
  lazyConnect?: boolean;
};

type RedisConstructor = new (options: RedisOptions) => RedisClient;

export type ConnectionStateCallback = (connected: boolean) => void;

export class RedisMessageBus {
  private pub: RedisClient;
  private sub: RedisClient;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private subscribedChannels: Set<string> = new Set();
  private closed = false;
  private connectionStateCallback: ConnectionStateCallback | null = null;

  constructor(config: Partial<RedisConfig> = {}) {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    // Redis requires separate connections for pub and sub
    const RedisCtor = IORedis as unknown as RedisConstructor;

    this.pub = new RedisCtor({
      host: mergedConfig.host,
      port: mergedConfig.port,
      password: mergedConfig.password,
      maxRetriesPerRequest: mergedConfig.maxRetriesPerRequest,
      retryStrategy: mergedConfig.retryStrategy ?? defaultRetryStrategy,
      lazyConnect: true,
    });

    this.sub = new RedisCtor({
      host: mergedConfig.host,
      port: mergedConfig.port,
      password: mergedConfig.password,
      maxRetriesPerRequest: mergedConfig.maxRetriesPerRequest,
      retryStrategy: mergedConfig.retryStrategy ?? defaultRetryStrategy,
      lazyConnect: true,
    });

    this.sub.on("message", (channel: string, raw: string) => {
      this.handleIncoming(channel, raw);
    });

    // Listen for connection state events on both clients
    for (const client of [this.pub, this.sub]) {
      client.on("error", () => {
        this.connectionStateCallback?.(false);
      });
      client.on("close", () => {
        this.connectionStateCallback?.(false);
      });
      client.on("reconnecting", () => {
        this.connectionStateCallback?.(false);
      });
      client.on("ready", () => {
        if (this.pub.status === "ready" && this.sub.status === "ready") {
          this.connectionStateCallback?.(true);
        }
      });
    }
  }

  /** Register a callback to be notified of connection state changes. */
  onConnectionStateChange(callback: ConnectionStateCallback): void {
    this.connectionStateCallback = callback;
  }

  /** Connect both pub and sub clients to Redis. */
  async connect(): Promise<void> {
    if (this.closed) throw new Error("Bus is closed");
    await Promise.all([this.pub.connect(), this.sub.connect()]);
  }

  /**
   * Publish a message to the appropriate channel.
   * Messages addressed to "*" go to the broadcast channel;
   * otherwise they go to the target agent's channel.
   * Returns false if publish failed (instead of throwing).
   */
  async publish(message: CocoMessage): Promise<boolean> {
    if (this.closed) return false;
    try {
      const channel =
        message.to === "*" ? BROADCAST_CHANNEL : agentChannel(message.to);
      const raw = JSON.stringify(message);
      await this.pub.publish(channel, raw);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Subscribe to messages for a specific agent.
   * Automatically subscribes to both the agent's channel and broadcast.
   * Returns false if Redis subscription failed (instead of throwing).
   */
  async subscribe(agentName: string, handler: MessageHandler): Promise<boolean> {
    if (this.closed) return false;

    const channel = agentChannel(agentName);

    // Register handler for this agent's channel
    this.addHandler(channel, handler);
    // Also listen for broadcasts
    this.addHandler(BROADCAST_CHANNEL, handler);

    // Subscribe to Redis channels if not already subscribed
    const toSubscribe: string[] = [];
    if (!this.subscribedChannels.has(channel)) {
      toSubscribe.push(channel);
      this.subscribedChannels.add(channel);
    }
    if (!this.subscribedChannels.has(BROADCAST_CHANNEL)) {
      toSubscribe.push(BROADCAST_CHANNEL);
      this.subscribedChannels.add(BROADCAST_CHANNEL);
    }

    if (toSubscribe.length > 0) {
      try {
        await this.sub.subscribe(...toSubscribe);
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Subscribe to a specific Redis channel with a handler.
   * Useful for non-agent channels like completions or streams.
   */
  async subscribeChannel(
    channel: string,
    handler: MessageHandler,
  ): Promise<void> {
    if (this.closed) throw new Error("Bus is closed");

    this.addHandler(channel, handler);

    if (!this.subscribedChannels.has(channel)) {
      this.subscribedChannels.add(channel);
      await this.sub.subscribe(channel);
    }
  }

  /** Unsubscribe an agent from all its channels. */
  async unsubscribe(agentName: string): Promise<void> {
    const channel = agentChannel(agentName);
    this.handlers.delete(channel);

    if (this.subscribedChannels.has(channel)) {
      this.subscribedChannels.delete(channel);
      await this.sub.unsubscribe(channel);
    }

    // Only unsubscribe from broadcast if no other handlers remain
    const hasBroadcastHandlers =
      (this.handlers.get(BROADCAST_CHANNEL)?.size ?? 0) > 0;
    if (!hasBroadcastHandlers && this.subscribedChannels.has(BROADCAST_CHANNEL)) {
      this.subscribedChannels.delete(BROADCAST_CHANNEL);
      await this.sub.unsubscribe(BROADCAST_CHANNEL);
    }
  }

  /** Unsubscribe from a specific channel. */
  async unsubscribeChannel(channel: string): Promise<void> {
    this.handlers.delete(channel);

    if (this.subscribedChannels.has(channel)) {
      this.subscribedChannels.delete(channel);
      await this.sub.unsubscribe(channel);
    }
  }

  /** Gracefully close both Redis connections. */
  async close(): Promise<void> {
    this.closed = true;
    this.handlers.clear();
    this.subscribedChannels.clear();
    await Promise.all([this.pub.quit(), this.sub.quit()]);
  }

  /** Check if the bus is connected and ready. */
  get isReady(): boolean {
    return (
      !this.closed &&
      this.pub.status === "ready" &&
      this.sub.status === "ready"
    );
  }

  /** Publish raw payload to an arbitrary Redis channel. Returns false on failure. */
  async publishRaw(channel: string, payload: string): Promise<boolean> {
    if (this.closed) return false;
    try {
      await this.pub.publish(channel, payload);
      return true;
    } catch {
      return false;
    }
  }

  private addHandler(channel: string, handler: MessageHandler): void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);
  }

  private handleIncoming(channel: string, raw: string): void {
    let message: CocoMessage;
    try {
      message = JSON.parse(raw) as CocoMessage;
    } catch {
      // Silently ignore malformed messages
      return;
    }

    const handlers = this.handlers.get(channel);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        const result = handler(message);
        // If handler returns a promise, catch rejections
        if (result && typeof result === "object" && "catch" in result) {
          (result as Promise<void>).catch(() => {
            // Handler errors are silently swallowed to prevent
            // one bad handler from disrupting message delivery
          });
        }
      } catch {
        // Same as above — don't let handler errors break the bus
      }
    }
  }
}

function defaultRetryStrategy(times: number): number | null {
  if (times > 10) return null; // Stop retrying after 10 attempts
  return Math.min(times * 200, 5000); // Exponential backoff, max 5s
}
