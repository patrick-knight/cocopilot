/**
 * Message Batcher — aggregates Socket.IO events over configurable time windows.
 *
 * Groups events by type and deduplicates repeat events for the same entity
 * (keyed by a configurable identity function). Emits batched arrays to
 * Socket.IO rooms at the end of each window.
 *
 * This reduces the number of WebSocket frames sent to clients when many
 * events fire in quick succession (e.g. multiple worker status changes).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An event queued for batching. */
export interface QueuedEvent {
  /** Socket.IO event name to emit. */
  event: string;
  /** Payload data. */
  data: unknown;
  /** Room or target to emit to (undefined = broadcast). */
  room?: string;
  /** Deduplication key — later events with the same key replace earlier ones. */
  dedupeKey?: string;
}

/** Emitter interface compatible with Socket.IO Server / Room. */
export interface BatchEmitter {
  emit(event: string, data: unknown): void;
}

/** Function that resolves a room target for emission. */
export type RoomResolver = (room: string) => BatchEmitter;

/** Configuration for the MessageBatcher. */
export interface MessageBatcherConfig {
  /** Batching window in milliseconds. Defaults to 100. */
  windowMs?: number;
  /** Resolver for room-scoped emissions. */
  roomResolver: RoomResolver;
  /** Fallback emitter for broadcasts (no room). */
  broadcastEmitter: BatchEmitter;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Aggregates Socket.IO events over time windows and emits them as batched
 * arrays. Deduplicates events with the same `dedupeKey` within a window —
 * only the latest event for a given key is emitted.
 *
 * Usage:
 * ```ts
 * const batcher = new MessageBatcher({
 *   windowMs: 100,
 *   roomResolver: (room) => io.to(room),
 *   broadcastEmitter: io,
 * });
 * batcher.start();
 *
 * // Queue events — they will be batched and emitted
 * batcher.enqueue({
 *   event: "worker:output",
 *   data: outputEvent,
 *   room: "worker:Snickers",
 *   dedupeKey: "worker:Snickers:output:123",
 * });
 *
 * // Later:
 * batcher.stop();
 * ```
 */
export class MessageBatcher {
  private readonly windowMs: number;
  private readonly roomResolver: RoomResolver;
  private readonly broadcastEmitter: BatchEmitter;

  /** Pending events grouped by `room ?? "__broadcast__"`. */
  private buckets = new Map<string, Map<string, QueuedEvent>>();
  /** Running sequence number for non-deduped events. */
  private seq = 0;

  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(config: MessageBatcherConfig) {
    this.windowMs = config.windowMs ?? 100;
    this.roomResolver = config.roomResolver;
    this.broadcastEmitter = config.broadcastEmitter;
  }

  /** Start the batching interval. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.timer = setInterval(() => this.flush(), this.windowMs);
  }

  /** Stop the batching interval and flush remaining events. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  /**
   * Enqueue an event for batched emission.
   *
   * If `dedupeKey` is provided, any previous event with the same key
   * (within the same room bucket) is replaced — only the latest value
   * is emitted at flush time.
   */
  enqueue(event: QueuedEvent): void {
    const bucketKey = event.room ?? "__broadcast__";

    if (!this.buckets.has(bucketKey)) {
      this.buckets.set(bucketKey, new Map());
    }

    const bucket = this.buckets.get(bucketKey)!;
    const key = event.dedupeKey ?? `__seq__:${this.seq++}`;
    bucket.set(key, event);
  }

  /**
   * Immediately flush all pending events. Events within each room bucket
   * are grouped by event name and emitted as `batch:<eventName>` with an
   * array of payloads.
   */
  flush(): void {
    if (this.buckets.size === 0) return;

    const snapshot = this.buckets;
    this.buckets = new Map();

    for (const [bucketKey, events] of snapshot) {
      if (events.size === 0) continue;

      // Group events by their Socket.IO event name
      const grouped = new Map<string, unknown[]>();
      for (const queued of events.values()) {
        const eventName = queued.event;
        if (!grouped.has(eventName)) {
          grouped.set(eventName, []);
        }
        grouped.get(eventName)!.push(queued.data);
      }

      // Resolve the emitter for this bucket
      const emitter =
        bucketKey === "__broadcast__"
          ? this.broadcastEmitter
          : this.roomResolver(bucketKey);

      // Emit batched arrays
      for (const [eventName, payloads] of grouped) {
        emitter.emit(`batch:${eventName}`, payloads);
      }
    }
  }

  /** Returns the number of pending events across all buckets. */
  get pendingCount(): number {
    let count = 0;
    for (const bucket of this.buckets.values()) {
      count += bucket.size;
    }
    return count;
  }
}
