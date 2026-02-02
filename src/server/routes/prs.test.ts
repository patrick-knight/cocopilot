import express from "express";
import request from "supertest";
import { prRoutes, workerStatusToStage, workerToPipelineEntry } from "./prs";
import { errorHandler } from "../middleware/error-handler";

function createApp(stateManager: any) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/repositories/:repoName/prs",
    prRoutes(stateManager),
  );
  app.use(errorHandler);
  return app;
}

function makeWorker(overrides: any = {}) {
  return {
    id: "uuid-1",
    name: "Snickers",
    task: "Add auth middleware",
    branch: "work/Snickers",
    status: "working",
    prNumber: 42,
    prUrl: "https://github.com/org/repo/pull/42",
    createdAt: "2026-01-28T10:00:00.000Z",
    updatedAt: "2026-01-28T11:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// workerStatusToStage
// ---------------------------------------------------------------------------

describe("workerStatusToStage", () => {
  it('maps "starting" to "draft"', () => {
    expect(workerStatusToStage("starting")).toBe("draft");
  });

  it('maps "working" to "draft"', () => {
    expect(workerStatusToStage("working")).toBe("draft");
  });

  it('maps "completed" to "ready"', () => {
    expect(workerStatusToStage("completed")).toBe("ready");
  });

  it('maps "stuck" to "ci_running"', () => {
    expect(workerStatusToStage("stuck")).toBe("ci_running");
  });

  it('maps "failed" to "ci_failed"', () => {
    expect(workerStatusToStage("failed")).toBe("ci_failed");
  });

  it('maps "terminated" to "ci_failed"', () => {
    expect(workerStatusToStage("terminated")).toBe("ci_failed");
  });
});

// ---------------------------------------------------------------------------
// workerToPipelineEntry
// ---------------------------------------------------------------------------

describe("workerToPipelineEntry", () => {
  it("converts a worker with a PR into a PRPipelineEntry", () => {
    const worker = makeWorker();
    const entry = workerToPipelineEntry(worker);

    expect(entry).toEqual({
      number: 42,
      title: "Add auth middleware",
      url: "https://github.com/org/repo/pull/42",
      branch: "work/Snickers",
      author: "Snickers",
      stage: "draft",
      workerName: "Snickers",
      createdAt: "2026-01-28T10:00:00.000Z",
      updatedAt: "2026-01-28T11:00:00.000Z",
    });
  });

  it("uses empty string for url when prUrl is undefined", () => {
    const worker = makeWorker({ prUrl: undefined });
    const entry = workerToPipelineEntry(worker);
    expect(entry.url).toBe("");
  });

  it("derives stage from worker status", () => {
    const worker = makeWorker({ status: "completed" });
    const entry = workerToPipelineEntry(worker);
    expect(entry.stage).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/repositories/:repoName/prs
// ---------------------------------------------------------------------------

describe("GET /api/v1/repositories/:repoName/prs", () => {
  it("returns PRs derived from workers with prNumber", async () => {
    const repo = {
      workers: {
        Snickers: makeWorker({ prNumber: 42 }),
        KitKat: makeWorker({ name: "KitKat", prNumber: 43, branch: "work/KitKat" }),
      },
    };
    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/repositories/my-app/prs");
    expect(res.status).toBe(200);
    expect(res.body.prs).toHaveLength(2);
    expect(res.body.prs[0].number).toBe(43); // sorted descending
    expect(res.body.prs[1].number).toBe(42);
  });

  it("filters out workers without prNumber", async () => {
    const repo = {
      workers: {
        Snickers: makeWorker({ prNumber: 42 }),
        KitKat: makeWorker({ name: "KitKat", prNumber: undefined }),
      },
    };
    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/repositories/my-app/prs");
    expect(res.status).toBe(200);
    expect(res.body.prs).toHaveLength(1);
    expect(res.body.prs[0].number).toBe(42);
  });

  it("returns empty array when no workers have PRs", async () => {
    const repo = {
      workers: {
        Snickers: makeWorker({ prNumber: undefined }),
      },
    };
    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/repositories/my-app/prs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prs: [] });
  });

  it("returns empty array when repo has no workers", async () => {
    const repo = { workers: {} };
    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/repositories/my-app/prs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prs: [] });
  });

  it("returns 404 for unknown repository", async () => {
    const sm = { getRepo: jest.fn().mockReturnValue(undefined) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/repositories/ghost/prs");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/ghost/);
  });

  it("includes correct stage based on worker status", async () => {
    const repo = {
      workers: {
        Snickers: makeWorker({ prNumber: 42, status: "completed" }),
        KitKat: makeWorker({ name: "KitKat", prNumber: 43, status: "failed" }),
      },
    };
    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/repositories/my-app/prs");
    expect(res.status).toBe(200);
    const pr42 = res.body.prs.find((p: any) => p.number === 42);
    const pr43 = res.body.prs.find((p: any) => p.number === 43);
    expect(pr42.stage).toBe("ready");
    expect(pr43.stage).toBe("ci_failed");
  });
});
