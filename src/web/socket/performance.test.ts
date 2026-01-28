/**
 * Performance tests for WebSocket batching and event processing.
 *
 * Validates that the message batching pipeline meets the <500ms latency
 * target from enqueue through flush, even under high throughput.
 */

import { MessageBatcher, type MessageBatcherConfig } from "./batching.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EmittedEvent {
  target: string;
  event: string;
  data: unknown;
  receivedAt: number;
}

function createTimedBatcher(windowMs = 100): {
  batcher: MessageBatcher;
  emitted: EmittedEvent[];
} {
  const emitted: EmittedEvent[] = [];

  const config: MessageBatcherConfig = {
    windowMs,
    roomResolver: (room) => ({
      emit: (event, data) =>
        emitted.push({ target: room, event, data, receivedAt: performance.now() }),
    }),
    broadcastEmitter: {
      emit: (event, data) =>
        emitted.push({ target: "__broadcast__", event, data, receivedAt: performance.now() }),
    },
  };

  return { batcher: new MessageBatcher(config), emitted };
}

// ---------------------------------------------------------------------------
// Performance tests
// ---------------------------------------------------------------------------

describe("WebSocket performance", () => {
  describe("batching latency", () => {
    it("flushes within <500ms of enqueue under normal load", (done) => {
      const { batcher, emitted } = createTimedBatcher(100);
      batcher.start();

      const enqueueTime = performance.now();

      // Enqueue 50 events (typical burst)
      for (let i = 0; i < 50; i++) {
        batcher.enqueue({
          event: "worker:output",
          data: { workerName: "Snickers", content: `line ${i}`, timestamp: Date.now() },
          room: "worker:Snickers",
        });
      }

      // Wait for the flush interval + buffer
      setTimeout(() => {
        expect(emitted.length).toBeGreaterThan(0);

        const latency = emitted[0].receivedAt - enqueueTime;
        expect(latency).toBeLessThan(500);

        batcher.stop();
        done();
      }, 200);
    });

    it("flushes within <500ms under high load (1000 events)", (done) => {
      const { batcher, emitted } = createTimedBatcher(100);
      batcher.start();

      const enqueueTime = performance.now();

      // Enqueue 1000 events across 10 rooms (simulating many workers)
      for (let i = 0; i < 1000; i++) {
        const workerIdx = i % 10;
        batcher.enqueue({
          event: "worker:output",
          data: {
            workerName: `worker-${workerIdx}`,
            content: `line ${i}`,
            timestamp: Date.now(),
          },
          room: `worker:worker-${workerIdx}`,
        });
      }

      setTimeout(() => {
        expect(emitted.length).toBeGreaterThan(0);

        // All emissions should have arrived within 500ms of enqueue
        for (const evt of emitted) {
          const latency = evt.receivedAt - enqueueTime;
          expect(latency).toBeLessThan(500);
        }

        batcher.stop();
        done();
      }, 200);
    });

    it("manual flush achieves <10ms latency", () => {
      const { batcher, emitted } = createTimedBatcher(100);

      const enqueueTime = performance.now();

      for (let i = 0; i < 100; i++) {
        batcher.enqueue({
          event: "worker:output",
          data: { content: `line ${i}` },
          room: "worker:A",
        });
      }

      batcher.flush();
      const flushTime = performance.now();

      expect(emitted.length).toBe(1);
      expect(flushTime - enqueueTime).toBeLessThan(10);
    });
  });

  describe("deduplication efficiency", () => {
    it("reduces 1000 status updates to deduplicated set in <500ms", (done) => {
      const { batcher, emitted } = createTimedBatcher(100);
      batcher.start();

      const startTime = performance.now();

      // Simulate rapid status updates for 10 workers (100 updates each)
      // With deduplication, only 10 events should be emitted per room
      for (let i = 0; i < 1000; i++) {
        const workerIdx = i % 10;
        batcher.enqueue({
          event: "worker:status",
          data: {
            workerName: `worker-${workerIdx}`,
            status: i < 500 ? "starting" : "healthy",
            timestamp: Date.now(),
          },
          room: "repo:main",
          dedupeKey: `worker-status:worker-${workerIdx}`,
        });
      }

      setTimeout(() => {
        expect(emitted.length).toBe(1); // Single batch emission for the room

        const batchPayload = emitted[0].data as unknown[];
        // 10 workers, each deduplicated to 1 event
        expect(batchPayload).toHaveLength(10);

        const latency = emitted[0].receivedAt - startTime;
        expect(latency).toBeLessThan(500);

        batcher.stop();
        done();
      }, 200);
    });
  });

  describe("throughput", () => {
    it("processes 10,000 events in <500ms total", () => {
      const { batcher, emitted } = createTimedBatcher(100);

      const startTime = performance.now();

      for (let i = 0; i < 10_000; i++) {
        batcher.enqueue({
          event: "worker:output",
          data: { content: `line ${i}` },
          room: `worker:worker-${i % 20}`,
        });
      }

      batcher.flush();
      const endTime = performance.now();

      // Should have emitted 20 batches (one per room)
      expect(emitted).toHaveLength(20);

      // Total processing time should be well under 500ms
      expect(endTime - startTime).toBeLessThan(500);
    });

    it("handles mixed event types efficiently", () => {
      const { batcher, emitted } = createTimedBatcher(100);

      const startTime = performance.now();

      const eventTypes = [
        "worker:output",
        "worker:status",
        "worker:completed",
        "agent:update",
        "pr:update",
      ];

      // Use different moduli for room (4) and event type (5) to ensure
      // each room receives multiple event types
      for (let i = 0; i < 5000; i++) {
        batcher.enqueue({
          event: eventTypes[i % eventTypes.length],
          data: { index: i },
          room: `worker:worker-${i % 4}`,
        });
      }

      batcher.flush();
      const endTime = performance.now();

      // 4 rooms x 5 event types = 20 batch emissions
      expect(emitted).toHaveLength(20);
      expect(endTime - startTime).toBeLessThan(500);
    });
  });

  describe("room-based selective subscription", () => {
    it("isolates events to correct rooms without cross-talk", () => {
      const { batcher, emitted } = createTimedBatcher(100);

      batcher.enqueue({
        event: "worker:output",
        data: { workerName: "A", content: "hello" },
        room: "worker:A",
      });
      batcher.enqueue({
        event: "worker:output",
        data: { workerName: "B", content: "world" },
        room: "worker:B",
      });
      batcher.enqueue({
        event: "worker:status",
        data: { workerName: "A", status: "healthy" },
        room: "repo:main",
        dedupeKey: "status:A",
      });

      batcher.flush();

      // 3 separate emissions: worker:A output, worker:B output, repo:main status
      expect(emitted).toHaveLength(3);

      const workerAEmit = emitted.find((e) => e.target === "worker:A");
      const workerBEmit = emitted.find((e) => e.target === "worker:B");
      const repoEmit = emitted.find((e) => e.target === "repo:main");

      expect(workerAEmit).toBeDefined();
      expect(workerBEmit).toBeDefined();
      expect(repoEmit).toBeDefined();

      // Verify no cross-talk
      expect((workerAEmit!.data as any[])[0].workerName).toBe("A");
      expect((workerBEmit!.data as any[])[0].workerName).toBe("B");
    });
  });
});
