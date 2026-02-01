/**
 * Full User Journey E2E Test -- Jest + supertest + Socket.IO client.
 *
 * Chains the complete critical user flow through the API and WebSocket
 * layers:
 *
 *   1. Initialize repository
 *   2. Spawn worker
 *   3. Monitor worker progress (via API + WebSocket events)
 *   4. Simulate PR creation and merge
 *   5. Verify merge recorded and worker completed
 *   6. Tear down repository
 *
 * External dependencies (Docker, GitHub, Redis) are mocked.
 * Tests exercise the real Express server, real StateManager, and
 * real Socket.IO server.
 */

// Mock the copilot SDK to avoid ESM import issues
jest.mock("../../src/copilot/client.js", () => ({
  CopilotClientWrapper: jest.fn(),
}));

import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import request from "supertest";
import {
  io as ioClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import {
  createServer,
  startServer,
  stopServer,
  type CocoServer,
} from "../../src/server/app";
import { StateManager } from "../../src/state/state-manager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockBroker() {
  return {
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue({}),
  } as any;
}

/** Wait for a specific socket event with a timeout. */
function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}" event`)),
      timeoutMs,
    );
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/** Collect N events of a given type. */
function collectEvents<T = unknown>(
  socket: ClientSocket,
  event: string,
  count: number,
  timeoutMs = 5000,
): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    const collected: T[] = [];
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `Timed out collecting ${count} "${event}" events (got ${collected.length})`,
          ),
        ),
      timeoutMs,
    );
    const handler = (data: T) => {
      collected.push(data);
      if (collected.length >= count) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(collected);
      }
    };
    socket.on(event, handler);
  });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let stateManager: StateManager;
let broker: ReturnType<typeof createMockBroker>;
let server: CocoServer;
let serverUrl: string;
let httpServer: ReturnType<typeof server.httpServer.address>;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coco-e2e-journey-"));
  stateManager = new StateManager(tmpDir);
  await stateManager.init();
  broker = createMockBroker();
  server = createServer({ stateManager, broker });
  await startServer(server, 0); // random port
  const address = server.httpServer.address();
  const port =
    typeof address === "object" && address ? address.port : 3000;
  serverUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await stopServer(server);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Full User Journey
// ---------------------------------------------------------------------------

