/**
 * Tests for the MessageBatcher.
 */

import { MessageBatcher, type MessageBatcherConfig, type QueuedEvent } from "./batching.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createBatcher(
  windowMs = 100,
): {
  batcher: MessageBatcher;
  emitted: Array<{ target: string; event: string; data: unknown }>;
} {
  const emitted: Array<{ target: string; event: string; data: unknown }> = [];

  const config: MessageBatcherConfig = {
    windowMs,
    roomResolver: (room) => ({
      emit: (event, data) => emitted.push({ target: room, event, data }),
    }),
    broadcastEmitter: {
      emit: (event, data) => emitted.push({ target: "__broadcast__", event, data }),
    },
  };

  return { batcher: new MessageBatcher(config), emitted };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MessageBatcher", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe("enqueue and flush", () => {
    it("batches events by room and event name", () => {
      const { batcher, emitted } = createBatcher();

      batcher.enqueue({
        event: "worker:output",
        data: { content: "line1" },
        room: "worker:Snickers",
      });
      batcher.enqueue({
        event: "worker:output",
        data: { content: "line2" },
        room: "worker:Snickers",
      });

      batcher.flush();

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual({
        target: "worker:Snickers",
        event: "batch:worker:output",
        data: [{ content: "line1" }, { content: "line2" }],
      });
    });

    it("groups events by event name within the same room", () => {
      const { batcher, emitted } = createBatcher();

      batcher.enqueue({
        event: "worker:output",
        data: { type: "output" },
        room: "worker:Kit",
      });
      batcher.enqueue({
        event: "worker:status",
        data: { type: "status" },
        room: "worker:Kit",
      });

      batcher.flush();

      expect(emitted).toHaveLength(2);
      expect(emitted).toContainEqual({
        target: "worker:Kit",
        event: "batch:worker:output",
        data: [{ type: "output" }],
      });
      expect(emitted).toContainEqual({
        target: "worker:Kit",
        event: "batch:worker:status",
        data: [{ type: "status" }],
      });
    });

    it("separates events across different rooms", () => {
      const { batcher, emitted } = createBatcher();

      batcher.enqueue({
        event: "worker:output",
        data: { worker: "A" },
        room: "worker:A",
      });
      batcher.enqueue({
        event: "worker:output",
        data: { worker: "B" },
        room: "worker:B",
      });

      batcher.flush();

      expect(emitted).toHaveLength(2);
      expect(emitted).toContainEqual({
        target: "worker:A",
        event: "batch:worker:output",
        data: [{ worker: "A" }],
      });
      expect(emitted).toContainEqual({
        target: "worker:B",
        event: "batch:worker:output",
        data: [{ worker: "B" }],
      });
    });

    it("broadcasts when no room is specified", () => {
      const { batcher, emitted } = createBatcher();

      batcher.enqueue({
        event: "state_changed",
        data: { version: 1 },
      });

      batcher.flush();

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual({
        target: "__broadcast__",
        event: "batch:state_changed",
        data: [{ version: 1 }],
      });
    });

    it("does nothing when no events are pending", () => {
      const { batcher, emitted } = createBatcher();

      batcher.flush();

      expect(emitted).toHaveLength(0);
    });
  });

  describe("deduplication", () => {
    it("deduplicates events with the same dedupeKey (last wins)", () => {
      const { batcher, emitted } = createBatcher();

      batcher.enqueue({
        event: "worker:status",
        data: { status: "starting" },
        room: "repo:main",
        dedupeKey: "worker-status:Snickers",
      });
      batcher.enqueue({
        event: "worker:status",
        data: { status: "healthy" },
        room: "repo:main",
        dedupeKey: "worker-status:Snickers",
      });

      batcher.flush();

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual({
        target: "repo:main",
        event: "batch:worker:status",
        data: [{ status: "healthy" }],
      });
    });

    it("does not deduplicate events without dedupeKey", () => {
      const { batcher, emitted } = createBatcher();

      batcher.enqueue({
        event: "worker:output",
        data: { line: 1 },
        room: "worker:Kit",
      });
      batcher.enqueue({
        event: "worker:output",
        data: { line: 2 },
        room: "worker:Kit",
      });

      batcher.flush();

      expect(emitted).toHaveLength(1);
      expect(emitted[0].data).toEqual([{ line: 1 }, { line: 2 }]);
    });

    it("deduplicates independently per room", () => {
      const { batcher, emitted } = createBatcher();

      batcher.enqueue({
        event: "worker:status",
        data: { status: "starting", room: "A" },
        room: "repo:A",
        dedupeKey: "status:Snickers",
      });
      batcher.enqueue({
        event: "worker:status",
        data: { status: "starting", room: "B" },
        room: "repo:B",
        dedupeKey: "status:Snickers",
      });

      batcher.flush();

      // Both rooms should get the event (dedupe is per-room)
      expect(emitted).toHaveLength(2);
    });
  });

  describe("start/stop lifecycle", () => {
    it("start is idempotent", () => {
      const { batcher } = createBatcher();

      batcher.start();
      batcher.start(); // Should not throw or create duplicate timers

      batcher.stop();
    });

    it("stop flushes remaining events", () => {
      const { batcher, emitted } = createBatcher();

      batcher.start();

      batcher.enqueue({
        event: "worker:output",
        data: { content: "final" },
        room: "worker:Snickers",
      });

      batcher.stop();

      expect(emitted).toHaveLength(1);
      expect(emitted[0].data).toEqual([{ content: "final" }]);
    });

    it("stop is idempotent", () => {
      const { batcher } = createBatcher();

      batcher.start();
      batcher.stop();
      batcher.stop(); // Should not throw
    });

    it("flushes on interval", () => {
      jest.useFakeTimers();

      const { batcher, emitted } = createBatcher(50);
      batcher.start();

      batcher.enqueue({
        event: "worker:output",
        data: { content: "tick1" },
        room: "worker:A",
      });

      jest.advanceTimersByTime(50);

      expect(emitted).toHaveLength(1);

      batcher.enqueue({
        event: "worker:output",
        data: { content: "tick2" },
        room: "worker:A",
      });

      jest.advanceTimersByTime(50);

      expect(emitted).toHaveLength(2);

      batcher.stop();
    });
  });

  describe("pendingCount", () => {
    it("returns 0 when empty", () => {
      const { batcher } = createBatcher();
      expect(batcher.pendingCount).toBe(0);
    });

    it("returns correct count across buckets", () => {
      const { batcher } = createBatcher();

      batcher.enqueue({ event: "a", data: 1, room: "r1" });
      batcher.enqueue({ event: "b", data: 2, room: "r2" });
      batcher.enqueue({ event: "c", data: 3 }); // broadcast

      expect(batcher.pendingCount).toBe(3);
    });

    it("returns 0 after flush", () => {
      const { batcher } = createBatcher();

      batcher.enqueue({ event: "a", data: 1, room: "r1" });
      batcher.flush();

      expect(batcher.pendingCount).toBe(0);
    });

    it("deduplication reduces pending count", () => {
      const { batcher } = createBatcher();

      batcher.enqueue({ event: "a", data: 1, room: "r1", dedupeKey: "k" });
      batcher.enqueue({ event: "a", data: 2, room: "r1", dedupeKey: "k" });

      expect(batcher.pendingCount).toBe(1);
    });
  });
});
