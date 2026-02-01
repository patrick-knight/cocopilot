/**
 * Tests for the Chocolatier (supervisor) agent.
 */

import { Chocolatier, CHOCOLATIER_SYSTEM_PROMPT } from "./chocolatier.js";
import type { ChocolatierConfig } from "./types.js";
import type { StateManager } from "../state/index.js";
import type { ContainerManager } from "../docker/index.js";
import { ContainerStatus, ContainerType } from "../docker/index.js";
import type { MessageBroker } from "../messaging/index.js";
import { MessageType } from "../messaging/index.js";
import type { CocoMessage } from "../messaging/index.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockStateManager(): jest.Mocked<StateManager> {
  return {
    getRepo: jest.fn(),
    getRepos: jest.fn().mockReturnValue({}),
    getConfig: jest.fn().mockReturnValue({}),
    getBaseDir: jest.fn().mockReturnValue("/tmp/.cocopilot"),
    setAgent: jest.fn().mockResolvedValue({
      name: "chocolatier",
      type: "supervisor",
      status: "healthy",
      lastActivity: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    }),
    updateAgentStatus: jest.fn().mockResolvedValue({
      name: "chocolatier",
      type: "supervisor",
      status: "healthy",
      lastActivity: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    }),
    addWorker: jest.fn(),
    updateWorkerStatus: jest.fn(),
    nextWorkerName: jest.fn().mockReturnValue("Snickers"),
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
  } as unknown as jest.Mocked<StateManager>;
}

function createMockContainerManager(): jest.Mocked<ContainerManager> {
  return {
    spawn: jest.fn(),
    stop: jest.fn(),
    remove: jest.fn(),
    destroy: jest.fn(),
    list: jest.fn().mockResolvedValue([]),
    inspect: jest.fn(),
    logs: jest.fn(),
    ping: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<ContainerManager>;
}

function createMockBroker(): jest.Mocked<MessageBroker> {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue({ id: "msg-1" }),
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    acknowledge: jest.fn().mockResolvedValue(true),
    replay: jest.fn().mockResolvedValue([]),
    getPending: jest.fn().mockResolvedValue([]),
    getHistory: jest.fn().mockResolvedValue([]),
    cleanup: jest.fn().mockResolvedValue(0),
    deleteMessage: jest.fn().mockResolvedValue(true),
    close: jest.fn().mockResolvedValue(undefined),
    isReady: true,
    redisBus: {
      isReady: true,
      publishRaw: jest.fn().mockResolvedValue(undefined),
    } as any,
  } as unknown as jest.Mocked<MessageBroker>;
}

