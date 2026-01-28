/**
 * Wave Reporter — generates comprehensive wave completion reports.
 *
 * Pure functions for collecting workers, building summaries, computing
 * metrics, and generating recommendations. The top-level orchestrator
 * `buildWaveReport` ties everything together.
 *
 * Uses readJsonFile / writeJsonFile from state/atomic-write for
 * persistence.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import type { StateManager } from "../state/index.js";
import type { WorkerState } from "../state/index.js";
import { readJsonFile, writeJsonFile } from "../state/atomic-write.js";

import type {
  WaveId,
  WaveStatus,
  WaveTaskSummary,
  WavePRSummary,
  TestCoverageDelta,
  SecurityPostureChange,
  WaveTimeSummary,
  WaveRecommendation,
  WaveReport,
  BuildWaveReportOptions,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WAVE_NAMES: Record<WaveId, string> = {
  "wave-1": "Wave 1 — Foundation",
  "wave-2": "Wave 2 — Core Systems",
  "wave-3": "Wave 3 — Integration",
  "wave-4": "Wave 4 — Polish",
  "wave-5": "Wave 5 — Hardening",
  "wave-6": "Wave 6 — Launch",
};

export const VALID_WAVE_IDS: ReadonlySet<string> = new Set<string>([
  "wave-1",
  "wave-2",
  "wave-3",
  "wave-4",
  "wave-5",
  "wave-6",
]);

// ---------------------------------------------------------------------------
// Collect workers
// ---------------------------------------------------------------------------

/** Gather all workers from every tracked repository. */
export function collectWaveWorkers(stateManager: StateManager): WorkerState[] {
  const repos = stateManager.getRepos();
  const workers: WorkerState[] = [];
  for (const repo of Object.values(repos)) {
    for (const worker of Object.values(repo.workers)) {
      workers.push(worker);
    }
  }
  return workers;
}

// ---------------------------------------------------------------------------
// Build task summaries
// ---------------------------------------------------------------------------

/** Map WorkerState[] to WaveTaskSummary[]. */
export function buildTaskSummaries(workers: WorkerState[]): WaveTaskSummary[] {
  return workers.map((w) => {
    let durationMs: number | undefined;
    if (w.completedAt) {
      durationMs =
        new Date(w.completedAt).getTime() - new Date(w.createdAt).getTime();
    }

    return {
      workerName: w.name,
      task: w.task,
      branch: w.branch,
      status: w.status,
      createdAt: w.createdAt,
      completedAt: w.completedAt,
      durationMs,
      prNumber: w.prNumber,
      prUrl: w.prUrl,
    };
  });
}

// ---------------------------------------------------------------------------
// Build PR summaries
// ---------------------------------------------------------------------------

/** Extract PR info from workers that have a prNumber. */
export function buildPRSummaries(workers: WorkerState[]): WavePRSummary[] {
  return workers
    .filter((w) => w.prNumber !== undefined)
    .map((w) => ({
      prNumber: w.prNumber!,
      prUrl: w.prUrl,
      workerName: w.name,
      merged: w.status === "completed",
      branch: w.branch,
    }));
}

// ---------------------------------------------------------------------------
// Compute test coverage delta
// ---------------------------------------------------------------------------

