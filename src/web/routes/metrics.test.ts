/**
 * Tests for the metrics API route.
 */

import {
  collectAllWorkers,
  computeWorkerThroughput,
  computePRCycleTime,
  computeCISuccessRate,
  computeTokenUsage,
  buildMetrics,
} from "./metrics.js";
import type { StateManager } from "../../state/index.js";
import type { WorkerState } from "../../state/index.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockStateManager(
  repos: Record<string, { workers: Record<string, WorkerState> }> = {},
): StateManager {
  return {
    getRepos: jest.fn().mockReturnValue(repos),
  } as unknown as StateManager;
}

function makeWorker(overrides: Partial<WorkerState> = {}): WorkerState {
  return {
    id: "w-1",
    name: "Snickers",
    task: "Test task",
    branch: "work/Snickers",
    status: "working",
    createdAt: "2026-01-15T08:00:00.000Z",
    updatedAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Metrics aggregation", () => {
  describe("collectAllWorkers", () => {
    it("returns empty array when no repos exist", () => {
      const sm = createMockStateManager({});
      expect(collectAllWorkers(sm)).toEqual([]);
    });

    it("collects workers from all repos", () => {
      const w1 = makeWorker({ name: "Snickers" });
      const w2 = makeWorker({ name: "KitKat" });
      const w3 = makeWorker({ name: "Twix" });

      const sm = createMockStateManager({
        "repo-a": { workers: { Snickers: w1, KitKat: w2 } },
        "repo-b": { workers: { Twix: w3 } },
      });

      const result = collectAllWorkers(sm);
      expect(result).toHaveLength(3);
      expect(result.map((w) => w.name).sort()).toEqual(["KitKat", "Snickers", "Twix"]);
    });
  });

  describe("computeWorkerThroughput", () => {
    it("returns 24 hourly buckets", () => {
      const result = computeWorkerThroughput([], new Date("2026-01-15T12:30:00.000Z"));
      expect(result).toHaveLength(24);
    });

    it("counts completed workers in correct hourly buckets", () => {
      const workers = [
        makeWorker({
          status: "completed",
          completedAt: "2026-01-15T10:15:00.000Z",
        }),
        makeWorker({
          name: "KitKat",
          status: "completed",
          completedAt: "2026-01-15T10:45:00.000Z",
        }),
        makeWorker({
          name: "Twix",
          status: "completed",
          completedAt: "2026-01-15T11:30:00.000Z",
        }),
      ];

      const now = new Date("2026-01-15T12:00:00.000Z");
      const result = computeWorkerThroughput(workers, now);

      // Hour 10:00 should have 2, hour 11:00 should have 1
      const hour10 = result.find((b) => b.hour.includes("10:00"));
      const hour11 = result.find((b) => b.hour.includes("11:00"));
      expect(hour10?.count).toBe(2);
      expect(hour11?.count).toBe(1);
    });

    it("ignores workers without completedAt", () => {
      const workers = [makeWorker({ status: "working" })];
      const result = computeWorkerThroughput(workers, new Date("2026-01-15T12:00:00.000Z"));
      expect(result.every((b) => b.count === 0)).toBe(true);
    });
  });

  describe("computePRCycleTime", () => {
    it("returns empty array when no PR workers exist", () => {
      const result = computePRCycleTime([]);
      expect(result).toEqual([]);
    });

    it("computes average cycle time grouped by date", () => {
      const workers = [
        makeWorker({
          name: "Snickers",
          prNumber: 1,
          status: "completed",
          createdAt: "2026-01-15T08:00:00.000Z",
          completedAt: "2026-01-15T10:00:00.000Z", // 2 hours
        }),
        makeWorker({
          name: "KitKat",
          prNumber: 2,
          status: "completed",
          createdAt: "2026-01-15T09:00:00.000Z",
          completedAt: "2026-01-15T13:00:00.000Z", // 4 hours
        }),
      ];

      const result = computePRCycleTime(workers);
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe("2026-01-15");
      expect(result[0].avgHours).toBe(3); // (2+4)/2
    });

    it("excludes workers without prNumber", () => {
      const workers = [
        makeWorker({
          status: "completed",
          completedAt: "2026-01-15T10:00:00.000Z",
        }),
      ];
      const result = computePRCycleTime(workers);
      expect(result).toEqual([]);
    });

    it("excludes non-completed workers", () => {
      const workers = [
        makeWorker({
          prNumber: 1,
          status: "failed",
          completedAt: "2026-01-15T10:00:00.000Z",
        }),
      ];
      const result = computePRCycleTime(workers);
      expect(result).toEqual([]);
    });
  });

  describe("computeCISuccessRate", () => {
    it("counts pass and fail", () => {
      const workers = [
        makeWorker({ status: "completed" }),
        makeWorker({ status: "completed", name: "KitKat" }),
        makeWorker({ status: "failed", name: "Twix" }),
        makeWorker({ status: "working", name: "Reeses" }),
      ];

      const result = computeCISuccessRate(workers);
      expect(result).toEqual([
        { status: "pass", count: 2 },
        { status: "fail", count: 1 },
      ]);
    });

    it("returns zeros when no workers", () => {
      const result = computeCISuccessRate([]);
      expect(result).toEqual([
        { status: "pass", count: 0 },
        { status: "fail", count: 0 },
      ]);
    });
  });

  describe("computeTokenUsage", () => {
    it("groups by model", () => {
      const workers = [
        makeWorker({ model: "claude-sonnet-4-5" }),
        makeWorker({ model: "claude-sonnet-4-5", name: "KitKat" }),
        makeWorker({ model: "claude-opus-4-5", name: "Twix" }),
      ];

      const result = computeTokenUsage(workers);
      expect(result).toHaveLength(2);
      expect(result.find((b) => b.model === "claude-sonnet-4-5")?.tokens).toBe(2);
      expect(result.find((b) => b.model === "claude-opus-4-5")?.tokens).toBe(1);
    });

    it("uses 'unknown' for workers without model", () => {
      const workers = [makeWorker({})];
      const result = computeTokenUsage(workers);
      expect(result).toEqual([{ model: "unknown", tokens: 1 }]);
    });

    it("sorts by tokens descending", () => {
      const workers = [
        makeWorker({ model: "a" }),
        makeWorker({ model: "b", name: "K1" }),
        makeWorker({ model: "b", name: "K2" }),
        makeWorker({ model: "b", name: "K3" }),
      ];

      const result = computeTokenUsage(workers);
      expect(result[0].model).toBe("b");
      expect(result[1].model).toBe("a");
    });
  });

  describe("buildMetrics", () => {
    it("returns all four metric sections", () => {
      const sm = createMockStateManager({
        repo: {
          workers: {
            Snickers: makeWorker({
              status: "completed",
              completedAt: "2026-01-15T10:00:00.000Z",
              prNumber: 1,
              model: "claude-sonnet-4-5",
            }),
          },
        },
      });

      const result = buildMetrics(sm, new Date("2026-01-15T12:00:00.000Z"));
      expect(result.workerThroughput).toHaveLength(24);
      expect(result.prCycleTime).toHaveLength(1);
      expect(result.ciSuccessRate).toHaveLength(2);
      expect(result.tokenUsage).toHaveLength(1);
    });
  });
});
