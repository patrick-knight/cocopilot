/**
 * Tests for the worker detail API routes.
 */

import {
  registerWorkerRoutes,
  type WorkerRouteDeps,
  type ExpressRouter,
} from "./workers.js";
import type { StateManager } from "../../state/index.js";
import type { ContainerManager } from "../../docker/index.js";
import { ContainerStatus } from "../../docker/index.js";
import type { MessageBroker } from "../../messaging/index.js";
import { MessageType } from "../../messaging/index.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockStateManager(): jest.Mocked<StateManager> {
  return {
    getWorker: jest.fn(),
    updateWorkerStatus: jest.fn().mockResolvedValue({
      id: "w-1",
      name: "Snickers",
      task: "Test task",
      branch: "work/Snickers",
      status: "terminated",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T01:00:00.000Z",
    }),
  } as unknown as jest.Mocked<StateManager>;
}

function createMockContainerManager(): jest.Mocked<ContainerManager> {
  return {
    inspect: jest.fn(),
    logs: jest.fn(),
    stop: jest.fn(),
    destroy: jest.fn(),
    stats: jest.fn().mockResolvedValue({
      memoryUsage: 256 * 1024 * 1024,
      memoryLimit: 4096 * 1024 * 1024,
      cpuPercent: 12.5,
    }),
  } as unknown as jest.Mocked<ContainerManager>;
}

function createMockBroker(): jest.Mocked<MessageBroker> {
  return {
    send: jest.fn().mockResolvedValue({ id: "msg-1" }),
    getHistory: jest.fn().mockResolvedValue([]),
    redisBus: {
      isReady: true,
      publishRaw: jest.fn().mockResolvedValue(undefined),
    } as any,
  } as unknown as jest.Mocked<MessageBroker>;
}

function createDeps(): {
  deps: WorkerRouteDeps;
  stateManager: jest.Mocked<StateManager>;
  containerManager: jest.Mocked<ContainerManager>;
  messageBroker: jest.Mocked<MessageBroker>;
} {
  const stateManager = createMockStateManager();
  const containerManager = createMockContainerManager();
  const messageBroker = createMockBroker();

  return {
    deps: { stateManager, containerManager, messageBroker },
    stateManager,
    containerManager,
    messageBroker,
  };
}

// Minimal mock Express request/response
function mockReq(overrides: {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
} = {}) {
  return {
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: overrides.body ?? {},
  } as any;
}

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as {
    status: jest.Mock;
    json: jest.Mock;
  };
}

/**
 * Mock router that captures registered route handlers.
 */
function createMockRouter(): {
  router: ExpressRouter;
  handlers: Map<string, (...args: any[]) => Promise<void>>;
} {
  const handlers = new Map<string, (...args: any[]) => Promise<void>>();
  const router: ExpressRouter = {
    get(path: string, handler: any) {
      handlers.set(`GET ${path}`, handler);
    },
    post(path: string, handler: any) {
      handlers.set(`POST ${path}`, handler);
    },
  };
  return { router, handlers };
}

// ---------------------------------------------------------------------------
// Worker fixture
// ---------------------------------------------------------------------------

