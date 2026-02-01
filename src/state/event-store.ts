/**
 * EventStore — in-memory store for activity events with file persistence.
 *
 * Stores ActivityEvent objects for the Batch Log (activity timeline) page.
 * Events are held in memory and optionally persisted to disk for recovery
 * across daemon restarts.
 *
 * Supports:
 *   - Adding events (newest first)
 *   - Querying with filters (type, agent, repository, date range)
 *   - Configurable max capacity (oldest events evicted)
 *   - File persistence via atomic writes
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { atomicWriteFile } from "./atomic-write.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Event types shown in the activity timeline. */
export type ActivityEventType =
  | "worker_spawned"
  | "worker_completed"
  | "worker_failed"
  | "pr_created"
  | "pr_merged"
  | "ci_failed"
  | "repo_initialized"
  | "nudge_sent";

/** A single event in the activity timeline. */
export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  repository: string;
  description: string;
  timestamp: string; // ISO 8601
  agent?: string;
  prNumber?: number;
  workerName?: string;
}

/** Filters for querying events. */
export interface EventFilter {
  type?: string;
  agent?: string;
  repository?: string;
  from?: string; // ISO 8601 date or date-time
  to?: string; // ISO 8601 date or date-time
}

export interface EventStoreConfig {
  /** Maximum number of events to keep in memory. Defaults to 1000. */
  maxEvents?: number;
  /** Path to the persistence file. If not set, events are in-memory only. */
  persistPath?: string;
}

// ---------------------------------------------------------------------------
// EventStore
// ---------------------------------------------------------------------------

export class EventStore {
  private events: ActivityEvent[] = [];
  private readonly maxEvents: number;
  private readonly persistPath: string | undefined;

  constructor(config?: EventStoreConfig) {
    this.maxEvents = config?.maxEvents ?? 1000;
    this.persistPath = config?.persistPath;
  }

  /**
   * Load persisted events from disk. Call once during startup.
   */
  async init(): Promise<void> {
    if (!this.persistPath) return;

    try {
      const raw = await fs.promises.readFile(this.persistPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.events = parsed.slice(0, this.maxEvents);
      }
    } catch {
      // File missing or corrupt — start fresh
      this.events = [];
    }
  }

  /**
   * Add a new activity event. Returns the created event.
   * The event is prepended (newest first) and the store is capped.
   */
  add(
    opts: Omit<ActivityEvent, "id" | "timestamp"> & { timestamp?: string },
  ): ActivityEvent {
    const event: ActivityEvent = {
      id: randomUUID(),
      type: opts.type,
      repository: opts.repository,
      description: opts.description,
      timestamp: opts.timestamp ?? new Date().toISOString(),
      agent: opts.agent,
      prNumber: opts.prNumber,
      workerName: opts.workerName,
    };

    this.events.unshift(event);

    // Cap at max
    if (this.events.length > this.maxEvents) {
      this.events.length = this.maxEvents;
    }

    // Persist asynchronously (fire-and-forget but log errors)
    this.persist().catch(err => {
      console.error('[EventStore] Failed to persist events:', err instanceof Error ? err.message : err);
    });

    return event;
  }

  /**
   * Query events with optional filters. Returns newest-first.
   */
  query(filter?: EventFilter): ActivityEvent[] {
    if (!filter) return [...this.events];

    return this.events.filter((e) => {
      if (filter.type && e.type !== filter.type) return false;
      if (filter.agent && e.agent !== filter.agent) return false;
      if (filter.repository && e.repository !== filter.repository) return false;

      if (filter.from) {
        const from = new Date(filter.from);
        if (new Date(e.timestamp) < from) return false;
      }

      if (filter.to) {
        const to = new Date(filter.to);
        // Include the entire "to" day when only a date is given
        if (filter.to.length === 10) {
          to.setDate(to.getDate() + 1);
        }
        if (new Date(e.timestamp) >= to) return false;
      }

      return true;
    });
  }

  /**
   * Get all events (newest first).
   */
  getAll(): readonly ActivityEvent[] {
    return this.events;
  }

  /**
   * Get the number of stored events.
   */
  get size(): number {
    return this.events.length;
  }

  /**
   * Persist events to disk.
   */
  private async persist(): Promise<void> {
    if (!this.persistPath) return;

    const dir = path.dirname(this.persistPath);
    await fs.promises.mkdir(dir, { recursive: true });
    await atomicWriteFile(this.persistPath, JSON.stringify(this.events));
  }
}
