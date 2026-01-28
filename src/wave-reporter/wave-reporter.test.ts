/**
 * Unit tests for the wave-reporter module.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import type { WorkerState, RepoState } from "../state/index.js";
import type { WaveTaskSummary, WavePRSummary } from "./types.js";

import {
  collectWaveWorkers,
  buildTaskSummaries,
  buildPRSummaries,
  computeTestCoverageDelta,
  computeSecurityPosture,
  computeTimeSummary,
  generateRecommendations,
  determineWaveStatus,
  buildWaveReport,
  saveReport,
  loadReport,
  listReports,
} from "./wave-reporter.js";

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
    getBaseDir: () => "/tmp/test-cocopilot",
  } as any;
}

// ---------------------------------------------------------------------------
// collectWaveWorkers
// ---------------------------------------------------------------------------

describe("collectWaveWorkers", () => {
  it("collects workers from all repos", () => {
    const sm = makeStateManager([
      makeWorker({ name: "Snickers" }),
      makeWorker({ name: "KitKat" }),
    ]);
    const workers = collectWaveWorkers(sm);
    expect(workers).toHaveLength(2);
    expect(workers.map((w) => w.name).sort()).toEqual(["KitKat", "Snickers"]);
  });

  it("returns empty array when no repos", () => {
    const sm = { getRepos: () => ({}) } as any;
    expect(collectWaveWorkers(sm)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildTaskSummaries
// ---------------------------------------------------------------------------

describe("buildTaskSummaries", () => {
  it("maps workers to task summaries", () => {
    const workers = [
      makeWorker({ prNumber: 42, prUrl: "https://github.com/pr/42" }),
    ];
    const summaries = buildTaskSummaries(workers);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      workerName: "Snickers",
      task: "Implement feature A",
      branch: "work/Snickers",
      status: "completed",
      prNumber: 42,
      prUrl: "https://github.com/pr/42",
    });
    expect(summaries[0].durationMs).toBe(2 * 60 * 60 * 1000);
  });

  it("omits durationMs when no completedAt", () => {
    const workers = [
      makeWorker({
        status: "working",
        completedAt: undefined,
      }),
    ];
    const summaries = buildTaskSummaries(workers);
    expect(summaries[0].durationMs).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildPRSummaries
// ---------------------------------------------------------------------------

describe("buildPRSummaries", () => {
  it("extracts PR info from workers with prNumber", () => {
    const workers = [
      makeWorker({ prNumber: 10, prUrl: "https://github.com/pr/10" }),
      makeWorker({ name: "KitKat" }), // no PR
    ];
    const prs = buildPRSummaries(workers);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({
      prNumber: 10,
      workerName: "Snickers",
      merged: true,
      branch: "work/Snickers",
    });
  });

  it("marks failed workers as not merged", () => {
    const workers = [
      makeWorker({ status: "failed", prNumber: 5 }),
    ];
    const prs = buildPRSummaries(workers);
    expect(prs[0].merged).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeTestCoverageDelta
// ---------------------------------------------------------------------------

describe("computeTestCoverageDelta", () => {
  it("computes delta correctly", () => {
    const result = computeTestCoverageDelta({
      beforePercent: 70,
      afterPercent: 75.5,
      newTestFiles: 3,
      newTestCases: 12,
    });
    expect(result).toEqual({
      beforePercent: 70,
      afterPercent: 75.5,
      deltaPercent: 5.5,
      newTestFiles: 3,
      newTestCases: 12,
    });
  });

  it("defaults to zeros when no opts", () => {
    const result = computeTestCoverageDelta();
    expect(result).toEqual({
      beforePercent: 0,
      afterPercent: 0,
      deltaPercent: 0,
      newTestFiles: 0,
      newTestCases: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// computeSecurityPosture
// ---------------------------------------------------------------------------

describe("computeSecurityPosture", () => {
  it("computes net change", () => {
    const result = computeSecurityPosture({
      scansRun: 5,
      newVulnerabilities: 3,
      resolvedVulnerabilities: 1,
      auditPassed: false,
      notes: ["Found XSS"],
    });
    expect(result).toEqual({
      scansRun: 5,
      newVulnerabilities: 3,
      resolvedVulnerabilities: 1,
      netChange: 2,
      auditPassed: false,
      notes: ["Found XSS"],
    });
  });

  it("defaults to passing with no issues", () => {
    const result = computeSecurityPosture();
    expect(result.auditPassed).toBe(true);
    expect(result.netChange).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeTimeSummary
// ---------------------------------------------------------------------------

describe("computeTimeSummary", () => {
  it("computes time metrics", () => {
    const workers = [
      makeWorker({
        createdAt: "2025-01-10T10:00:00.000Z",
        completedAt: "2025-01-10T11:00:00.000Z",
        updatedAt: "2025-01-10T11:00:00.000Z",
      }),
      makeWorker({
        name: "KitKat",
        createdAt: "2025-01-10T10:30:00.000Z",
        completedAt: "2025-01-10T12:00:00.000Z",
        updatedAt: "2025-01-10T12:00:00.000Z",
      }),
    ];
    const result = computeTimeSummary(
      workers,
      "2025-01-10T10:00:00.000Z",
      "2025-01-10T12:00:00.000Z",
    );
    expect(result.startedAt).toBe("2025-01-10T10:00:00.000Z");
    expect(result.endedAt).toBe("2025-01-10T12:00:00.000Z");
    expect(result.totalDurationMs).toBe(2 * 60 * 60 * 1000);
    expect(result.peakConcurrency).toBe(2);
    expect(result.avgTaskDurationMs).toBeGreaterThan(0);
  });

  it("handles empty workers", () => {
    const result = computeTimeSummary([]);
    expect(result.peakConcurrency).toBe(0);
    expect(result.workerSecondsTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateRecommendations
// ---------------------------------------------------------------------------

describe("generateRecommendations", () => {
  it("flags high failure rate", () => {
    const tasks: WaveTaskSummary[] = [
      { workerName: "A", task: "t", branch: "b", status: "failed", createdAt: "2025-01-10T00:00:00Z" },
      { workerName: "B", task: "t", branch: "b", status: "failed", createdAt: "2025-01-10T00:00:00Z" },
      { workerName: "C", task: "t", branch: "b", status: "completed", createdAt: "2025-01-10T00:00:00Z" },
    ];
    const recs = generateRecommendations(
      tasks,
      [],
      computeTestCoverageDelta(),
      computeSecurityPosture(),
      computeTimeSummary([]),
    );
    expect(recs.some((r) => r.title === "High task failure rate")).toBe(true);
  });

  it("flags unmerged PRs", () => {
    const prs: WavePRSummary[] = [
      { prNumber: 1, workerName: "A", merged: false, branch: "b" },
    ];
    const recs = generateRecommendations(
      [],
      prs,
      computeTestCoverageDelta(),
      computeSecurityPosture(),
      computeTimeSummary([]),
    );
    expect(recs.some((r) => r.title === "Unmerged pull requests")).toBe(true);
  });

  it("flags coverage regression", () => {
    const coverage = computeTestCoverageDelta({
      beforePercent: 80,
      afterPercent: 75,
    });
    const recs = generateRecommendations(
      [],
      [],
      coverage,
      computeSecurityPosture(),
      computeTimeSummary([]),
    );
    expect(recs.some((r) => r.title === "Test coverage decreased")).toBe(true);
  });

  it("flags security vulnerabilities", () => {
    const security = computeSecurityPosture({
      newVulnerabilities: 3,
      resolvedVulnerabilities: 1,
      auditPassed: false,
    });
    const recs = generateRecommendations(
      [],
      [],
      computeTestCoverageDelta(),
      security,
      computeTimeSummary([]),
    );
    expect(recs.some((r) => r.title === "Net increase in vulnerabilities")).toBe(true);
    expect(recs.some((r) => r.title === "Security audit failed")).toBe(true);
  });

  it("returns empty when everything is fine", () => {
    const recs = generateRecommendations(
      [{ workerName: "A", task: "t", branch: "b", status: "completed", createdAt: "2025-01-10T00:00:00Z" }],
      [],
      computeTestCoverageDelta(),
      computeSecurityPosture(),
      computeTimeSummary([]),
    );
    expect(recs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// determineWaveStatus
// ---------------------------------------------------------------------------

describe("determineWaveStatus", () => {
  it("returns in_progress for empty tasks", () => {
    expect(determineWaveStatus([])).toBe("in_progress");
  });

  it("returns completed when all completed", () => {
    const tasks: WaveTaskSummary[] = [
      { workerName: "A", task: "t", branch: "b", status: "completed", createdAt: "2025-01-10T00:00:00Z" },
    ];
    expect(determineWaveStatus(tasks)).toBe("completed");
  });

  it("returns failed when all failed", () => {
    const tasks: WaveTaskSummary[] = [
      { workerName: "A", task: "t", branch: "b", status: "failed", createdAt: "2025-01-10T00:00:00Z" },
    ];
    expect(determineWaveStatus(tasks)).toBe("failed");
  });

  it("returns partial when mixed results", () => {
    const tasks: WaveTaskSummary[] = [
      { workerName: "A", task: "t", branch: "b", status: "completed", createdAt: "2025-01-10T00:00:00Z" },
      { workerName: "B", task: "t", branch: "b", status: "failed", createdAt: "2025-01-10T00:00:00Z" },
    ];
    expect(determineWaveStatus(tasks)).toBe("partial");
  });

  it("returns in_progress when some still running", () => {
    const tasks: WaveTaskSummary[] = [
      { workerName: "A", task: "t", branch: "b", status: "completed", createdAt: "2025-01-10T00:00:00Z" },
      { workerName: "B", task: "t", branch: "b", status: "working", createdAt: "2025-01-10T00:00:00Z" },
    ];
    expect(determineWaveStatus(tasks)).toBe("in_progress");
  });
});

// ---------------------------------------------------------------------------
// buildWaveReport
// ---------------------------------------------------------------------------

describe("buildWaveReport", () => {
  it("builds a complete report", () => {
    const sm = makeStateManager([
      makeWorker({ prNumber: 1, prUrl: "https://github.com/pr/1" }),
      makeWorker({
        name: "KitKat",
        status: "failed",
        completedAt: "2025-01-10T13:00:00.000Z",
        updatedAt: "2025-01-10T13:00:00.000Z",
      }),
    ]);
    const report = buildWaveReport(sm, "wave-1", {
      coverageBefore: 60,
      coverageAfter: 65,
    });

    expect(report.waveId).toBe("wave-1");
    expect(report.waveName).toContain("Wave 1");
    expect(report.status).toBe("partial");
    expect(report.summary.totalTasks).toBe(2);
    expect(report.summary.completedTasks).toBe(1);
    expect(report.summary.failedTasks).toBe(1);
    expect(report.summary.totalPRs).toBe(1);
    expect(report.summary.mergedPRs).toBe(1);
    expect(report.tasks).toHaveLength(2);
    expect(report.prs).toHaveLength(1);
    expect(report.testCoverage.deltaPercent).toBe(5);
    expect(report.security.auditPassed).toBe(true);
    expect(report.time.peakConcurrency).toBeGreaterThanOrEqual(1);
    expect(report.id).toBeDefined();
    expect(report.generatedAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Persistence: saveReport, loadReport, listReports
// ---------------------------------------------------------------------------

describe("persistence", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "wave-reporter-test-"),
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("saves and loads a report", async () => {
    const sm = makeStateManager([makeWorker()]);
    const report = buildWaveReport(sm, "wave-1");
    await saveReport(report, tmpDir);

    const loaded = await loadReport("wave-1", tmpDir);
    expect(loaded).toBeDefined();
    expect(loaded!.waveId).toBe("wave-1");
    expect(loaded!.id).toBe(report.id);
  });

  it("returns undefined when no report exists", async () => {
    const loaded = await loadReport("wave-2", tmpDir);
    expect(loaded).toBeUndefined();
  });

  it("lists all reports", async () => {
    const sm = makeStateManager([makeWorker()]);
    const r1 = buildWaveReport(sm, "wave-1");
    const r2 = buildWaveReport(sm, "wave-2");
    await saveReport(r1, tmpDir);
    await saveReport(r2, tmpDir);

    const all = await listReports(tmpDir);
    expect(all).toHaveLength(2);
  });

  it("returns empty list when no reports directory", async () => {
    const all = await listReports(path.join(tmpDir, "nonexistent"));
    expect(all).toEqual([]);
  });
});