describe("Full user journey: init -> spawn -> monitor -> merge -> cleanup", () => {
  let client: ClientSocket;
  const REPO_NAME = "journey-repo";
  let workerName: string;

  beforeAll((done) => {
    client = ioClient(serverUrl, {
      transports: ["websocket"],
      forceNew: true,
    });
    client.on("connect", done);
  });

  afterAll(() => {
    client?.disconnect();
  });

  // Step 1: Initialize repository
  it("Step 1 -- creates a new repository via API", async () => {
    const res = await request(server.httpServer)
      .post("/api/v1/repositories")
      .send({
        name: REPO_NAME,
        url: "https://github.com/acme/journey",
        localPath: "/tmp/journey",
        mode: "single-player",
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe(REPO_NAME);
    expect(res.body.status).toBe("initializing");
    expect(res.body.mode).toBe("single-player");
    expect(res.body.id).toBeDefined();
  });

  // Step 2: Verify repository appears in listing
  it("Step 2 -- verifies repository appears in list", async () => {
    const res = await request(server.httpServer).get(
      "/api/v1/repositories",
    );

    expect(res.status).toBe(200);
    const found = res.body.find(
      (r: { name: string }) => r.name === REPO_NAME,
    );
    expect(found).toBeDefined();
    expect(found.status).toBe("initializing");
  });

  // Step 3: Set up agents (supervisor + merge queue)
  it("Step 3 -- sets up supervisor and merge queue agents", async () => {
    // Simulate daemon setting up agents via StateManager directly
    await stateManager.setAgent(REPO_NAME, {
      name: "chocolatier",
      type: "supervisor",
      status: "healthy",
    });

    await stateManager.setAgent(REPO_NAME, {
      name: "temperer",
      type: "merge-queue",
      status: "healthy",
    });

    // Verify via API
    const res = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}/agents`,
    );

    expect(res.status).toBe(200);
    const names = res.body.map((a: { name: string }) => a.name);
    expect(names).toContain("chocolatier");
    expect(names).toContain("temperer");
  });

  // Step 4: Spawn a worker (API returns 202, simulate Chocolatier creating worker)
  it("Step 4 -- spawns a worker via API and simulates Chocolatier response", async () => {
    // Request spawn via API
    const res = await request(server.httpServer)
      .post(`/api/v1/repositories/${REPO_NAME}/workers`)
      .send({ task: "Implement JWT authentication middleware" });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("accepted");

    // Simulate Chocolatier creating the worker in state
    const worker = await stateManager.addWorker(REPO_NAME, {
      task: "Implement JWT authentication middleware",
    });
    workerName = worker.name;
    expect(workerName).toBeDefined();

    // Verify worker exists via API
    const getRes = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}/workers/${workerName}`,
    );
    expect(getRes.status).toBe(200);
    expect(getRes.body.task).toBe("Implement JWT authentication middleware");
    expect(getRes.body.status).toBe("starting");
  });

  // Step 5: Monitor worker -- simulate progress via state transitions
  it("Step 5 -- monitors worker status transitions via WebSocket", async () => {
    // Listen for worker_updated event
    const eventPromise = waitForEvent<{
      repository: string;
      worker: { name: string; status: string };
    }>(client, "worker_updated");

    // Simulate daemon updating worker status to "working"
    await stateManager.updateWorkerStatus(REPO_NAME, workerName, "working");

    const event = await eventPromise;
    expect(event.repository).toBe(REPO_NAME);
    expect(event.worker.name).toBe(workerName);
    expect(event.worker.status).toBe("working");

    // Verify via API as well
    const res = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}/workers/${workerName}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("working");
  });

  // Step 6: Worker creates a PR -- simulate via state update
  it("Step 6 -- worker creates a PR", async () => {
    const eventPromise = waitForEvent<{
      repository: string;
      worker: { name: string; status: string; prNumber: number };
    }>(client, "worker_updated");

    // Worker remains "working" but PR metadata is attached
    await stateManager.updateWorkerStatus(
      REPO_NAME,
      workerName,
      "working",
      {
        prNumber: 42,
        prUrl: "https://github.com/acme/journey/pull/42",
      },
    );

    const event = await eventPromise;
    expect(event.worker.prNumber).toBe(42);

    // Verify via API
    const res = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}/workers/${workerName}`,
    );
    expect(res.body.prNumber).toBe(42);
    expect(res.body.prUrl).toBe("https://github.com/acme/journey/pull/42");
  });

  // Step 7: Worker completes -- CI passes and PR merges
  it("Step 7 -- worker completes and PR is merged", async () => {
    const eventPromise = waitForEvent<{
      repository: string;
      worker: { name: string; status: string };
    }>(client, "worker_updated");

    await stateManager.updateWorkerStatus(
      REPO_NAME,
      workerName,
      "completed",
    );

    const event = await eventPromise;
    expect(event.worker.status).toBe("completed");

    // Record the merge
    await stateManager.recordMerge(REPO_NAME);

    // Verify worker completed via API
    const res = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}/workers/${workerName}`,
    );
    expect(res.body.status).toBe("completed");
    expect(res.body.completedAt).toBeDefined();
  });

  // Step 8: Verify merge was recorded on repository
  it("Step 8 -- verifies merge recorded on repository", async () => {
    const res = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.lastMerge).toBeDefined();
  });

  // Step 9: Nudge a worker (send a message)
  it("Step 9 -- can nudge a worker via the API", async () => {
    // Spawn another worker directly in state to nudge
    const worker2 = await stateManager.addWorker(REPO_NAME, {
      task: "Refactor the database layer",
    });

    const nudgeRes = await request(server.httpServer)
      .post(
        `/api/v1/repositories/${REPO_NAME}/workers/${worker2.name}/nudge`,
      )
      .send({ hint: "Try checking the error logs" });

    // Nudge endpoint should succeed (200) or may be 204
    expect([200, 204]).toContain(nudgeRes.status);
  });

  // Step 10: Cleanup -- remove workers and repository
  it("Step 10 -- cleans up workers and repository", async () => {
    // List all workers
    const listRes = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}/workers`,
    );
    expect(listRes.status).toBe(200);

    // Delete each worker
    for (const worker of listRes.body) {
      const deleteRes = await request(server.httpServer).delete(
        `/api/v1/repositories/${REPO_NAME}/workers/${worker.name}`,
      );
      expect(deleteRes.status).toBe(204);
    }

    // Verify no workers remain
    const emptyListRes = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}/workers`,
    );
    expect(emptyListRes.body).toHaveLength(0);

    // Delete repository
    const deleteRepoRes = await request(server.httpServer).delete(
      `/api/v1/repositories/${REPO_NAME}`,
    );
    expect(deleteRepoRes.status).toBe(204);

    // Verify gone
    const checkRes = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}`,
    );
    expect(checkRes.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Concurrent workers test
// ---------------------------------------------------------------------------

describe("Concurrent worker management", () => {
  const REPO_NAME = "concurrent-repo";
  let client: ClientSocket;

  beforeAll(async () => {
    // Create repo
    await request(server.httpServer)
      .post("/api/v1/repositories")
      .send({
        name: REPO_NAME,
        url: "https://github.com/acme/concurrent",
        localPath: "/tmp/concurrent",
        mode: "single-player",
      });

    // Connect WebSocket
    await new Promise<void>((resolve) => {
      client = ioClient(serverUrl, {
        transports: ["websocket"],
        forceNew: true,
      });
      client.on("connect", () => resolve());
    });
  });

  afterAll(async () => {
    client?.disconnect();
    // Cleanup workers
    const listRes = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}/workers`,
    );
    if (listRes.status === 200) {
      for (const w of listRes.body) {
        await request(server.httpServer).delete(
          `/api/v1/repositories/${REPO_NAME}/workers/${w.name}`,
        );
      }
    }
    await request(server.httpServer).delete(
      `/api/v1/repositories/${REPO_NAME}`,
    );
  });

  it("spawns multiple workers and each gets a unique candy name", async () => {
    const tasks = [
      "Add user registration",
      "Implement password reset",
      "Create admin dashboard",
    ];

    const workers = [];
    for (const task of tasks) {
      // Simulate Chocolatier creating each worker directly in state
      const worker = await stateManager.addWorker(REPO_NAME, { task });
      workers.push(worker);
    }

    // All names should be unique
    const names = workers.map((w) => w.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);

    // Each should have a unique branch
    const branches = workers.map((w) => w.branch);
    const uniqueBranches = new Set(branches);
    expect(uniqueBranches.size).toBe(branches.length);
  });

  it("lists all concurrent workers", async () => {
    const res = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}/workers`,
    );
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3);
  });

  it("transitions workers through lifecycle independently", async () => {
    const listRes = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}/workers`,
    );
    const workers = listRes.body;

    // Move first worker to working
    await stateManager.updateWorkerStatus(
      REPO_NAME,
      workers[0].name,
      "working",
    );

    // Move second worker to completed
    await stateManager.updateWorkerStatus(
      REPO_NAME,
      workers[1].name,
      "completed",
    );

    // Third stays as starting

    // Verify each has independent status
    for (const w of workers) {
      const res = await request(server.httpServer).get(
        `/api/v1/repositories/${REPO_NAME}/workers/${w.name}`,
      );
      expect(res.status).toBe(200);
    }

    const w0 = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}/workers/${workers[0].name}`,
    );
    expect(w0.body.status).toBe("working");

    const w1 = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}/workers/${workers[1].name}`,
    );
    expect(w1.body.status).toBe("completed");

    const w2 = await request(server.httpServer).get(
      `/api/v1/repositories/${REPO_NAME}/workers/${workers[2].name}`,
    );
    expect(w2.body.status).toBe("starting");
  });
});

