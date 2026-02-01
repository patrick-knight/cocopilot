/**
 * Tests for the WorkerStreamManager (Socket.IO <-> Redis bridge).
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
  emitMock = jest.fn();

  to(room: string) {
    const self = this;
    return {
      emit: jest.fn((event: string, data: unknown) => {
        self.emitMock(room, event, data);
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
      // Use a very short batch window so tests run quickly
      batchWindowMs: 10,
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
      await manager.stop();

      expect(redisSub.subscribe).toHaveBeenCalledWith(COMPLETIONS_CHANNEL);
    });

    it("does nothing when called twice", async () => {
      const { config, redisSub } = createConfig();
      const manager = new WorkerStreamManager(config);

      await manager.start();
      await manager.start();
      await manager.stop();

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

      await manager.stop();
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

      await manager.stop();
    });

    it("rejects worker names exceeding MAX_NAME_LENGTH", async () => {
      const { config, redisSub, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const socket = new MockSocket();
      io.emit("connection", socket);

      // Create a name that exceeds 128 characters
      const longName = "a".repeat(129);
      socket.emit("worker:join", longName);

      await new Promise((r) => setTimeout(r, 10));

      // Should not subscribe to the worker channel
      expect(redisSub.subscribe).toHaveBeenCalledTimes(1); // Only completions channel
      expect(socket.join).not.toHaveBeenCalled();

      await manager.stop();
    });

    it("rejects worker names with invalid characters", async () => {
      const { config, redisSub, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const socket = new MockSocket();
      io.emit("connection", socket);

      // Test various invalid characters
      socket.emit("worker:join", "worker:name"); // colon
      socket.emit("worker:join", "worker/name"); // slash
      socket.emit("worker:join", "worker name"); // space
      socket.emit("worker:join", "worker@name"); // at sign
      socket.emit("worker:join", "worker#name"); // hash
      socket.emit("worker:join", "worker$name"); // dollar sign

      await new Promise((r) => setTimeout(r, 10));

      // Should not subscribe to any worker channels
      expect(redisSub.subscribe).toHaveBeenCalledTimes(1); // Only completions channel
      expect(socket.join).not.toHaveBeenCalled();

      await manager.stop();
    });

    it("accepts worker names with valid characters (alphanumeric, dot, dash, underscore)", async () => {
      const { config, redisSub, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const socket = new MockSocket();
      io.emit("connection", socket);

      // Test valid names with different character combinations
      socket.emit("worker:join", "worker-name");
      await new Promise((r) => setTimeout(r, 10));
      
      socket.emit("worker:join", "worker_name");
      await new Promise((r) => setTimeout(r, 10));
      
      socket.emit("worker:join", "worker.name");
      await new Promise((r) => setTimeout(r, 10));
      
      socket.emit("worker:join", "WorkerName123");
      await new Promise((r) => setTimeout(r, 10));
      
      socket.emit("worker:join", "worker-name_123.test");
      await new Promise((r) => setTimeout(r, 10));

      // All 5 valid names should be subscribed (+ 1 completions channel = 6 total)
      expect(redisSub.subscribe).toHaveBeenCalledTimes(6);
      expect(socket.join).toHaveBeenCalledTimes(5);

      await manager.stop();
    });

    it("joins repo room on repo:join event", async () => {
      const { config, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const socket = new MockSocket();
      io.emit("connection", socket);

      socket.emit("repo:join", "my-repo");

      await new Promise((r) => setTimeout(r, 10));

      expect(socket.join).toHaveBeenCalledWith("repo:my-repo");

      await manager.stop();
    });

    it("leaves repo room on repo:leave event", async () => {
      const { config, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const socket = new MockSocket();
      io.emit("connection", socket);

      socket.emit("repo:leave", "my-repo");

      await new Promise((r) => setTimeout(r, 10));

      expect(socket.leave).toHaveBeenCalledWith("repo:my-repo");

      await manager.stop();
    });

    it("ignores invalid repo identifiers", async () => {
      const { config, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const socket = new MockSocket();
      io.emit("connection", socket);

      socket.emit("repo:join", "");
      socket.emit("repo:join", 42);

      await new Promise((r) => setTimeout(r, 10));

      expect(socket.join).not.toHaveBeenCalled();

      await manager.stop();
    });

    it("rejects repo identifiers exceeding MAX_NAME_LENGTH", async () => {
      const { config, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const socket = new MockSocket();
      io.emit("connection", socket);

      // Create a repo ID that exceeds 128 characters
      const longRepoId = "a".repeat(129);
      socket.emit("repo:join", longRepoId);

      await new Promise((r) => setTimeout(r, 10));

      expect(socket.join).not.toHaveBeenCalled();

      await manager.stop();
    });

    it("rejects repo identifiers with invalid characters", async () => {
      const { config, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const socket = new MockSocket();
      io.emit("connection", socket);

      // Test various invalid characters
      socket.emit("repo:join", "repo:name"); // colon
      socket.emit("repo:join", "repo/name"); // slash (though GitHub uses this, socket rooms shouldn't)
      socket.emit("repo:join", "repo name"); // space
      socket.emit("repo:join", "repo@name"); // at sign

      await new Promise((r) => setTimeout(r, 10));

      expect(socket.join).not.toHaveBeenCalled();

      await manager.stop();
    });

    it("accepts repo identifiers with valid characters (alphanumeric, dot, dash, underscore)", async () => {
      const { config, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const socket = new MockSocket();
      io.emit("connection", socket);

      // Test valid repo IDs with different character combinations
      socket.emit("repo:join", "my-repo");
      await new Promise((r) => setTimeout(r, 10));
      
      socket.emit("repo:join", "my_repo");
      await new Promise((r) => setTimeout(r, 10));
      
      socket.emit("repo:join", "my.repo");
      await new Promise((r) => setTimeout(r, 10));
      
      socket.emit("repo:join", "MyRepo123");
      await new Promise((r) => setTimeout(r, 10));

      // All 4 valid repo IDs should be joined
      expect(socket.join).toHaveBeenCalledTimes(4);

      await manager.stop();
    });
  });

  describe("Redis message handling", () => {
    it("batches worker:output events from stream messages", async () => {
      const { config, redisSub, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      // Simulate Redis message on stream channel
      const channel = streamChannel("Snickers");
      const payload = JSON.stringify({ type: "output", content: "Hello world" });
      redisSub.emit("message", channel, payload);

      // Wait for batch window to flush
      await new Promise((r) => setTimeout(r, 50));

      // The batcher emits as batch:worker:output with an array
      expect(io.emitMock).toHaveBeenCalledWith(
        "worker:Snickers",
        "batch:worker:output",
        expect.arrayContaining([
          expect.objectContaining({
            workerName: "Snickers",
            type: "output",
            content: "Hello world",
          }),
        ]),
      );

      await manager.stop();
    });

    it("batches non-JSON stream messages gracefully", async () => {
      const { config, redisSub, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const channel = streamChannel("KitKat");
      redisSub.emit("message", channel, "plain text output");

      // Wait for batch window to flush
      await new Promise((r) => setTimeout(r, 50));

      expect(io.emitMock).toHaveBeenCalledWith(
        "worker:KitKat",
        "batch:worker:output",
        expect.arrayContaining([
          expect.objectContaining({
            workerName: "KitKat",
            type: "output",
            content: "plain text output",
          }),
        ]),
      );

      await manager.stop();
    });

    it("emits worker:completed on completion messages (not batched)", async () => {
      const { config, redisSub, io } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      const payload = JSON.stringify({
        agent: "Snickers",
        summary: "Added auth middleware",
        pr_url: "https://github.com/org/repo/pull/42",
        timestamp: 1706745600000,
      });
      redisSub.emit("message", COMPLETIONS_CHANNEL, payload);

      // Completion events are emitted immediately (not batched)
      expect(io.emitMock).toHaveBeenCalledWith(
        "worker:Snickers",
        "worker:completed",
        expect.objectContaining({
          workerName: "Snickers",
          summary: "Added auth middleware",
          prUrl: "https://github.com/org/repo/pull/42",
        }),
      );

      await manager.stop();
    });
  });

  describe("StateManager event forwarding", () => {
    it("emits worker:status immediately on state change", async () => {
      const { config, io, stateManager } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      // Simulate state change
      stateManager.emit("workerUpdated", "test-repo", {
        name: "Snickers",
        status: "stuck",
        error: "No activity",
      });

      // Status is emitted immediately to the worker room (not batched)
      expect(io.emitMock).toHaveBeenCalledWith(
        "worker:Snickers",
        "worker:status",
        expect.objectContaining({
          workerName: "Snickers",
          status: "stuck",
          error: "No activity",
        }),
      );

      await manager.stop();
    });

    it("batches worker:status to repo room", async () => {
      const { config, io, stateManager } = createConfig();
      const manager = new WorkerStreamManager(config);
      await manager.start();

      stateManager.emit("workerUpdated", "test-repo", {
        name: "Snickers",
        status: "stuck",
        error: "No activity",
      });

      // Wait for batch window to flush
      await new Promise((r) => setTimeout(r, 50));

      // Should also batch to repo room
      expect(io.emitMock).toHaveBeenCalledWith(
        "repo:test-repo",
        "batch:worker:status",
        expect.arrayContaining([
          expect.objectContaining({
            workerName: "Snickers",
            status: "stuck",
          }),
        ]),
      );

      await manager.stop();
    });
  });
});