/** Compute delta from before/after coverage values (defaults to zeros). */
export function computeTestCoverageDelta(opts?: {
  beforePercent?: number;
  afterPercent?: number;
  newTestFiles?: number;
  newTestCases?: number;
}): TestCoverageDelta {
  const before = opts?.beforePercent ?? 0;
  const after = opts?.afterPercent ?? 0;
  return {
    beforePercent: before,
    afterPercent: after,
    deltaPercent: Math.round((after - before) * 100) / 100,
    newTestFiles: opts?.newTestFiles ?? 0,
    newTestCases: opts?.newTestCases ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Compute security posture
// ---------------------------------------------------------------------------

/** Compute security posture changes (defaults to passing). */
export function computeSecurityPosture(opts?: {
  scansRun?: number;
  newVulnerabilities?: number;
  resolvedVulnerabilities?: number;
  auditPassed?: boolean;
  notes?: string[];
}): SecurityPostureChange {
  const newVulns = opts?.newVulnerabilities ?? 0;
  const resolved = opts?.resolvedVulnerabilities ?? 0;
  return {
    scansRun: opts?.scansRun ?? 0,
    newVulnerabilities: newVulns,
    resolvedVulnerabilities: resolved,
    netChange: newVulns - resolved,
    auditPassed: opts?.auditPassed ?? true,
    notes: opts?.notes ?? [],
  };
}

// ---------------------------------------------------------------------------
// Compute time summary
// ---------------------------------------------------------------------------

/** Duration analysis with peak concurrency calculation. */
export function computeTimeSummary(
  workers: WorkerState[],
  startedAt?: string,
  endedAt?: string,
): WaveTimeSummary {
  const now = new Date().toISOString();

  // Determine start: earliest worker createdAt or override
  let start = startedAt;
  if (!start && workers.length > 0) {
    start = workers.reduce(
      (earliest, w) => (w.createdAt < earliest ? w.createdAt : earliest),
      workers[0].createdAt,
    );
  }
  start = start ?? now;

  // Determine end: latest worker completedAt/updatedAt or override
  let end = endedAt;
  if (!end && workers.length > 0) {
    end = workers.reduce((latest, w) => {
      const ts = w.completedAt ?? w.updatedAt;
      return ts > latest ? ts : latest;
    }, workers[0].completedAt ?? workers[0].updatedAt);
  }
  end = end ?? now;

  const totalDurationMs =
    new Date(end).getTime() - new Date(start).getTime();

  // Worker-seconds: sum of each worker's duration
  let workerMsTotal = 0;
  for (const w of workers) {
    const wEnd = w.completedAt ?? w.updatedAt;
    const ms = new Date(wEnd).getTime() - new Date(w.createdAt).getTime();
    workerMsTotal += Math.max(ms, 0);
  }

  const completedWorkers = workers.filter((w) => w.completedAt);
  const avgTaskDurationMs =
    completedWorkers.length > 0
      ? Math.round(
          completedWorkers.reduce((sum, w) => {
            const ms =
              new Date(w.completedAt!).getTime() -
              new Date(w.createdAt).getTime();
            return sum + ms;
          }, 0) / completedWorkers.length,
        )
      : 0;

  // Peak concurrency: max workers running at the same time
  const peakConcurrency = computePeakConcurrency(workers);

  return {
    startedAt: start,
    endedAt: end,
    totalDurationMs: Math.max(totalDurationMs, 0),
    workerSecondsTotal: Math.round(workerMsTotal / 1000),
    avgTaskDurationMs,
    peakConcurrency,
  };
}

/** Compute peak number of concurrently running workers. */
function computePeakConcurrency(workers: WorkerState[]): number {
  if (workers.length === 0) return 0;

  // Build events: +1 at start, -1 at end
  const events: { time: number; delta: number }[] = [];
  for (const w of workers) {
    events.push({
      time: new Date(w.createdAt).getTime(),
      delta: 1,
    });
    const endTs = w.completedAt ?? w.updatedAt;
    events.push({
      time: new Date(endTs).getTime(),
      delta: -1,
    });
  }

  // Sort by time (start events before end events at same time)
  events.sort((a, b) => a.time - b.time || b.delta - a.delta);

  let peak = 0;
  let current = 0;
  for (const ev of events) {
    current += ev.delta;
    if (current > peak) peak = current;
  }

  return peak;
}

// ---------------------------------------------------------------------------
// Generate recommendations
// ---------------------------------------------------------------------------

/** Rule-based recommendations from report data. */
export function generateRecommendations(
  tasks: WaveTaskSummary[],
  prs: WavePRSummary[],
  coverage: TestCoverageDelta,
  security: SecurityPostureChange,
  time: WaveTimeSummary,
): WaveRecommendation[] {
  const recs: WaveRecommendation[] = [];

  // High failure rate
  const failedTasks = tasks.filter((t) => t.status === "failed");
  if (tasks.length > 0 && failedTasks.length / tasks.length > 0.3) {
    recs.push({
      id: randomUUID(),
      severity: "warning",
      category: "quality",
      title: "High task failure rate",
      description: `${failedTasks.length} of ${tasks.length} tasks failed (${Math.round((failedTasks.length / tasks.length) * 100)}%). Consider reviewing task definitions and worker stability.`,
    });
  }

  // Unmerged PRs
  const unmergedPRs = prs.filter((p) => !p.merged);
  if (unmergedPRs.length > 0) {
    recs.push({
      id: randomUUID(),
      severity: "info",
      category: "process",
      title: "Unmerged pull requests",
      description: `${unmergedPRs.length} PR(s) remain unmerged: ${unmergedPRs.map((p) => `#${p.prNumber}`).join(", ")}.`,
    });
  }

  // Coverage regression
  if (coverage.deltaPercent < 0) {
    recs.push({
      id: randomUUID(),
      severity: "warning",
      category: "quality",
      title: "Test coverage decreased",
      description: `Coverage dropped by ${Math.abs(coverage.deltaPercent)}% (${coverage.beforePercent}% → ${coverage.afterPercent}%). Add tests to recover.`,
    });
  }

  // Security vulnerabilities
  if (security.netChange > 0) {
    recs.push({
      id: randomUUID(),
      severity: "critical",
      category: "security",
      title: "Net increase in vulnerabilities",
      description: `${security.newVulnerabilities} new vulnerability(ies) found, ${security.resolvedVulnerabilities} resolved. Net change: +${security.netChange}.`,
    });
  }

  if (!security.auditPassed) {
    recs.push({
      id: randomUUID(),
      severity: "critical",
      category: "security",
      title: "Security audit failed",
      description:
        "The security audit did not pass. Review findings before proceeding.",
    });
  }

  // Long average task duration (> 2 hours)
  if (time.avgTaskDurationMs > 2 * 60 * 60 * 1000) {
    recs.push({
      id: randomUUID(),
      severity: "info",
      category: "performance",
      title: "Long average task duration",
      description: `Average task duration was ${Math.round(time.avgTaskDurationMs / (60 * 1000))} minutes. Consider breaking tasks into smaller units.`,
    });
  }

  // Low concurrency
  if (time.peakConcurrency <= 1 && tasks.length > 2) {
    recs.push({
      id: randomUUID(),
      severity: "info",
      category: "performance",
      title: "Low parallelism",
      description: `Peak concurrency was ${time.peakConcurrency} with ${tasks.length} tasks. Consider running more workers in parallel.`,
    });
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Determine wave status
// ---------------------------------------------------------------------------

/** Derive wave status from task outcomes. */
export function determineWaveStatus(tasks: WaveTaskSummary[]): WaveStatus {
  if (tasks.length === 0) return "in_progress";

  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const inProgress = tasks.filter(
    (t) => t.status !== "completed" && t.status !== "failed",
  ).length;

  if (inProgress > 0) return "in_progress";
  if (failed === tasks.length) return "failed";
  if (completed === tasks.length) return "completed";
  return "partial";
}

// ---------------------------------------------------------------------------
// Build wave report (top-level orchestrator)
// ---------------------------------------------------------------------------

/** Build a complete wave report from state manager data. */
export function buildWaveReport(
  stateManager: StateManager,
  waveId: WaveId,
  opts?: BuildWaveReportOptions,
): WaveReport {
  const workers = collectWaveWorkers(stateManager);
  const tasks = buildTaskSummaries(workers);
  const prs = buildPRSummaries(workers);

  const coverage = computeTestCoverageDelta({
    beforePercent: opts?.coverageBefore,
    afterPercent: opts?.coverageAfter,
    newTestFiles: opts?.newTestFiles,
    newTestCases: opts?.newTestCases,
  });

  const security = computeSecurityPosture({
    scansRun: opts?.securityScansRun,
    newVulnerabilities: opts?.newVulnerabilities,
    resolvedVulnerabilities: opts?.resolvedVulnerabilities,
    auditPassed: opts?.auditPassed,
    notes: opts?.securityNotes,
  });

  const time = computeTimeSummary(workers, opts?.startedAt, opts?.endedAt);
  const recommendations = generateRecommendations(
    tasks,
    prs,
    coverage,
    security,
    time,
  );

  const status = determineWaveStatus(tasks);

  const completedTasks = tasks.filter((t) => t.status === "completed").length;
  const failedTasks = tasks.filter((t) => t.status === "failed").length;
  const mergedPRs = prs.filter((p) => p.merged).length;

  return {
    id: randomUUID(),
    waveId,
    waveName: WAVE_NAMES[waveId],
    generatedAt: new Date().toISOString(),
    status,
    summary: {
      totalTasks: tasks.length,
      completedTasks,
      failedTasks,
      totalPRs: prs.length,
      mergedPRs,
    },
    tasks,
    prs,
    testCoverage: coverage,
    security,
    time,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Get the reports directory path. */
function reportsDir(baseDir: string): string {
  return path.join(baseDir, "reports");
}

/** Save a report atomically. */
export async function saveReport(
  report: WaveReport,
  baseDir: string,
): Promise<string> {
  const dir = reportsDir(baseDir);
  const date = report.generatedAt.slice(0, 10);
  const filePath = path.join(dir, `${report.waveId}-${date}.json`);
  await writeJsonFile(filePath, report);
  return filePath;
}

/** Load the latest report for a given wave. */
export async function loadReport(
  waveId: WaveId,
  baseDir: string,
): Promise<WaveReport | undefined> {
  const dir = reportsDir(baseDir);
  try {
    const files = await fs.promises.readdir(dir);
    const matching = files
      .filter((f) => f.startsWith(waveId) && f.endsWith(".json"))
      .sort()
      .reverse();
    if (matching.length === 0) return undefined;
    return readJsonFile<WaveReport>(path.join(dir, matching[0]));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}

/** List all saved reports sorted by generatedAt descending. */
export async function listReports(
  baseDir: string,
): Promise<WaveReport[]> {
  const dir = reportsDir(baseDir);
  try {
    const files = await fs.promises.readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();
    const reports: WaveReport[] = [];
    for (const file of jsonFiles) {
      const report = await readJsonFile<WaveReport>(path.join(dir, file));
      if (report) reports.push(report);
    }
    return reports;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}
