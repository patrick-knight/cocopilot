/**
 * Playwright E2E tests for the CoCoPilot Cocoa Board (web dashboard).
 *
 * Tests critical user flows through the browser:
 *  1. Factory Floor — view repositories, init repo form
 *  2. Repository API — CRUD via REST endpoints
 *  3. Worker API — spawn worker, list workers, delete worker
 *  4. Tempering Station — view repo detail with agents/workers
 *  5. Full user journey — init repo → spawn worker → monitor → merge
 *
 * The test server (tests/e2e/ui/test-server.ts) provides pre-seeded
 * state so we can test the API layer immediately.
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// API Tests — exercise REST endpoints through the browser
// ---------------------------------------------------------------------------

test.describe("REST API - Repositories", () => {
  test("GET /api/v1/repositories returns seeded repository", async ({
    request,
  }) => {
    const response = await request.get("/api/v1/repositories");
    expect(response.ok()).toBeTruthy();

    const repos = await response.json();
    expect(Array.isArray(repos)).toBeTruthy();
    expect(repos.length).toBeGreaterThanOrEqual(1);

    const myApp = repos.find(
      (r: { name: string }) => r.name === "my-app",
    );
    expect(myApp).toBeDefined();
    expect(myApp.mode).toBe("single-player");
    expect(myApp.status).toBe("active");
  });

  test("GET /api/v1/repositories/:name returns specific repo", async ({
    request,
  }) => {
    const response = await request.get("/api/v1/repositories/my-app");
    expect(response.ok()).toBeTruthy();

    const repo = await response.json();
    expect(repo.name).toBe("my-app");
    expect(repo.url).toBe("https://github.com/acme/my-app");
  });

  test("GET /api/v1/repositories/:name returns 404 for missing repo", async ({
    request,
  }) => {
    const response = await request.get("/api/v1/repositories/nonexistent");
    expect(response.status()).toBe(404);
  });

  test("POST /api/v1/repositories creates a new repo", async ({
    request,
  }) => {
    const response = await request.post("/api/v1/repositories", {
      data: {
        name: "pw-test-repo",
        url: "https://github.com/acme/pw-test",
        localPath: "/tmp/pw-test",
        mode: "single-player",
      },
    });

    expect(response.status()).toBe(201);
    const repo = await response.json();
    expect(repo.name).toBe("pw-test-repo");
    expect(repo.status).toBe("initializing");

    // Cleanup
    await request.delete("/api/v1/repositories/pw-test-repo");
  });

  test("POST /api/v1/repositories returns 400 for missing fields", async ({
    request,
  }) => {
    const response = await request.post("/api/v1/repositories", {
      data: { name: "incomplete" },
    });
    expect(response.status()).toBe(400);
  });
});

test.describe("REST API - Workers", () => {
  test("GET /api/v1/repositories/:name/workers lists seeded workers", async ({
    request,
  }) => {
    const response = await request.get(
      "/api/v1/repositories/my-app/workers",
    );
    expect(response.ok()).toBeTruthy();

    const workers = await response.json();
    expect(Array.isArray(workers)).toBeTruthy();
    expect(workers.length).toBeGreaterThanOrEqual(2);

    const names = workers.map((w: { name: string }) => w.name);
    expect(names).toContain("Snickers");
    expect(names).toContain("KitKat");
  });

  test("GET /api/v1/repositories/:name/workers/:workerName returns specific worker", async ({
    request,
  }) => {
    const response = await request.get(
      "/api/v1/repositories/my-app/workers/Snickers",
    );
    expect(response.ok()).toBeTruthy();

    const worker = await response.json();
    expect(worker.name).toBe("Snickers");
    expect(worker.task).toBe("Add unit tests for the user service");
    expect(worker.status).toBe("working");
  });

  test("POST spawns a new worker and DELETE removes it", async ({
    request,
  }) => {
    // Spawn
    const spawnRes = await request.post(
      "/api/v1/repositories/my-app/workers",
      { data: { task: "Playwright spawned worker" } },
    );
    expect(spawnRes.status()).toBe(201);

    const worker = await spawnRes.json();
    expect(worker.task).toBe("Playwright spawned worker");
    expect(worker.status).toBe("starting");
    expect(worker.name).toBeDefined();
    expect(worker.branch).toContain("work/");

    // Verify it appears in list
    const listRes = await request.get(
      "/api/v1/repositories/my-app/workers",
    );
    const workers = await listRes.json();
    const found = workers.find(
      (w: { name: string }) => w.name === worker.name,
    );
    expect(found).toBeDefined();

    // Delete
    const deleteRes = await request.delete(
      `/api/v1/repositories/my-app/workers/${worker.name}`,
    );
    expect(deleteRes.status()).toBe(204);

    // Verify gone
    const checkRes = await request.get(
      `/api/v1/repositories/my-app/workers/${worker.name}`,
    );
    expect(checkRes.status()).toBe(404);
  });

  test("POST returns 400 when task is missing", async ({ request }) => {
    const response = await request.post(
      "/api/v1/repositories/my-app/workers",
      { data: {} },
    );
    expect(response.status()).toBe(400);
  });

  test("POST returns 404 for unknown repository", async ({ request }) => {
    const response = await request.post(
      "/api/v1/repositories/ghost-repo/workers",
      { data: { task: "something" } },
    );
    expect(response.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Agents API Tests
// ---------------------------------------------------------------------------

test.describe("REST API - Agents", () => {
  test("GET /api/v1/repositories/:name/agents lists seeded agents", async ({
    request,
  }) => {
    const response = await request.get(
      "/api/v1/repositories/my-app/agents",
    );
    expect(response.ok()).toBeTruthy();

    const agents = await response.json();
    expect(Array.isArray(agents)).toBeTruthy();
    expect(agents.length).toBeGreaterThanOrEqual(2);

    const names = agents.map((a: { name: string }) => a.name);
    expect(names).toContain("chocolatier");
    expect(names).toContain("temperer");
  });
});

// ---------------------------------------------------------------------------
// Config API Tests
// ---------------------------------------------------------------------------

test.describe("REST API - Config", () => {
  test("GET /api/v1/config returns global configuration", async ({
    request,
  }) => {
    const response = await request.get("/api/v1/config");
    expect(response.ok()).toBeTruthy();

    const config = await response.json();
    expect(config).toHaveProperty("maxWorkersPerRepo");
    expect(config).toHaveProperty("webPort");
  });
});

// ---------------------------------------------------------------------------
// Full User Journey — init repo → spawn worker → verify → cleanup
// ---------------------------------------------------------------------------

test.describe("Full User Journey", () => {
  const journeyRepo = "journey-test-repo";

  test.afterAll(async ({ request }) => {
    // Cleanup: remove any workers and the repo
    try {
      const workersRes = await request.get(
        `/api/v1/repositories/${journeyRepo}/workers`,
      );
      if (workersRes.ok()) {
        const workers = await workersRes.json();
        for (const w of workers) {
          await request.delete(
            `/api/v1/repositories/${journeyRepo}/workers/${w.name}`,
          );
        }
      }
    } catch {
      // ignore
    }
    await request.delete(`/api/v1/repositories/${journeyRepo}`);
  });

  test("complete lifecycle: init → spawn → monitor → cleanup", async ({
    request,
  }) => {
    // Step 1: Initialize repository
    const initRes = await request.post("/api/v1/repositories", {
      data: {
        name: journeyRepo,
        url: "https://github.com/acme/journey-test",
        localPath: "/tmp/journey-test",
        mode: "single-player",
      },
    });
    expect(initRes.status()).toBe(201);
    const repo = await initRes.json();
    expect(repo.name).toBe(journeyRepo);
    expect(repo.status).toBe("initializing");

    // Step 2: Verify repo appears in list
    const listReposRes = await request.get("/api/v1/repositories");
    expect(listReposRes.ok()).toBeTruthy();
    const repos = await listReposRes.json();
    const found = repos.find(
      (r: { name: string }) => r.name === journeyRepo,
    );
    expect(found).toBeDefined();

    // Step 3: Spawn a worker
    const spawnRes = await request.post(
      `/api/v1/repositories/${journeyRepo}/workers`,
      { data: { task: "Implement user authentication" } },
    );
    expect(spawnRes.status()).toBe(201);
    const worker = await spawnRes.json();
    expect(worker.name).toBeDefined();
    expect(worker.task).toBe("Implement user authentication");
    expect(worker.status).toBe("starting");
    expect(worker.branch).toContain("work/");

    // Step 4: Monitor worker — retrieve its details
    const workerDetailRes = await request.get(
      `/api/v1/repositories/${journeyRepo}/workers/${worker.name}`,
    );
    expect(workerDetailRes.ok()).toBeTruthy();
    const detail = await workerDetailRes.json();
    expect(detail.name).toBe(worker.name);
    expect(detail.task).toBe("Implement user authentication");

    // Step 5: Spawn a second worker to test listing
    const spawn2Res = await request.post(
      `/api/v1/repositories/${journeyRepo}/workers`,
      { data: { task: "Add dark mode toggle" } },
    );
    expect(spawn2Res.status()).toBe(201);
    const worker2 = await spawn2Res.json();

    // Step 6: List workers — should have both
    const listWorkersRes = await request.get(
      `/api/v1/repositories/${journeyRepo}/workers`,
    );
    expect(listWorkersRes.ok()).toBeTruthy();
    const workers = await listWorkersRes.json();
    expect(workers.length).toBe(2);

    const workerNames = workers.map((w: { name: string }) => w.name);
    expect(workerNames).toContain(worker.name);
    expect(workerNames).toContain(worker2.name);

    // Step 7: Delete first worker (simulate completed and cleaned up)
    const deleteRes = await request.delete(
      `/api/v1/repositories/${journeyRepo}/workers/${worker.name}`,
    );
    expect(deleteRes.status()).toBe(204);

    // Step 8: Verify only second worker remains
    const remainingRes = await request.get(
      `/api/v1/repositories/${journeyRepo}/workers`,
    );
    const remaining = await remainingRes.json();
    expect(remaining.length).toBe(1);
    expect(remaining[0].name).toBe(worker2.name);

    // Step 9: Delete second worker and the repo
    await request.delete(
      `/api/v1/repositories/${journeyRepo}/workers/${worker2.name}`,
    );
    const deleteRepoRes = await request.delete(
      `/api/v1/repositories/${journeyRepo}`,
    );
    expect(deleteRepoRes.status()).toBe(204);

    // Step 10: Verify repo is gone
    const finalCheck = await request.get(
      `/api/v1/repositories/${journeyRepo}`,
    );
    expect(finalCheck.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// WebSocket connectivity test
// ---------------------------------------------------------------------------

test.describe("WebSocket Events", () => {
  test("Socket.IO endpoint is accessible", async ({ request }) => {
    // Socket.IO exposes a polling transport at /socket.io/
    const response = await request.get("/socket.io/?EIO=4&transport=polling");
    // Socket.IO returns 200 with a handshake packet
    expect(response.ok()).toBeTruthy();
    const text = await response.text();
    // The response should contain the sid (session ID)
    expect(text).toContain("sid");
  });
});
