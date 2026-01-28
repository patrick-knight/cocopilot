/**
 * Tests for the WorkerStreamManager (Socket.IO ↔ Redis bridge).
 */

import { EventEmitter } from "node:events";
import { WorkerStreamManager, type WorkerStreamConfig } from "./worker-stream.js";
import { COMPLETIONS_CHANNEL, STREAM_CHANNEL_PREFIX, streamChannel } from "../../messaging/index.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockRedis extends EventEmitter {
  subscribe = jest.fn().mockResolvedValue(undefined);
  unsubscribe = jest.fn().mockResolvedValue(undefined);
}

class MockSocket extends EventEmitter {
  join = jest.fn().mockResolvedValue(undefined);
  leave = jest.fn().mockResolvedValue(undefined);
  id = "socket-1";
}

class MockSocketIOServer extends EventEmitter {
  private rooms = new Map<string, Set<MockSocket>>();

  to(room: string) {
    const self = this;
    return {
      emit: jest.fn((event: string, data: unknown) => {
        // Track emitted events for assertions
        (self as any).__lastEmit = { room, event, data };
      }),
      fetchSockets: jest.fn(async () => {
        return Array.from(self.rooms.get(room) ?? []);
      }),
    };
  }

  in(room: string) {
    return this.to(room);
  }

  addToRoom(room: string, socket: MockSocket) {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room)!.add(socket);
  }

  removeFromRoom(room: string, socket: MockSocket) {
    this.rooms.get(room)?.delete(socket);
  }
}

class MockStateManager extends EventEmitter {}

function createConfig(): {
  config: WorkerStreamConfig;
  redisSub: MockRedis;
  io: MockSocketIOServer;
  stateManager: MockStateManager;
} {
  const redisSub = new MockRedis();
  const io = new MockSocketIOServer();
  const stateManager = new MockStateManager();

  return {
    config: {
      io: io as any,
      redisSub: redisSub as any,
      stateManager: stateManager as any,
    },
    redisSub,
    io,
    stateManager,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkerStreamManager", () => {
  describe("start", () => {
    it("subscribes to the completions channel", async () => {
      const { config, redisSub } = createConfig();
      const manager = new WorkerStreamManager(config);

      await manager.start();

      expect(redisSub.subscribe).toHaveBeenCalledWith(COMPLETIONS_CHANNEL);
    });

    it("does nothing when called twice", async () => {
      const { config, redisSub } = createConfig();
      const manager = new WorkerStreamManager(config);

      await manager.start();
      await manager.start();

      // Should only subscribe once
      expect(redisSub.subscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe("stop", () => {
    it("unsubscribes from all channels", async () => {
      const { config, redisSub } = createConfig();
      const manager = new WorkerStreamManager(config);

      await manager.start();
      await manager.stop();

      expect(redisSub.unsubscribe).toHaveBeenCalledWith(COMPLETIONS_CHANNEL);
    });

    it("does nothing when not started", async () => {
      const { config, redisSub } = createConfig();
      const manager = new WorkerStreamManager(config);

      await manager.stop();

      expect(redisSub.unsubscribe).not.toHaveBeenCalled();
    });
  });

  describe("Socket.IO connection handling", () => {
    it("subscribes to Redis channel when client joins worker room", async () => {
      const { config, redisSub, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      // Simulate a socket connection
      const socket = new MockSocket();
      io.emit("connection", socket);

      // Client joins a worker room
      socket.emit("worker:join", "Snickers");

      // Allow async processing
      await new Promise((r) => setTimeout(r, 10));

      expect(socket.join).toHaveBeenCalledWith("worker:Snickers");
      expect(redisSub.subscribe).toHaveBeenCalledWith(
        streamChannel("Snickers"),
      );
    });

    it("ignores invalid worker names", async () => {
      const { config, redisSub, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const socket = new MockSocket();
      io.emit("connection", socket);

      socket.emit("worker:join", "");
      socket.emit("worker:join", 42);

      await new Promise((r) => setTimeout(r, 10));

      // Should only have the initial completions subscription
      expect(redisSub.subscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe("Redis message handling", () => {
    it("emits worker:output to the correct room on stream message", async () => {
      const { config, redisSub, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      // Track emitted events
      const emitMock = jest.fn();
      const originalTo = io.to.bind(io);
      io.to = jest.fn((room: string) => {
        const result = originalTo(room);
        result.emit = emitMock;
        return result;
      }) as any;

      // Simulate Redis message on stream channel
      const channel = streamChannel("Snickers");
      const payload = JSON.stringify({ type: "output", content: "Hello world" });
      redisSub.emit("message", channel, payload);

      expect(io.to).toHaveBeenCalledWith("worker:Snickers");
      expect(emitMock).toHaveBeenCalledWith(
        "worker:output",
        expect.objectContaining({
          workerName: "Snickers",
          type: "output",
          content: "Hello world",
        }),
      );
    });

    it("handles non-JSON stream messages gracefully", async () => {
      const { config, redisSub, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const emitMock = jest.fn();
      const originalTo = io.to.bind(io);
      io.to = jest.fn((room: string) => {
        const result = originalTo(room);
        result.emit = emitMock;
        return result;
      }) as any;

      const channel = streamChannel("KitKat");
      redisSub.emit("message", channel, "plain text output");

      expect(emitMock).toHaveBeenCalledWith(
        "worker:output",
        expect.objectContaining({
          workerName: "KitKat",
          type: "output",
          content: "plain text output",
        }),
      );
    });

    it("emits worker:completed on completion messages", async () => {
      const { config, redisSub, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const emitMock = jest.fn();
      const originalTo = io.to.bind(io);
      io.to = jest.fn((room: string) => {
        const result = originalTo(room);
        result.emit = emitMock;
        return result;
      }) as any;

      const payload = JSON.stringify({
        agent: "Snickers",
        summary: "Added auth middleware",
        pr_url: "https://github.com/org/repo/pull/42",
        timestamp: 1706745600000,
      });
      redisSub.emit("message", COMPLETIONS_CHANNEL, payload);

      expect(io.to).toHaveBeenCalledWith("worker:Snickers");
      expect(emitMock).toHaveBeenCalledWith(
        "worker:completed",
        expect.objectContaining({
          workerName: "Snickers",
          summary: "Added auth middleware",
          prUrl: "https://github.com/org/repo/pull/42",
        }),
      );
    });
  });

  describe("StateManager event forwarding", () => {
    it("emits worker:status on state change", async () => {
      const { config, io, stateManager } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const emitMock = jest.fn();
      const originalTo = io.to.bind(io);
      io.to = jest.fn((room: string) => {
        const result = originalTo(room);
        result.emit = emitMock;
        return result;
      }) as any;

      // Simulate state change
      stateManager.emit("workerUpdated", "test-repo", {
        name: "Snickers",
        status: "stuck",
        error: "No activity",
      });

      expect(io.to).toHaveBeenCalledWith("worker:Snickers");
      expect(emitMock).toHaveBeenCalledWith(
        "worker:status",
        expect.objectContaining({
          workerName: "Snickers",
          status: "stuck",
          error: "No activity",
        }),
      );
    });
  });
});