const WORKER_FIXTURE = {
  id: "w-1",
  name: "Snickers",
  task: "Add authentication middleware",
  branch: "work/Snickers",
  status: "working" as const,
  model: "claude-sonnet-4-5",
  containerId: "container-abc123",
  prNumber: 42,
  prUrl: "https://github.com/org/repo/pull/42",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T01:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Worker Detail Routes", () => {
  describe("registerWorkerRoutes", () => {
    it("registers all expected routes", () => {
      const { deps } = createDeps();
      const { router, handlers } = createMockRouter();

      registerWorkerRoutes(router, deps);

      const paths = Array.from(handlers.keys());
      expect(paths).toContain("GET /:workerName");
      expect(paths).toContain("GET /:workerName/logs");
      expect(paths).toContain("GET /:workerName/messages");
      expect(paths).toContain("POST /:workerName/nudge");
      expect(paths).toContain("POST /:workerName/terminate");
      expect(paths).toContain("POST /:workerName/pause");
      expect(paths).toContain("POST /:workerName/resume");
    });
  });

  describe("GET /:workerName", () => {
    it("returns worker detail when worker exists", async () => {
      const { deps, stateManager, containerManager } = createDeps();
      stateManager.getWorker.mockReturnValue(WORKER_FIXTURE);
      containerManager.inspect.mockResolvedValue({
        id: "container-abc123",
        name: "cocopilot-truffle-Snickers",
        type: "truffle" as any,
        status: ContainerStatus.RUNNING,
        image: "cocopilot-agent:latest",
        createdAt: "2026-01-01T00:00:00.000Z",
        labels: {},
      });

      const { router, handlers } = createMockRouter();
      registerWorkerRoutes(router, deps);
      const handler = handlers.get("GET /:workerName")!;

      const req = mockReq({
        params: { repoName: "test-repo", workerName: "Snickers" },
      });
      const res = mockRes();

      await handler(req, res);

      expect(stateManager.getWorker).toHaveBeenCalledWith("test-repo", "Snickers");
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Snickers",
          task: "Add authentication middleware",
          status: "working",
          containerStatus: ContainerStatus.RUNNING,
        }),
      );
    });

    it("returns 404 when worker not found", async () => {
      const { deps, stateManager } = createDeps();
      stateManager.getWorker.mockReturnValue(undefined);

      const { router, handlers } = createMockRouter();
      registerWorkerRoutes(router, deps);
      const handler = handlers.get("GET /:workerName")!;

      const req = mockReq({
        params: { repoName: "test-repo", workerName: "NonExistent" },
      });
      const res = mockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining("NonExistent") }),
      );
    });
  });

  describe("GET /:workerName/logs", () => {
    it("returns container logs", async () => {
      const { deps, stateManager, containerManager } = createDeps();
      stateManager.getWorker.mockReturnValue(WORKER_FIXTURE);
      containerManager.logs.mockResolvedValue("line 1\nline 2\nline 3\n");

      const { router, handlers } = createMockRouter();
      registerWorkerRoutes(router, deps);
      const handler = handlers.get("GET /:workerName/logs")!;

      const req = mockReq({
        params: { repoName: "test-repo", workerName: "Snickers" },
        query: { tail: "100" },
      });
      const res = mockRes();

      await handler(req, res);

      expect(containerManager.logs).toHaveBeenCalledWith(
        "container-abc123",
        expect.objectContaining({ tail: 100, timestamps: true }),
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ logs: "line 1\nline 2\nline 3\n" }),
      );
    });

    it("returns 404 when worker has no container", async () => {
      const { deps, stateManager } = createDeps();
      stateManager.getWorker.mockReturnValue({
        ...WORKER_FIXTURE,
        containerId: undefined,
      });

      const { router, handlers } = createMockRouter();
      registerWorkerRoutes(router, deps);
      const handler = handlers.get("GET /:workerName/logs")!;

      const req = mockReq({
        params: { repoName: "test-repo", workerName: "Snickers" },
      });
      const res = mockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Worker has no container" }),
      );
    });
  });

  describe("GET /:workerName/messages", () => {
    it("returns messages for the worker", async () => {
      const { deps, messageBroker } = createDeps();
      const mockMessages = [
        {
          id: "msg-1",
          type: "NUDGE",
          from: "chocolatier",
          to: "Snickers",
          payload: { hint: "Try checking logs" },
          priority: "high",
          timestamp: 1706745600000,
          ack_required: false,
        },
      ];
      messageBroker.getHistory.mockResolvedValue(mockMessages as any);

      const { router, handlers } = createMockRouter();
      registerWorkerRoutes(router, deps);
      const handler = handlers.get("GET /:workerName/messages")!;

      const req = mockReq({
        params: { repoName: "test-repo", workerName: "Snickers" },
      });
      const res = mockRes();

      await handler(req, res);

      expect(messageBroker.getHistory).toHaveBeenCalledWith("Snickers");
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ messages: mockMessages }),
      );
    });
  });

  describe("POST /:workerName/nudge", () => {
    it("sends a nudge message to the worker", async () => {
      const { deps, stateManager, messageBroker } = createDeps();
      stateManager.getWorker.mockReturnValue(WORKER_FIXTURE);

      const { router, handlers } = createMockRouter();
      registerWorkerRoutes(router, deps);
      const handler = handlers.get("POST /:workerName/nudge")!;

      const req = mockReq({
        params: { repoName: "test-repo", workerName: "Snickers" },
        body: { message: "Try checking the error logs" },
      });
      const res = mockRes();

      await handler(req, res);

      expect(messageBroker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.NUDGE,
          from: "dashboard",
          to: "Snickers",
          payload: { hint: "Try checking the error logs" },
          priority: "high",
        }),
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ nudged: true, worker: "Snickers" }),
      );
    });

    it("returns 400 when message is missing", async () => {
      const { deps, stateManager } = createDeps();
      stateManager.getWorker.mockReturnValue(WORKER_FIXTURE);

      const { router, handlers } = createMockRouter();
      registerWorkerRoutes(router, deps);
      const handler = handlers.get("POST /:workerName/nudge")!;

      const req = mockReq({
        params: { repoName: "test-repo", workerName: "Snickers" },
        body: {},
      });
      const res = mockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("POST /:workerName/terminate", () => {
    it("destroys container and updates worker status", async () => {
      const { deps, stateManager, containerManager } = createDeps();
      stateManager.getWorker.mockReturnValue(WORKER_FIXTURE);

      const { router, handlers } = createMockRouter();
      registerWorkerRoutes(router, deps);
      const handler = handlers.get("POST /:workerName/terminate")!;

      const req = mockReq({
        params: { repoName: "test-repo", workerName: "Snickers" },
      });
      const res = mockRes();

      await handler(req, res);

      expect(containerManager.destroy).toHaveBeenCalledWith("container-abc123");
      expect(stateManager.updateWorkerStatus).toHaveBeenCalledWith(
        "test-repo",
        "Snickers",
        "terminated",
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ terminated: true, worker: "Snickers" }),
      );
    });

    it("returns 404 when worker not found", async () => {
      const { deps, stateManager } = createDeps();
      stateManager.getWorker.mockReturnValue(undefined);

      const { router, handlers } = createMockRouter();
      registerWorkerRoutes(router, deps);
      const handler = handlers.get("POST /:workerName/terminate")!;

      const req = mockReq({
        params: { repoName: "test-repo", workerName: "Ghost" },
      });
      const res = mockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("POST /:workerName/pause", () => {
    it("stops the container", async () => {
      const { deps, stateManager, containerManager } = createDeps();
      stateManager.getWorker.mockReturnValue(WORKER_FIXTURE);

      const { router, handlers } = createMockRouter();
      registerWorkerRoutes(router, deps);
      const handler = handlers.get("POST /:workerName/pause")!;

      const req = mockReq({
        params: { repoName: "test-repo", workerName: "Snickers" },
      });
      const res = mockRes();

      await handler(req, res);

      expect(containerManager.stop).toHaveBeenCalledWith("container-abc123");
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ paused: true }),
      );
    });

    it("returns 400 when worker has no container", async () => {
      const { deps, stateManager } = createDeps();
      stateManager.getWorker.mockReturnValue({
        ...WORKER_FIXTURE,
        containerId: undefined,
      });

      const { router, handlers } = createMockRouter();
      registerWorkerRoutes(router, deps);
      const handler = handlers.get("POST /:workerName/pause")!;

      const req = mockReq({
        params: { repoName: "test-repo", workerName: "Snickers" },
      });
      const res = mockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("POST /:workerName/resume", () => {
    it("returns 501 not implemented", async () => {
      const { deps, stateManager } = createDeps();
      stateManager.getWorker.mockReturnValue(WORKER_FIXTURE);

      const { router, handlers } = createMockRouter();
      registerWorkerRoutes(router, deps);
      const handler = handlers.get("POST /:workerName/resume")!;

      const req = mockReq({
        params: { repoName: "test-repo", workerName: "Snickers" },
      });
      const res = mockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(501);
    });
  });
});
