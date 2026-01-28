/**
 * Tests for Tempering Station frontend types and display constants.
 */

import {
  AGENT_DISPLAY,
  STATUS_COLORS,
  PR_STAGE_DISPLAY,
} from "../types.js";

import type {
  AgentType,
  AgentStatus,
  WorkerStatus,
  PRStage,
  AgentOutputLine,
  PRPipelineEntry,
  MessageEntry,
  SpawnWorkerRequest,
} from "../types.js";

// ---------------------------------------------------------------------------
// AGENT_DISPLAY
// ---------------------------------------------------------------------------

describe("AGENT_DISPLAY", () => {
  const agentTypes: AgentType[] = ["supervisor", "merge-queue", "pr-shepherd", "worker"];

  it("has an entry for every AgentType", () => {
    for (const type of agentTypes) {
      expect(AGENT_DISPLAY[type]).toBeDefined();
    }
  });

  it("each entry has label, icon, description, and color", () => {
    for (const type of agentTypes) {
      const entry = AGENT_DISPLAY[type];
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
      expect(typeof entry.icon).toBe("string");
      expect(typeof entry.description).toBe("string");
      expect(typeof entry.color).toBe("string");
    }
  });

  it("maps supervisor to Chocolatier", () => {
    expect(AGENT_DISPLAY.supervisor.label).toBe("Chocolatier");
  });

  it("maps merge-queue to Temperer", () => {
    expect(AGENT_DISPLAY["merge-queue"].label).toBe("Temperer");
  });

  it("maps pr-shepherd to Enrober", () => {
    expect(AGENT_DISPLAY["pr-shepherd"].label).toBe("Enrober");
  });

  it("maps worker to Truffle", () => {
    expect(AGENT_DISPLAY.worker.label).toBe("Truffle");
  });
});

// ---------------------------------------------------------------------------
// STATUS_COLORS
// ---------------------------------------------------------------------------

describe("STATUS_COLORS", () => {
  const agentStatuses: AgentStatus[] = ["starting", "healthy", "working", "stuck", "stopped", "crashed"];
  const workerStatuses: WorkerStatus[] = ["starting", "working", "stuck", "completed", "failed", "terminated"];

  it("has a color for every AgentStatus", () => {
    for (const status of agentStatuses) {
      expect(STATUS_COLORS[status]).toBeDefined();
      expect(STATUS_COLORS[status]).toMatch(/^bg-/);
    }
  });

  it("has a color for every WorkerStatus", () => {
    for (const status of workerStatuses) {
      expect(STATUS_COLORS[status]).toBeDefined();
      expect(STATUS_COLORS[status]).toMatch(/^bg-/);
    }
  });

  it("uses green for healthy/working statuses", () => {
    expect(STATUS_COLORS.healthy).toMatch(/green/);
    expect(STATUS_COLORS.working).toMatch(/green/);
    expect(STATUS_COLORS.completed).toMatch(/green/);
  });

  it("uses red for error statuses", () => {
    expect(STATUS_COLORS.crashed).toMatch(/red/);
    expect(STATUS_COLORS.failed).toMatch(/red/);
  });

  it("uses yellow for stuck status", () => {
    expect(STATUS_COLORS.stuck).toMatch(/yellow/);
  });
});

// ---------------------------------------------------------------------------
// PR_STAGE_DISPLAY
// ---------------------------------------------------------------------------

describe("PR_STAGE_DISPLAY", () => {
  const stages: PRStage[] = ["draft", "ready", "ci_running", "ci_passed", "ci_failed", "merged"];

  it("has an entry for every PRStage", () => {
    for (const stage of stages) {
      expect(PR_STAGE_DISPLAY[stage]).toBeDefined();
    }
  });

  it("each entry has label, color, and progress", () => {
    for (const stage of stages) {
      const entry = PR_STAGE_DISPLAY[stage];
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.color).toBe("string");
      expect(entry.color).toMatch(/^bg-/);
      expect(typeof entry.progress).toBe("number");
      expect(entry.progress).toBeGreaterThanOrEqual(0);
      expect(entry.progress).toBeLessThanOrEqual(100);
    }
  });

  it("progress increases through the pipeline (draft < ready < ci_running < merged)", () => {
    expect(PR_STAGE_DISPLAY.draft.progress).toBeLessThan(PR_STAGE_DISPLAY.ready.progress);
    expect(PR_STAGE_DISPLAY.ready.progress).toBeLessThan(PR_STAGE_DISPLAY.ci_running.progress);
    expect(PR_STAGE_DISPLAY.ci_running.progress).toBeLessThan(PR_STAGE_DISPLAY.merged.progress);
  });

  it("merged has 100% progress", () => {
    expect(PR_STAGE_DISPLAY.merged.progress).toBe(100);
  });

  it("ci_failed has the same progress as ci_running (stuck at that stage)", () => {
    expect(PR_STAGE_DISPLAY.ci_failed.progress).toBe(PR_STAGE_DISPLAY.ci_running.progress);
  });
});

// ---------------------------------------------------------------------------
// Type shape checks (compile-time validation via runtime assertions)
// ---------------------------------------------------------------------------

describe("type shapes", () => {
  it("AgentOutputLine has the expected shape", () => {
    const line: AgentOutputLine = {
      agent: "chocolatier",
      text: "Monitoring 3 workers",
      timestamp: Date.now(),
      stream: "stdout",
    };
    expect(line.agent).toBe("chocolatier");
    expect(line.stream).toBe("stdout");
  });

  it("PRPipelineEntry has the expected shape", () => {
    const pr: PRPipelineEntry = {
      number: 47,
      title: "feat: add auth middleware",
      url: "https://github.com/org/repo/pull/47",
      branch: "work/Snickers",
      author: "Snickers",
      stage: "ci_running",
      workerName: "Snickers",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(pr.number).toBe(47);
    expect(pr.stage).toBe("ci_running");
  });

  it("MessageEntry has the expected shape", () => {
    const msg: MessageEntry = {
      id: "msg-123",
      type: "TASK_ASSIGNED",
      from: "chocolatier",
      to: "Snickers",
      priority: "normal",
      timestamp: Date.now(),
      acked: false,
      payloadPreview: '{"task": "Add tests"}',
    };
    expect(msg.type).toBe("TASK_ASSIGNED");
    expect(msg.acked).toBe(false);
  });

  it("SpawnWorkerRequest has the expected shape", () => {
    const req: SpawnWorkerRequest = {
      repoName: "my-app",
      task: "Add unit tests",
      branch: "feature/tests",
      model: "claude-sonnet-4-5",
    };
    expect(req.repoName).toBe("my-app");
    expect(req.model).toBe("claude-sonnet-4-5");
  });
});
