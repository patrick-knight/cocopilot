import { recoverState } from "./recovery";
import {
  type DaemonState,
  type RepoState,
  CURRENT_STATE_VERSION,
} from "./schemas";

function makeRepo(overrides: Partial<RepoState> = {}): RepoState {
  return {
    id: "repo-1",
    name: "test-repo",
    url: "https://github.com/org/test-repo",
    localPath: "/tmp/repos/test-repo",
    mode: "single-player",
    status: "active",
    defaultBranch: "main",
    agents: {},
    workers: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("recoverState", () => {
  it("returns default state for null/undefined input", () => {
    const result = recoverState(null as any);
    expect(result.status).toBe("stopped");
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.repositories).toEqual({});
  });

  it("returns default state for non-object input", () => {
    const result = recoverState("bad" as any);
    expect(result.status).toBe("stopped");
    expect(result.repositories).toEqual({});
  });

  it("clears stale PID and sets status to stopped", () => {
    const input: DaemonState = {
      version: 1,
      status: "running",
      pid: 12345,
      startedAt: "2026-01-01T00:00:00.000Z",
      repositories: {},
    };
    const result = recoverState(input);
    expect(result.status).toBe("stopped");
    expect(result.pid).toBeUndefined();
    expect(result.startedAt).toBeUndefined();
  });

  it("migrates version 0 to current version", () => {
    const result = recoverState({ version: 0, repositories: {} });
    expect(result.version).toBe(CURRENT_STATE_VERSION);
  });

  it("preserves valid repos", () => {
    const repo = makeRepo();
    const result = recoverState({
      version: 1,
      status: "running",
      repositories: { "test-repo": repo },
    });
    expect(result.repositories["test-repo"]).toBeDefined();
    expect(result.repositories["test-repo"].url).toBe(repo.url);
  });

  it("drops repos missing required fields", () => {
    const result = recoverState({
      version: 1,
      repositories: {
        bad: { name: "bad" } as any,
      },
    });
    expect(result.repositories["bad"]).toBeUndefined();
  });

  it("marks running agents as crashed", () => {
    const repo = makeRepo({
      agents: {
        chocolatier: {
          name: "chocolatier",
          type: "supervisor",
          status: "healthy",
          lastActivity: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          containerId: "abc123",
        },
      },
    });
    const result = recoverState({
      version: 1,
      repositories: { repo: repo },
    });
    const agent = result.repositories["repo"].agents["chocolatier"];
    expect(agent.status).toBe("crashed");
    expect(agent.containerId).toBeUndefined();
    expect(agent.error).toContain("Daemon restarted");
  });

  it("preserves stopped agents as-is", () => {
    const repo = makeRepo({
      agents: {
        temperer: {
          name: "temperer",
          type: "merge-queue",
          status: "stopped",
          lastActivity: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    const result = recoverState({
      version: 1,
      repositories: { repo: repo },
    });
    expect(result.repositories["repo"].agents["temperer"].status).toBe(
      "stopped",
    );
  });

  it("marks active workers as stuck", () => {
    const repo = makeRepo({
      workers: {
        Snickers: {
          id: "w-1",
          name: "Snickers",
          task: "Add tests",
          branch: "work/Snickers",
          status: "working",
          containerId: "xyz",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    const result = recoverState({
      version: 1,
      repositories: { repo: repo },
    });
    const worker = result.repositories["repo"].workers["Snickers"];
    expect(worker.status).toBe("stuck");
    expect(worker.containerId).toBeUndefined();
    expect(worker.error).toContain("Daemon restarted");
  });

  it("preserves completed workers", () => {
    const repo = makeRepo({
      workers: {
        KitKat: {
          id: "w-2",
          name: "KitKat",
          task: "Fix bug",
          branch: "work/KitKat",
          status: "completed",
          prNumber: 42,
          prUrl: "https://github.com/org/repo/pull/42",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T12:00:00.000Z",
          completedAt: "2026-01-01T12:00:00.000Z",
        },
      },
    });
    const result = recoverState({
      version: 1,
      repositories: { repo: repo },
    });
    const worker = result.repositories["repo"].workers["KitKat"];
    expect(worker.status).toBe("completed");
    expect(worker.prNumber).toBe(42);
  });

  it("drops workers missing required fields", () => {
    const repo = makeRepo({
      workers: {
        Bad: { name: "Bad" } as any,
      },
    });
    const result = recoverState({
      version: 1,
      repositories: { repo: repo },
    });
    expect(result.repositories["repo"].workers["Bad"]).toBeUndefined();
  });
});
