/**
 * End-to-end tests for the CoCoPilot REST API.
 *
 * Tests full CRUD flows for repositories and workers using supertest
 * against the real Express app. StateManager is backed by a temp
 * directory so tests are isolated. Docker/GitHub are mocked.
 */

import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import request from "supertest";
import { createServer, type CocoServer } from "../../src/server/app";
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

let tmpDir: string;
let stateManager: StateManager;
let broker: ReturnType<typeof createMockBroker>;
let server: CocoServer;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coco-e2e-api-"));
  stateManager = new StateManager(tmpDir);
  await stateManager.init();
  broker = createMockBroker();
  server = createServer({ stateManager, broker });
});

afterAll(async () => {
  server.cleanup();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Repositories CRUD
// ---------------------------------------------------------------------------

describe("POST /api/v1/repositories", () => {
  it("creates a new repository", async () => {
    const res = await request(server.httpServer)
      .post("/api/v1/repositories")
      .send({
        name: "test-repo",
        url: "https://github.com/acme/test-repo",
        localPath: "/tmp/test-repo",
        mode: "single-player",
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "test-repo",
      url: "https://github.com/acme/test-repo",
      localPath: "/tmp/test-repo",
      mode: "single-player",
      status: "initializing",
    });
    expect(res.body.id).toBeDefined();
    expect(res.body.agents).toEqual({});
    expect(res.body.workers).toEqual({});
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(server.httpServer)
      .post("/api/v1/repositories")
      .send({ name: "partial" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Missing required fields");
  });

  it("returns 409 when repository already exists", async () => {
    const res = await request(server.httpServer)
      .post("/api/v1/repositories")
      .send({
        name: "test-repo",
        url: "https://github.com/acme/test-repo",
        localPath: "/tmp/test-repo",
        mode: "single-player",
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already tracked");
  });
});

describe("GET /api/v1/repositories", () => {
  it("lists all repositories", async () => {
    const res = await request(server.httpServer).get("/api/v1/repositories");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].name).toBe("test-repo");
  });
});

describe("GET /api/v1/repositories/:repoName", () => {
  it("returns a specific repository", async () => {
    const res = await request(server.httpServer).get(
      "/api/v1/repositories/test-repo",
    );

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("test-repo");
    expect(res.body.mode).toBe("single-player");
  });

  it("returns 404 for unknown repository", async () => {
    const res = await request(server.httpServer).get(
      "/api/v1/repositories/nonexistent",
    );

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Workers CRUD (nested under a repository)
// ---------------------------------------------------------------------------

describe("POST /api/v1/repositories/:repoName/workers", () => {
  it("sends spawn request and returns 202", async () => {
    const res = await request(server.httpServer)
      .post("/api/v1/repositories/test-repo/workers")
      .send({ task: "Fix the login bug" });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      status: "accepted",
      task: "Fix the login bug",
    });
    // Broker should have received the SPAWN_WORKER message
    expect(broker.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SPAWN_WORKER",
        to: "chocolatier:test-repo",
        payload: expect.objectContaining({ task: "Fix the login bug" }),
      }),
    );
  });

  it("returns 400 when task is missing", async () => {
    const res = await request(server.httpServer)
      .post("/api/v1/repositories/test-repo/workers")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Missing required field: task");
  });

  it("returns 404 when repository does not exist", async () => {
    const res = await request(server.httpServer)
      .post("/api/v1/repositories/ghost-repo/workers")
      .send({ task: "Something" });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/repositories/:repoName/workers", () => {
  // Pre-populate workers directly in state (Chocolatier would normally do this)
  beforeAll(async () => {
    await stateManager.addWorker("test-repo", {
      task: "Refactor auth",
      name: "KitKat",
      model: "claude-sonnet-4-5",
    });
    await stateManager.addWorker("test-repo", {
      task: "Fix the login bug",
    });
  });

  it("lists all workers in the repository", async () => {
    const res = await request(server.httpServer).get(
      "/api/v1/repositories/test-repo/workers",
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);

    const names = res.body.map((w: { name: string }) => w.name);
    expect(names).toContain("KitKat");
  });

  it("returns 404 for unknown repository", async () => {
    const res = await request(server.httpServer).get(
      "/api/v1/repositories/nonexistent/workers",
    );

    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/repositories/:repoName/workers/:workerName", () => {
  it("returns a specific worker", async () => {
    const res = await request(server.httpServer).get(
      "/api/v1/repositories/test-repo/workers/KitKat",
    );

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("KitKat");
    expect(res.body.task).toBe("Refactor auth");
    expect(res.body.status).toBe("starting");
  });

  it("returns 404 for unknown worker", async () => {
    const res = await request(server.httpServer).get(
      "/api/v1/repositories/test-repo/workers/NonExistent",
    );

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/repositories/:repoName/workers/:workerName", () => {
  it("terminates and removes a worker", async () => {
    const res = await request(server.httpServer).delete(
      "/api/v1/repositories/test-repo/workers/KitKat",
    );

    expect(res.status).toBe(204);

    // Verify worker is gone
    const check = await request(server.httpServer).get(
      "/api/v1/repositories/test-repo/workers/KitKat",
    );
    expect(check.status).toBe(404);
  });

  it("returns 404 for unknown worker", async () => {
    const res = await request(server.httpServer).delete(
      "/api/v1/repositories/test-repo/workers/DoesNotExist",
    );

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Repository deletion (after workers)
// ---------------------------------------------------------------------------

describe("DELETE /api/v1/repositories/:repoName", () => {
  it("removes a tracked repository", async () => {
    const res = await request(server.httpServer).delete(
      "/api/v1/repositories/test-repo",
    );

    expect(res.status).toBe(204);

    // Verify repo is gone
    const check = await request(server.httpServer).get(
      "/api/v1/repositories/test-repo",
    );
    expect(check.status).toBe(404);
  });

  it("returns 404 for unknown repository", async () => {
    const res = await request(server.httpServer).delete(
      "/api/v1/repositories/nonexistent",
    );

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle: create repo -> spawn worker -> list -> delete worker -> delete repo
// ---------------------------------------------------------------------------

describe("full API lifecycle", () => {
  it("completes a full create-use-teardown cycle", async () => {
    // 1. Create repository
    const createRepo = await request(server.httpServer)
      .post("/api/v1/repositories")
      .send({
        name: "lifecycle-repo",
        url: "https://github.com/acme/lifecycle",
        localPath: "/tmp/lifecycle",
        mode: "multiplayer",
      });
    expect(createRepo.status).toBe(201);
    expect(createRepo.body.mode).toBe("multiplayer");

    // 2. Spawn a worker via API (returns 202 - async)
    const spawnWorker = await request(server.httpServer)
      .post("/api/v1/repositories/lifecycle-repo/workers")
      .send({ task: "Add dark mode" });
    expect(spawnWorker.status).toBe(202);
    expect(spawnWorker.body.status).toBe("accepted");

    // Simulate Chocolatier creating the worker in state
    const worker = await stateManager.addWorker("lifecycle-repo", {
      task: "Add dark mode",
    });
    const workerName = worker.name;

    // 3. List workers - should have exactly one
    const listWorkers = await request(server.httpServer).get(
      "/api/v1/repositories/lifecycle-repo/workers",
    );
    expect(listWorkers.status).toBe(200);
    expect(listWorkers.body).toHaveLength(1);
    expect(listWorkers.body[0].name).toBe(workerName);

    // 4. Get specific worker
    const getWorker = await request(server.httpServer).get(
      `/api/v1/repositories/lifecycle-repo/workers/${workerName}`,
    );
    expect(getWorker.status).toBe(200);
    expect(getWorker.body.task).toBe("Add dark mode");

    // 5. Delete worker
    const deleteWorker = await request(server.httpServer).delete(
      `/api/v1/repositories/lifecycle-repo/workers/${workerName}`,
    );
    expect(deleteWorker.status).toBe(204);

    // 6. Confirm worker is gone
    const confirmGone = await request(server.httpServer).get(
      `/api/v1/repositories/lifecycle-repo/workers/${workerName}`,
    );
    expect(confirmGone.status).toBe(404);

    // 7. Delete repository
    const deleteRepo = await request(server.httpServer).delete(
      "/api/v1/repositories/lifecycle-repo",
    );
    expect(deleteRepo.status).toBe(204);

    // 8. Confirm repo is gone
    const confirmRepoGone = await request(server.httpServer).get(
      "/api/v1/repositories/lifecycle-repo",
    );
    expect(confirmRepoGone.status).toBe(404);
  });
});
