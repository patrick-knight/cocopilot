/**
 * Unit tests for wave audit API routes.
 */

import express from "express";
import request from "supertest";
import { waveRoutes } from "./wave.js";
import type { WaveAuditReport } from "../../wave/index.js";

// ---------------------------------------------------------------------------
// Mock WaveAuditor
// ---------------------------------------------------------------------------

const mockAudit = jest.fn();

jest.mock("../../wave/index.js", () => ({
  WaveAuditor: jest.fn().mockImplementation(() => ({
    audit: mockAudit,
  })),
}));

// ---------------------------------------------------------------------------
// Fake StateManager
// ---------------------------------------------------------------------------

function createFakeStateManager(repos: Record<string, object> = {}) {
  return {
    getRepos: () => repos,
    getConfig: () => ({}),
    getDaemonState: () => ({ repositories: repos }),
    init: jest.fn(),
  } as any;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

function createApp(repos: Record<string, object> = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/repositories/:repoName/wave",
    waveRoutes(createFakeStateManager(repos)),
  );
  return app;
}

const REPO_NAME = "test-repo";
const REPOS = {
  [REPO_NAME]: {
    id: "repo-1",
    name: REPO_NAME,
    localPath: "/tmp/test-repo",
    status: "active",
    workers: {},
  },
};

function fakeReport(overrides: Partial<WaveAuditReport> = {}): WaveAuditReport {
  return {
    id: "report-1",
    repoName: REPO_NAME,
    waveId: "wave-1",
    verdict: "pass",
    scans: [],
    e2e: {
      verdict: "pass",
      total: 5,
      passed: 5,
      failed: 0,
      skipped: 0,
      tests: [],
      durationMs: 200,
    },
    startedAt: "2026-01-28T00:00:00.000Z",
    completedAt: "2026-01-28T00:01:00.000Z",
    durationMs: 60000,
    summary: "Wave audit PASSED.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wave routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /audit", () => {
    it("returns 404 for unknown repo", async () => {
      const app = createApp({});
      const res = await request(app)
        .post(`/api/v1/repositories/${REPO_NAME}/wave/audit`)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });

    it("returns 400 for invalid scanner names", async () => {
      const app = createApp(REPOS);
      const res = await request(app)
        .post(`/api/v1/repositories/${REPO_NAME}/wave/audit`)
        .send({ scanners: ["invalid-scanner"] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid scanner");
    });

    it("triggers audit and returns 201 with report", async () => {
      const report = fakeReport();
      mockAudit.mockResolvedValue(report);

      const app = createApp(REPOS);
      const res = await request(app)
        .post(`/api/v1/repositories/${REPO_NAME}/wave/audit`)
        .send({ waveId: "wave-1" });

      expect(res.status).toBe(201);
      expect(res.body.verdict).toBe("pass");
      expect(res.body.repoName).toBe(REPO_NAME);
      expect(mockAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          repoName: REPO_NAME,
          repoPath: "/tmp/test-repo",
          waveId: "wave-1",
        }),
      );
    });

    it("passes scanners and options to auditor", async () => {
      mockAudit.mockResolvedValue(fakeReport());

      const app = createApp(REPOS);
      await request(app)
        .post(`/api/v1/repositories/${REPO_NAME}/wave/audit`)
        .send({
          scanners: ["npm-audit", "gitleaks"],
          runE2E: false,
          dockerImage: "myapp:latest",
        });

      expect(mockAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          scanners: ["npm-audit", "gitleaks"],
          runE2E: false,
          dockerImage: "myapp:latest",
        }),
      );
    });

    it("returns 500 when audit throws", async () => {
      mockAudit.mockRejectedValue(new Error("Scan crashed"));

      const app = createApp(REPOS);
      const res = await request(app)
        .post(`/api/v1/repositories/${REPO_NAME}/wave/audit`)
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error).toContain("Scan crashed");
    });
  });

  describe("GET /reports", () => {
    it("returns empty list when no audits have run", async () => {
      const app = createApp(REPOS);
      const res = await request(app).get(
        `/api/v1/repositories/${REPO_NAME}/wave/reports`,
      );

      expect(res.status).toBe(200);
      expect(res.body.reports).toEqual([]);
    });

    it("returns reports after an audit is triggered", async () => {
      const report = fakeReport();
      mockAudit.mockResolvedValue(report);

      const app = createApp(REPOS);

      // Trigger audit
      await request(app)
        .post(`/api/v1/repositories/${REPO_NAME}/wave/audit`)
        .send({});

      // List reports
      const res = await request(app).get(
        `/api/v1/repositories/${REPO_NAME}/wave/reports`,
      );

      expect(res.status).toBe(200);
      expect(res.body.reports).toHaveLength(1);
      expect(res.body.reports[0].verdict).toBe("pass");
      expect(res.body.reports[0].summary).toBeDefined();
    });
  });

  describe("GET /reports/:id", () => {
    it("returns 404 for unknown report", async () => {
      const app = createApp(REPOS);
      const res = await request(app).get(
        `/api/v1/repositories/${REPO_NAME}/wave/reports/nonexistent`,
      );

      expect(res.status).toBe(404);
    });

    it("returns full report by id", async () => {
      const report = fakeReport({ id: "specific-id" });
      mockAudit.mockResolvedValue(report);

      const app = createApp(REPOS);

      // Trigger audit
      await request(app)
        .post(`/api/v1/repositories/${REPO_NAME}/wave/audit`)
        .send({});

      // Get by ID
      const res = await request(app).get(
        `/api/v1/repositories/${REPO_NAME}/wave/reports/specific-id`,
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe("specific-id");
      expect(res.body.scans).toBeDefined();
      expect(res.body.e2e).toBeDefined();
    });
  });
});
