/**
 * Tests for wave report API routes.
 */

import express from "express";
import request from "supertest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { waveReportRoutes } from "./wave-reports.js";
import { errorHandler } from "../middleware/error-handler.js";
import { saveReport, buildWaveReport } from "../../wave-reporter/index.js";
import type { WorkerState, RepoState } from "../../state/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorker(overrides: Partial<WorkerState> = {}): WorkerState {
  return {
    id: "w-1",
    name: "Snickers",
    task: "Implement feature A",
    branch: "work/Snickers",
    status: "completed",
    createdAt: "2025-01-10T10:00:00.000Z",
    updatedAt: "2025-01-10T12:00:00.000Z",
    completedAt: "2025-01-10T12:00:00.000Z",
    ...overrides,
  };
}

function createApp(stateManager: any) {
  const app = express();
  app.use(express.json());
  app.use("/waves", waveReportRoutes(stateManager));
  app.use(errorHandler);
  return app;
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "wave-reports-api-test-"),
  );
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

function makeStateManager(workers: WorkerState[] = []) {
  const workerMap: Record<string, WorkerState> = {};
  for (const w of workers) {
    workerMap[w.name] = w;
  }
  return {
    getRepos: () => ({
      "test-repo": {
        workers: workerMap,
      } as unknown as RepoState,
    }),
    getBaseDir: () => tmpDir,
  } as any;
}

// ---------------------------------------------------------------------------
// GET /waves/reports
// ---------------------------------------------------------------------------

describe("GET /waves/reports", () => {
  it("returns empty array when no reports", async () => {
    const sm = makeStateManager();
    const app = createApp(sm);
    const res = await request(app).get("/waves/reports");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns saved reports", async () => {
    const sm = makeStateManager([makeWorker()]);
    const report = buildWaveReport(sm, "wave-1");
    await saveReport(report, tmpDir);

    const app = createApp(sm);
    const res = await request(app).get("/waves/reports");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].waveId).toBe("wave-1");
  });
});

// ---------------------------------------------------------------------------
// GET /waves/:waveId/report
// ---------------------------------------------------------------------------

describe("GET /waves/:waveId/report", () => {
  it("returns 400 for invalid waveId", async () => {
    const sm = makeStateManager();
    const app = createApp(sm);
    const res = await request(app).get("/waves/wave-99/report");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid waveId");
  });

  it("returns 404 when no report exists", async () => {
    const sm = makeStateManager();
    const app = createApp(sm);
    const res = await request(app).get("/waves/wave-1/report");
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("No report found");
  });

  it("returns existing report", async () => {
    const sm = makeStateManager([makeWorker()]);
    const report = buildWaveReport(sm, "wave-2");
    await saveReport(report, tmpDir);

    const app = createApp(sm);
    const res = await request(app).get("/waves/wave-2/report");
    expect(res.status).toBe(200);
    expect(res.body.waveId).toBe("wave-2");
  });
});

// ---------------------------------------------------------------------------
// POST /waves/:waveId/report
// ---------------------------------------------------------------------------

describe("POST /waves/:waveId/report", () => {
  it("returns 400 for invalid waveId", async () => {
    const sm = makeStateManager();
    const app = createApp(sm);
    const res = await request(app).post("/waves/invalid/report");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid waveId");
  });

  it("generates and saves a report", async () => {
    const sm = makeStateManager([makeWorker()]);
    const app = createApp(sm);
    const res = await request(app)
      .post("/waves/wave-1/report")
      .send({ coverageBefore: 60, coverageAfter: 70 });

    expect(res.status).toBe(201);
    expect(res.body.waveId).toBe("wave-1");
    expect(res.body.testCoverage.deltaPercent).toBe(10);
    expect(res.body.summary.totalTasks).toBe(1);

    // Verify it was persisted
    const listRes = await request(app).get("/waves/reports");
    expect(listRes.body).toHaveLength(1);
  });

  it("generates report with empty body", async () => {
    const sm = makeStateManager();
    const app = createApp(sm);
    const res = await request(app).post("/waves/wave-3/report");
    expect(res.status).toBe(201);
    expect(res.body.waveId).toBe("wave-3");
  });
});