function createConfig(
  overrides?: Partial<ChocolatierConfig>,
): ChocolatierConfig {
  return {
    repoName: "test-repo",
    agentImage: "cocopilot-agent:latest",
    containerMemoryLimit: "4g",
    containerCpuLimit: "2",
    workerRuntime: "container",
    healthCheckIntervalMs: 60_000, // 1 minute for tests
    stuckThresholdMs: 15 * 60_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Chocolatier", () => {
  let stateManager: jest.Mocked<StateManager>;
  let containerManager: jest.Mocked<ContainerManager>;
  let broker: jest.Mocked<MessageBroker>;
  let chocolatier: Chocolatier;

  beforeEach(() => {
    stateManager = createMockStateManager();
    containerManager = createMockContainerManager();
    broker = createMockBroker();
    chocolatier = new Chocolatier(
      stateManager,
      containerManager,
      broker,
      createConfig(),
    );
  });

  afterEach(async () => {
    if (chocolatier.isRunning) {
      await chocolatier.stop();
    }
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  describe("start/stop", () => {
    it("should register agent and subscribe to messages on start", async () => {
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await chocolatier.start();

      expect(chocolatier.isRunning).toBe(true);
      expect(stateManager.setAgent).toHaveBeenCalledWith("test-repo", {
        name: "chocolatier:test-repo",
        type: "supervisor",
        status: "healthy",
      });
      expect(broker.subscribe).toHaveBeenCalledWith(
        "chocolatier:test-repo",
        expect.any(Function),
      );
    });

    it("should unsubscribe and update status on stop", async () => {
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await chocolatier.start();
      await chocolatier.stop();

      expect(chocolatier.isRunning).toBe(false);
      expect(broker.unsubscribe).toHaveBeenCalledWith("chocolatier:test-repo");
      expect(stateManager.updateAgentStatus).toHaveBeenCalledWith(
        "test-repo",
        "chocolatier:test-repo",
        "stopped",
      );
    });

    it("should be idempotent for start", async () => {
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await chocolatier.start();
      await chocolatier.start(); // second call should be no-op

      expect(broker.subscribe).toHaveBeenCalledTimes(1);
    });

    it("should emit started/stopped events", async () => {
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const startedSpy = jest.fn();
      const stoppedSpy = jest.fn();
      chocolatier.on("started", startedSpy);
      chocolatier.on("stopped", stoppedSpy);

      await chocolatier.start();
      expect(startedSpy).toHaveBeenCalledTimes(1);

      await chocolatier.stop();
      expect(stoppedSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // list_workers
  // -----------------------------------------------------------------------

  describe("listWorkers", () => {
    it("should return empty array when repo not found", async () => {
      stateManager.getRepo.mockReturnValue(undefined);
      const result = await chocolatier.listWorkers();
      expect(result).toEqual([]);
    });

    it("should return empty array when no workers exist", async () => {
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const result = await chocolatier.listWorkers();
      expect(result).toEqual([]);
    });

    it("should list workers with container status", async () => {
      const now = new Date().toISOString();
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {
          Snickers: {
            id: "w-1",
            name: "Snickers",
            task: "Add tests",
            branch: "work/Snickers",
            status: "working",
            containerId: "c-1",
            createdAt: now,
            updatedAt: now,
          },
        },
        createdAt: now,
        updatedAt: now,
      });

      containerManager.list.mockResolvedValue([
        {
          id: "c-1",
          name: "cocopilot-truffle-snickers",
          type: ContainerType.TRUFFLE,
          workerName: "Snickers",
          status: ContainerStatus.RUNNING,
          image: "cocopilot-agent:latest",
          createdAt: now,
          labels: {},
        },
      ]);

      const result = await chocolatier.listWorkers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "Snickers",
        task: "Add tests",
        branch: "work/Snickers",
        status: "working",
        containerId: "c-1",
        containerStatus: ContainerStatus.RUNNING,
        prNumber: undefined,
        prUrl: undefined,
        createdAt: now,
        updatedAt: now,
      });
    });

    it("should handle container list failure gracefully", async () => {
      const now = new Date().toISOString();
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {
          KitKat: {
            id: "w-2",
            name: "KitKat",
            task: "Fix bug",
            branch: "work/KitKat",
            status: "working",
            createdAt: now,
            updatedAt: now,
          },
        },
        createdAt: now,
        updatedAt: now,
      });

      containerManager.list.mockRejectedValue(new Error("Docker not available"));

      const result = await chocolatier.listWorkers();
      expect(result).toHaveLength(1);
      expect(result[0].containerStatus).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // spawn_worker
  // -----------------------------------------------------------------------

  describe("spawnWorker", () => {
    it("should create worker state, spawn container, and send message", async () => {
      const now = new Date().toISOString();
      const worker = {
        id: "w-1",
        name: "Snickers",
        task: "Add auth",
        branch: "work/Snickers",
        status: "starting" as const,
        createdAt: now,
        updatedAt: now,
      };

      stateManager.addWorker.mockResolvedValue(worker);
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {},
        createdAt: now,
        updatedAt: now,
      });

      containerManager.spawn.mockResolvedValue({
        id: "container-abc",
        name: "cocopilot-truffle-snickers",
        type: ContainerType.TRUFFLE,
        workerName: "Snickers",
        status: ContainerStatus.RUNNING,
        image: "cocopilot-agent:latest",
        createdAt: now,
        labels: {},
      });

      stateManager.updateWorkerStatus.mockResolvedValue({
        ...worker,
        status: "working",
        containerId: "container-abc",
      });

      const result = await chocolatier.spawnWorker({ task: "Add auth" });

      expect(result.name).toBe("Snickers");
      expect(stateManager.addWorker).toHaveBeenCalledWith("test-repo", {
        task: "Add auth",
        branch: undefined,
        name: undefined,
        model: undefined,
      });

      expect(containerManager.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ContainerType.TRUFFLE,
          name: "Snickers",
          env: expect.objectContaining({
            COCOPILOT_TASK: "Add auth",
            COCOPILOT_BRANCH: "work/Snickers",
          }),
        }),
      );

      expect(stateManager.updateWorkerStatus).toHaveBeenCalledWith(
        "test-repo",
        "Snickers",
        "working",
        { containerId: "container-abc" },
      );

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.TASK_ASSIGNED,
          from: "chocolatier:test-repo",
          to: "Snickers:test-repo",
          payload: expect.objectContaining({ task: "Add auth" }),
        }),
      );
    });

    it("should mark worker as failed when container spawn fails", async () => {
      const now = new Date().toISOString();
      stateManager.addWorker.mockResolvedValue({
        id: "w-1",
        name: "KitKat",
        task: "Fix bug",
        branch: "work/KitKat",
        status: "starting" as const,
        createdAt: now,
        updatedAt: now,
      });
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {},
        createdAt: now,
        updatedAt: now,
      });

      containerManager.spawn.mockRejectedValue(new Error("Out of memory"));

      await expect(
        chocolatier.spawnWorker({ task: "Fix bug" }),
      ).rejects.toThrow("Out of memory");

      expect(stateManager.updateWorkerStatus).toHaveBeenCalledWith(
        "test-repo",
        "KitKat",
        "failed",
        { error: "Container spawn failed: Out of memory" },
      );
    });
  });

  // -----------------------------------------------------------------------
  // nudge_worker
  // -----------------------------------------------------------------------

  describe("nudgeWorker", () => {
    it("should send a NUDGE message to the worker", async () => {
      await chocolatier.nudgeWorker("Snickers", "Try checking the logs");

      expect(broker.send).toHaveBeenCalledWith({
        type: MessageType.NUDGE,
        from: "chocolatier:test-repo",
        to: "Snickers:test-repo",
        payload: { hint: "Try checking the logs", context: undefined },
        priority: "high",
      });
    });

    it("should include context when provided", async () => {
      await chocolatier.nudgeWorker(
        "KitKat",
        "The test is flaky",
        "It fails intermittently on CI",
      );

      expect(broker.send).toHaveBeenCalledWith({
        type: MessageType.NUDGE,
        from: "chocolatier:test-repo",
        to: "KitKat:test-repo",
        payload: {
          hint: "The test is flaky",
          context: "It fails intermittently on CI",
        },
        priority: "high",
      });
    });
  });

  // -----------------------------------------------------------------------
  // broadcast
  // -----------------------------------------------------------------------

  describe("broadcast", () => {
    it("should send a BROADCAST message to all agents", async () => {
      await chocolatier.broadcast("System restarting");

      expect(broker.send).toHaveBeenCalledWith({
        type: MessageType.BROADCAST,
        from: "chocolatier:test-repo",
        to: "*",
        payload: { message: "System restarting", level: "info" },
      });
    });

    it("should support warning/error levels", async () => {
      await chocolatier.broadcast("CI failing", "error");

      expect(broker.send).toHaveBeenCalledWith({
        type: MessageType.BROADCAST,
        from: "chocolatier:test-repo",
        to: "*",
        payload: { message: "CI failing", level: "error" },
      });
    });
  });

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  describe("handleMessage", () => {
    it("should respond to STATUS_REQUEST", async () => {
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Mark as running for the status response
      await chocolatier.start();

      const message: CocoMessage = {
        id: "msg-1",
        type: MessageType.STATUS_REQUEST,
        from: "temperer",
        to: "chocolatier",
        payload: { request_id: "req-1" },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      };

      // Get the handler that was registered during subscribe
      const handler = broker.subscribe.mock.calls[0][1];
      await handler(message);

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.STATUS_RESPONSE,
          from: "chocolatier:test-repo",
          to: "temperer",
          payload: expect.objectContaining({
            request_id: "req-1",
            status: "healthy",
          }),
        }),
      );
    });

    it("should handle TASK_COMPLETE and update worker state", async () => {
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      stateManager.updateWorkerStatus.mockResolvedValue({
        id: "w-1",
        name: "Snickers",
        task: "Add tests",
        branch: "work/Snickers",
        status: "completed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const message: CocoMessage = {
        id: "msg-2",
        type: MessageType.TASK_COMPLETE,
        from: "Snickers",
        to: "chocolatier",
        payload: {
          summary: "Added 15 unit tests",
          pr_url: "https://github.com/test/repo/pull/42",
        },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: true,
      };

      await chocolatier.handleMessage(message);

      expect(stateManager.updateWorkerStatus).toHaveBeenCalledWith(
        "test-repo",
        "Snickers",
        "completed",
        { prUrl: "https://github.com/test/repo/pull/42" },
      );

      // Should acknowledge the message
      expect(broker.acknowledge).toHaveBeenCalledWith("chocolatier:test-repo", "msg-2");

      // Should broadcast completion
      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.BROADCAST,
          payload: expect.objectContaining({
            message: expect.stringContaining("Snickers completed"),
          }),
        }),
      );
    });

    it("should handle TASK_FAILED and update worker state", async () => {
      stateManager.updateWorkerStatus.mockResolvedValue({
        id: "w-1",
        name: "KitKat",
        task: "Fix bug",
        branch: "work/KitKat",
        status: "failed",
        error: "Compilation error",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const message: CocoMessage = {
        id: "msg-3",
        type: MessageType.TASK_FAILED,
        from: "KitKat",
        to: "chocolatier",
        payload: {
          error: "Compilation error",
          task: "Fix bug",
          recoverable: false,
        },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      };

      const failedSpy = jest.fn();
      chocolatier.on("workerFailed", failedSpy);

      await chocolatier.handleMessage(message);

      expect(stateManager.updateWorkerStatus).toHaveBeenCalledWith(
        "test-repo",
        "KitKat",
        "failed",
        { error: "Compilation error" },
      );
      expect(failedSpy).toHaveBeenCalledWith(
        "test-repo",
        "KitKat",
        "Compilation error",
      );
    });

    it("should handle SPAWN_FIXUP by spawning a new worker", async () => {
      const now = new Date().toISOString();
      stateManager.addWorker.mockResolvedValue({
        id: "w-fix",
        name: "Twix",
        task: "Fix CI",
        branch: "work/Twix",
        status: "starting",
        createdAt: now,
        updatedAt: now,
      });
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {},
        createdAt: now,
        updatedAt: now,
      });
      containerManager.spawn.mockResolvedValue({
        id: "c-fix",
        name: "cocopilot-truffle-twix",
        type: ContainerType.TRUFFLE,
        workerName: "Twix",
        status: ContainerStatus.RUNNING,
        image: "cocopilot-agent:latest",
        createdAt: now,
        labels: {},
      });
      stateManager.updateWorkerStatus.mockResolvedValue({
        id: "w-fix",
        name: "Twix",
        task: "Fix CI",
        branch: "work/Twix",
        status: "working",
        containerId: "c-fix",
        createdAt: now,
        updatedAt: now,
      });

      const message: CocoMessage = {
        id: "msg-4",
        type: MessageType.SPAWN_FIXUP,
        from: "temperer",
        to: "chocolatier",
        payload: {
          pr_number: 47,
          pr_url: "https://github.com/test/repo/pull/47",
          failure_summary: "Test suite failed: 3 tests",
          original_worker: "Snickers",
        },
        priority: "high",
        timestamp: Date.now(),
        ack_required: false,
      };

      await chocolatier.handleMessage(message);

      expect(stateManager.addWorker).toHaveBeenCalledWith(
        "test-repo",
        expect.objectContaining({
          task: expect.stringContaining("Fix CI failure on PR #47"),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------

  describe("runHealthCheck", () => {
    it("should return empty report when repo not found", async () => {
      stateManager.getRepo.mockReturnValue(undefined);
      const report = await chocolatier.runHealthCheck();
      expect(report.workers).toEqual([]);
      expect(report.issues).toEqual([]);
    });

    it("should skip completed/failed/terminated workers", async () => {
      const now = new Date().toISOString();
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {
          Snickers: {
            id: "w-1",
            name: "Snickers",
            task: "Done task",
            branch: "work/Snickers",
            status: "completed",
            createdAt: now,
            updatedAt: now,
          },
        },
        createdAt: now,
        updatedAt: now,
      });

      const report = await chocolatier.runHealthCheck();
      expect(report.workers).toHaveLength(0);
    });

    it("should detect stuck workers", async () => {
      const longAgo = new Date(
        Date.now() - 20 * 60_000, // 20 minutes ago
      ).toISOString();
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {
          Snickers: {
            id: "w-1",
            name: "Snickers",
            task: "Stuck task",
            branch: "work/Snickers",
            status: "working",
            containerId: "c-1",
            createdAt: longAgo,
            updatedAt: longAgo,
          },
        },
        createdAt: longAgo,
        updatedAt: longAgo,
      });

      containerManager.list.mockResolvedValue([
        {
          id: "c-1",
          name: "cocopilot-truffle-snickers",
          type: ContainerType.TRUFFLE,
          workerName: "Snickers",
          status: ContainerStatus.RUNNING,
          image: "cocopilot-agent:latest",
          createdAt: longAgo,
          labels: {},
        },
      ]);

      const stuckSpy = jest.fn();
      chocolatier.on("workerStuck", stuckSpy);

      const report = await chocolatier.runHealthCheck();

      expect(report.issues).toHaveLength(1);
      expect(report.issues[0].name).toBe("Snickers");
      expect(report.issues[0].isStuck).toBe(true);
      expect(stuckSpy).toHaveBeenCalledWith("test-repo", "Snickers");

      // Should update status to stuck
      expect(stateManager.updateWorkerStatus).toHaveBeenCalledWith(
        "test-repo",
        "Snickers",
        "stuck",
      );

      // Should send nudge
      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.NUDGE,
          to: "Snickers:test-repo",
        }),
      );
    });

    it("should detect missing containers", async () => {
      const now = new Date().toISOString();
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {
          KitKat: {
            id: "w-2",
            name: "KitKat",
            task: "Missing container",
            branch: "work/KitKat",
            status: "working",
            containerId: "c-gone",
            createdAt: now,
            updatedAt: now,
          },
        },
        createdAt: now,
        updatedAt: now,
      });

      // No containers returned from Docker
      containerManager.list.mockResolvedValue([]);

      const missingSpy = jest.fn();
      chocolatier.on("workerContainerMissing", missingSpy);

      const report = await chocolatier.runHealthCheck();

      expect(report.issues).toHaveLength(1);
      expect(report.issues[0].name).toBe("KitKat");
      expect(report.issues[0].containerMissing).toBe(true);
      expect(missingSpy).toHaveBeenCalledWith("test-repo", "KitKat");

      // Should mark worker as failed
      expect(stateManager.updateWorkerStatus).toHaveBeenCalledWith(
        "test-repo",
        "KitKat",
        "failed",
        { error: "Container disappeared unexpectedly" },
      );
    });

    it("should report healthy workers without issues", async () => {
      const now = new Date().toISOString();
      stateManager.getRepo.mockReturnValue({
        id: "repo-1",
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/tmp/repo",
        mode: "single-player",
        status: "active",
        defaultBranch: "main",
        agents: {},
        workers: {
          Snickers: {
            id: "w-1",
            name: "Snickers",
            task: "Healthy task",
            branch: "work/Snickers",
            status: "working",
            containerId: "c-1",
            createdAt: now,
            updatedAt: now,
          },
        },
        createdAt: now,
        updatedAt: now,
      });

      containerManager.list.mockResolvedValue([
        {
          id: "c-1",
          name: "cocopilot-truffle-snickers",
          type: ContainerType.TRUFFLE,
          workerName: "Snickers",
          status: ContainerStatus.RUNNING,
          image: "cocopilot-agent:latest",
          createdAt: now,
          labels: {},
        },
      ]);

      const report = await chocolatier.runHealthCheck();

      expect(report.workers).toHaveLength(1);
      expect(report.issues).toHaveLength(0);
      expect(report.workers[0].isStuck).toBe(false);
      expect(report.workers[0].containerMissing).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Tool definitions
  // -----------------------------------------------------------------------

  describe("getToolDefinitions", () => {
    it("should return three tool definitions", () => {
      const tools = chocolatier.getToolDefinitions();
      expect(tools).toHaveLength(3);

      const names = tools.map((t) => t.name);
      expect(names).toContain("list_workers");
      expect(names).toContain("spawn_worker");
      expect(names).toContain("nudge_worker");
    });

    it("should have required parameters for spawn_worker", () => {
      const tools = chocolatier.getToolDefinitions();
      const spawnTool = tools.find((t) => t.name === "spawn_worker")!;
      expect(spawnTool.parameters.required).toContain("task");
    });

    it("should have required parameters for nudge_worker", () => {
      const tools = chocolatier.getToolDefinitions();
      const nudgeTool = tools.find((t) => t.name === "nudge_worker")!;
      expect(nudgeTool.parameters.required).toContain("worker_name");
      expect(nudgeTool.parameters.required).toContain("hint");
    });
  });

  // -----------------------------------------------------------------------
  // System prompt
  // -----------------------------------------------------------------------

  describe("getSystemPrompt", () => {
    it("should return the system prompt", () => {
      const prompt = chocolatier.getSystemPrompt();
      expect(prompt).toBe(CHOCOLATIER_SYSTEM_PROMPT);
      expect(prompt).toContain("Chocolatier");
      expect(prompt).toContain("supervisor");
    });
  });
});
