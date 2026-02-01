/**
 * Metrics API route.
 *
 * GET /api/v1/metrics — Returns aggregated metrics from the state manager:
 *   - workerThroughput: tasks completed per hour over last 24h
 *   - prCycleTime: average PR open-to-merge time per day
 *   - ciSuccessRate: pass vs fail counts
 *   - tokenUsage: token usage breakdown by model
 */

import { Router } from "express";
import type { StateManager } from "../../state/index.js";
import type { WorkerState, RepoState } from "../../state/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerThroughputBucket {
  hour: string;
  count: number;
}

export interface PRCycleTimePoint {
  date: string;
  avgHours: number;
}

export interface CISuccessRateSlice {
  status: string;
  count: number;
}

export interface TokenUsageBucket {
  model: string;
  tokens: number;
}

/** Summary statistics for quick overview. */
export interface MetricsSummary {
  totalWorkers: number;
  activeWorkers: number;
  completedWorkers: number;
  failedWorkers: number;
  totalPRs: number;
  totalRepos: number;
  avgCompletionTimeHours: number | null;
  successRate: number; // 0-100 percentage
}

export interface MetricsResponse {
  summary: MetricsSummary;
  workerThroughput: WorkerThroughputBucket[];
  prCycleTime: PRCycleTimePoint[];
  ciSuccessRate: CISuccessRateSlice[];
  tokenUsage: TokenUsageBucket[];
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

/** Collect all workers from every tracked repository. */
export function collectAllWorkers(stateManager: StateManager): WorkerState[] {
  const repos = stateManager.getRepos();
  const workers: WorkerState[] = [];
  for (const repo of Object.values(repos)) {
    for (const worker of Object.values(repo.workers)) {
      workers.push(worker);
    }
  }
  return workers;
}

/**
 * Compute tasks completed per hour for the last 24 hours.
 * A task is "completed" when its status is "completed" or "failed" and
 * it has a completedAt timestamp.
 */
export function computeWorkerThroughput(
  workers: WorkerState[],
  now?: Date,
): WorkerThroughputBucket[] {
  const reference = now ?? new Date();
  const buckets: WorkerThroughputBucket[] = [];

  for (let i = 23; i >= 0; i--) {
    const bucketStart = new Date(reference);
    bucketStart.setMinutes(0, 0, 0);
    bucketStart.setHours(bucketStart.getHours() - i);

    const bucketEnd = new Date(bucketStart);
    bucketEnd.setHours(bucketEnd.getHours() + 1);

    const count = workers.filter((w) => {
      if (!w.completedAt) return false;
      const completed = new Date(w.completedAt);
      return completed >= bucketStart && completed < bucketEnd;
    }).length;

    const hourLabel = bucketStart.toISOString().slice(0, 13) + ":00";
    buckets.push({ hour: hourLabel, count });
  }

  return buckets;
}

/**
 * Compute average PR cycle time (hours from creation to completion)
 * grouped by date. Uses completedAt - createdAt for workers that have
 * both a prNumber and completedAt.
 */
export function computePRCycleTime(
  workers: WorkerState[],
): PRCycleTimePoint[] {
  const prWorkers = workers.filter(
    (w) => w.prNumber !== undefined && w.completedAt && w.status === "completed",
  );

  const byDate = new Map<string, number[]>();
  for (const w of prWorkers) {
    const created = new Date(w.createdAt).getTime();
    const completed = new Date(w.completedAt!).getTime();
    const hours = (completed - created) / (1000 * 60 * 60);
    const dateKey = w.completedAt!.slice(0, 10);

    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey)!.push(hours);
  }

  const points: PRCycleTimePoint[] = [];
  for (const [date, hoursList] of Array.from(byDate.entries()).sort()) {
    const avg = hoursList.reduce((a, b) => a + b, 0) / hoursList.length;
    points.push({ date, avgHours: Math.round(avg * 10) / 10 });
  }

  return points;
}

/**
 * Compute CI success rate as pass vs fail counts.
 * "completed" status = pass, "failed" status = fail.
 */
export function computeCISuccessRate(
  workers: WorkerState[],
): CISuccessRateSlice[] {
  let pass = 0;
  let fail = 0;

  for (const w of workers) {
    if (w.status === "completed") pass++;
    else if (w.status === "failed") fail++;
  }

  return [
    { status: "pass", count: pass },
    { status: "fail", count: fail },
  ];
}

/**
 * Compute token usage by model.
 * Groups workers by their model field and counts tasks per model.
 * (Token counts are estimated as task-count since actual token data
 * is not tracked in state.)
 */
export function computeTokenUsage(
  workers: WorkerState[],
): TokenUsageBucket[] {
  const byModel = new Map<string, number>();

  for (const w of workers) {
    const model = w.model ?? "unknown";
    byModel.set(model, (byModel.get(model) ?? 0) + 1);
  }

  return Array.from(byModel.entries())
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
}

/**
 * Compute summary statistics for quick overview.
 */
export function computeSummary(
  workers: WorkerState[],
  repoCount: number,
): MetricsSummary {
  const totalWorkers = workers.length;
  const activeWorkers = workers.filter(
    (w) => w.status === "working" || w.status === "starting",
  ).length;
  const completedWorkers = workers.filter((w) => w.status === "completed").length;
  const failedWorkers = workers.filter((w) => w.status === "failed").length;
  const totalPRs = workers.filter((w) => w.prNumber !== undefined).length;

  // Calculate average completion time
  const completedWithTimes = workers.filter(
    (w) => w.status === "completed" && w.completedAt,
  );
  let avgCompletionTimeHours: number | null = null;
  if (completedWithTimes.length > 0) {
    const totalHours = completedWithTimes.reduce((sum, w) => {
      const created = new Date(w.createdAt).getTime();
      const completed = new Date(w.completedAt!).getTime();
      return sum + (completed - created) / (1000 * 60 * 60);
    }, 0);
    avgCompletionTimeHours = Math.round((totalHours / completedWithTimes.length) * 10) / 10;
  }

  // Calculate success rate
  const finished = completedWorkers + failedWorkers;
  const successRate = finished > 0 ? Math.round((completedWorkers / finished) * 100) : 0;

  return {
    totalWorkers,
    activeWorkers,
    completedWorkers,
    failedWorkers,
    totalPRs,
    totalRepos: repoCount,
    avgCompletionTimeHours,
    successRate,
  };
}

/**
 * Build the complete metrics response from state manager data.
 */
export function buildMetrics(
  stateManager: StateManager,
  now?: Date,
): MetricsResponse {
  const repos = stateManager.getRepos();
  const workers = collectAllWorkers(stateManager);
  const repoCount = Object.keys(repos).length;

  return {
    summary: computeSummary(workers, repoCount),
    workerThroughput: computeWorkerThroughput(workers, now),
    prCycleTime: computePRCycleTime(workers),
    ciSuccessRate: computeCISuccessRate(workers),
    tokenUsage: computeTokenUsage(workers),
  };
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function metricsRoutes(stateManager: StateManager): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const metrics = buildMetrics(stateManager);
    res.json(metrics);
  });

  return router;
}