// ---------------------------------------------------------------------------
// Error handling in user flows
// ---------------------------------------------------------------------------

describe("Error handling in user flows", () => {
  it("returns 409 when initializing a duplicate repository", async () => {
    // First create
    await request(server.httpServer)
      .post("/api/v1/repositories")
      .send({
        name: "dupe-test",
        url: "https://github.com/acme/dupe",
        localPath: "/tmp/dupe",
        mode: "single-player",
      });

    // Second create should fail
    const res = await request(server.httpServer)
      .post("/api/v1/repositories")
      .send({
        name: "dupe-test",
        url: "https://github.com/acme/dupe",
        localPath: "/tmp/dupe",
        mode: "single-player",
      });

    expect(res.status).toBe(409);

    // Cleanup
    await request(server.httpServer).delete("/api/v1/repositories/dupe-test");
  });

  it("returns 202 for spawn request (duplicate detection is async via Chocolatier)", async () => {
    await request(server.httpServer)
      .post("/api/v1/repositories")
      .send({
        name: "dupe-worker-test",
        url: "https://github.com/acme/dupe-worker",
        localPath: "/tmp/dupe-worker",
        mode: "single-player",
      });

    // Spawn requests always return 202 (async) - Chocolatier handles duplicates
    const res1 = await request(server.httpServer)
      .post("/api/v1/repositories/dupe-worker-test/workers")
      .send({ task: "First task" });
    expect(res1.status).toBe(202);

    const res2 = await request(server.httpServer)
      .post("/api/v1/repositories/dupe-worker-test/workers")
      .send({ task: "Second task" });
    expect(res2.status).toBe(202);

    // Cleanup
    await request(server.httpServer).delete(
      "/api/v1/repositories/dupe-worker-test",
    );
  });

  it("returns appropriate errors for operations on deleted entities", async () => {
    await request(server.httpServer)
      .post("/api/v1/repositories")
      .send({
        name: "ephemeral-repo",
        url: "https://github.com/acme/ephemeral",
        localPath: "/tmp/ephemeral",
        mode: "single-player",
      });

    // Delete the repo
    await request(server.httpServer).delete(
      "/api/v1/repositories/ephemeral-repo",
    );

    // Operations on deleted repo should return 404
    const getRes = await request(server.httpServer).get(
      "/api/v1/repositories/ephemeral-repo",
    );
    expect(getRes.status).toBe(404);

    const spawnRes = await request(server.httpServer)
      .post("/api/v1/repositories/ephemeral-repo/workers")
      .send({ task: "something" });
    expect(spawnRes.status).toBe(404);

    const agentsRes = await request(server.httpServer).get(
      "/api/v1/repositories/ephemeral-repo/agents",
    );
    expect(agentsRes.status).toBe(404);
  });
});
