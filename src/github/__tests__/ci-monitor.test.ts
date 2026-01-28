import {
  getCIStatus,
  parseWorkflowRuns,
  categorizeFailure,
  generateFixupSummary,
  type ExecFn,
} from "../ci-monitor";
import type { CICheck, ParsedCI, WorkflowRun } from "../types";

// --- Helpers ---

/** Raw gh pr checks output format (uses "state" not "status"). */
interface RawGHCheck {
  name: string;
  state: string;
  conclusion: string;
  detailsUrl?: string;
}

function makeRawCheck(overrides: Partial<RawGHCheck> = {}): RawGHCheck {
  return {
    name: "build",
    state: "COMPLETED",
    conclusion: "SUCCESS",
    detailsUrl: "https://github.com/org/repo/actions/runs/1",
    ...overrides,
  };
}

function checksJson(checks: Array<Partial<RawGHCheck>>): string {
  return JSON.stringify(checks.map((c) => makeRawCheck(c)));
}

/** CICheck helper for categorizeFailure tests (uses CICheck interface). */
function makeCheck(overrides: Partial<CICheck> = {}): CICheck {
  return {
    name: "build",
    status: "COMPLETED",
    conclusion: "SUCCESS",
    url: "https://github.com/org/repo/actions/runs/1",
    detailsUrl: "https://github.com/org/repo/actions/runs/1",
    ...overrides,
  };
}

function makeExecFn(stdout: string): ExecFn {
  return async () => ({ stdout, stderr: "" });
}

function failingExecFn(): ExecFn {
  return async () => {
    throw new Error("gh command failed");
  };
}

// --- Tests ---

describe("getCIStatus", () => {
  it("returns passing when all checks succeed", async () => {
    const exec = makeExecFn(
      checksJson([
        { name: "build", conclusion: "SUCCESS" },
        { name: "test", conclusion: "SUCCESS" },
      ]),
    );

    const result = await getCIStatus(42, "/tmp/repo", exec);

    expect(result.status).toBe("passing");
    expect(result.passedCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.pendingCount).toBe(0);
    expect(result.failureSummary).toBeUndefined();
  });

  it("returns failing with summary when checks fail", async () => {
    const exec = makeExecFn(
      checksJson([
        { name: "build", conclusion: "SUCCESS" },
        {
          name: "test-suite",
          conclusion: "FAILURE",
          detailsUrl: "https://github.com/org/repo/actions/runs/999",
        },
      ]),
    );

    const result = await getCIStatus(42, "/tmp/repo", exec);

    expect(result.status).toBe("failing");
    expect(result.failedCount).toBe(1);
    expect(result.passedCount).toBe(1);
    expect(result.failureSummary).toContain("1 CI check(s) failed");
    expect(result.failureSummary).toContain("test-suite");
    expect(result.workflowUrl).toBe(
      "https://github.com/org/repo/actions/runs/999",
    );
  });

  it("returns pending when checks are in progress", async () => {
    const exec = makeExecFn(
      checksJson([
        { name: "build", state: "IN_PROGRESS", conclusion: "" },
      ]),
    );

    const result = await getCIStatus(42, "/tmp/repo", exec);

    expect(result.status).toBe("pending");
    expect(result.pendingCount).toBe(1);
  });

  it("returns pending for queued checks", async () => {
    const exec = makeExecFn(
      checksJson([
        { name: "build", state: "QUEUED", conclusion: "" },
      ]),
    );

    const result = await getCIStatus(42, "/tmp/repo", exec);

    expect(result.status).toBe("pending");
  });

  it("returns no_checks when no checks exist", async () => {
    const exec = makeExecFn("[]");

    const result = await getCIStatus(42, "/tmp/repo", exec);

    expect(result.status).toBe("no_checks");
    expect(result.checks).toHaveLength(0);
  });

  it("returns no_checks when gh command fails", async () => {
    const exec = failingExecFn();

    const result = await getCIStatus(42, "/tmp/repo", exec);

    expect(result.status).toBe("no_checks");
    expect(result.checks).toEqual([]);
    expect(result.passedCount).toBe(0);
  });

  it("treats CANCELLED conclusion as failed", async () => {
    const exec = makeExecFn(
      checksJson([{ name: "build", conclusion: "CANCELLED" }]),
    );

    const result = await getCIStatus(42, "/tmp/repo", exec);

    expect(result.status).toBe("failing");
    expect(result.failedCount).toBe(1);
  });

  it("treats TIMED_OUT conclusion as failed", async () => {
    const exec = makeExecFn(
      checksJson([{ name: "deploy", conclusion: "TIMED_OUT" }]),
    );

    const result = await getCIStatus(42, "/tmp/repo", exec);

    expect(result.status).toBe("failing");
    expect(result.failedCount).toBe(1);
  });

  it("passes correct args to gh command", async () => {
    let capturedArgs: string[] = [];
    let capturedCwd = "";

    const exec: ExecFn = async (_file, args, opts) => {
      capturedArgs = args;
      capturedCwd = opts.cwd;
      return { stdout: "[]", stderr: "" };
    };

    await getCIStatus(123, "/my/repo", exec);

    expect(capturedArgs).toEqual([
      "pr",
      "checks",
      "123",
      "--json",
      "name,state,conclusion,detailsUrl",
    ]);
    expect(capturedCwd).toBe("/my/repo");
  });

  it("handles mixed passing, failing, and pending checks", async () => {
    const exec = makeExecFn(
      checksJson([
        { name: "lint", conclusion: "SUCCESS" },
        { name: "test", conclusion: "FAILURE" },
        { name: "build", state: "PENDING", conclusion: "" },
      ]),
    );

    const result = await getCIStatus(42, "/tmp/repo", exec);

    // Failing takes priority over pending
    expect(result.status).toBe("failing");
    expect(result.passedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.pendingCount).toBe(1);
  });
});

describe("parseWorkflowRuns", () => {
  function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
    return {
      id: 1,
      name: "CI",
      status: "completed",
      conclusion: "success",
      html_url: "https://github.com/org/repo/actions/runs/1",
      run_started_at: "2026-01-28T00:00:00Z",
      jobs_url: "https://api.github.com/repos/org/repo/actions/runs/1/jobs",
      ...overrides,
    };
  }

  it("parses successful workflow runs", () => {
    const runs = [makeRun({ name: "build", conclusion: "success" })];
    const result = parseWorkflowRuns(runs);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("build");
    expect(result[0].status).toBe("passed");
  });

  it("parses failed workflow runs", () => {
    const runs = [makeRun({ name: "test", conclusion: "failure" })];
    const result = parseWorkflowRuns(runs);

    expect(result[0].status).toBe("failed");
    expect(result[0].category).toBe("test");
  });

  it("parses pending workflow runs", () => {
    const runs = [
      makeRun({ name: "build", status: "in_progress", conclusion: null }),
    ];
    const result = parseWorkflowRuns(runs);

    expect(result[0].status).toBe("pending");
  });

  it("parses queued workflow runs as pending", () => {
    const runs = [
      makeRun({ name: "test", status: "queued", conclusion: null }),
    ];
    const result = parseWorkflowRuns(runs);

    expect(result[0].status).toBe("pending");
  });

  it("parses cancelled workflow runs as failed", () => {
    const runs = [makeRun({ name: "deploy", conclusion: "cancelled" })];
    const result = parseWorkflowRuns(runs);

    expect(result[0].status).toBe("failed");
  });

  it("handles null conclusion gracefully", () => {
    const runs = [
      makeRun({ name: "build", status: "waiting", conclusion: null }),
    ];
    const result = parseWorkflowRuns(runs);

    expect(result[0].status).toBe("pending");
    expect(result[0].conclusion).toBe("");
  });

  it("preserves URL from workflow run", () => {
    const url = "https://github.com/org/repo/actions/runs/42";
    const runs = [makeRun({ html_url: url })];
    const result = parseWorkflowRuns(runs);

    expect(result[0].detailsUrl).toBe(url);
  });

  it("returns empty array for empty input", () => {
    expect(parseWorkflowRuns([])).toEqual([]);
  });
});

describe("categorizeFailure", () => {
  it("categorizes lint checks", () => {
    expect(categorizeFailure(makeCheck({ name: "lint" }))).toBe("lint");
    expect(categorizeFailure(makeCheck({ name: "ESLint" }))).toBe("lint");
    expect(categorizeFailure(makeCheck({ name: "prettier-check" }))).toBe("lint");
    expect(categorizeFailure(makeCheck({ name: "format" }))).toBe("lint");
    expect(categorizeFailure(makeCheck({ name: "style-lint" }))).toBe("lint");
  });

  it("categorizes test checks", () => {
    expect(categorizeFailure(makeCheck({ name: "test" }))).toBe("test");
    expect(categorizeFailure(makeCheck({ name: "unit-tests" }))).toBe("test");
    expect(categorizeFailure(makeCheck({ name: "jest" }))).toBe("test");
    expect(categorizeFailure(makeCheck({ name: "vitest" }))).toBe("test");
    expect(categorizeFailure(makeCheck({ name: "run-specs" }))).toBe("test");
    expect(categorizeFailure(makeCheck({ name: "mocha-suite" }))).toBe("test");
    expect(categorizeFailure(makeCheck({ name: "pytest" }))).toBe("test");
    expect(categorizeFailure(makeCheck({ name: "coverage" }))).toBe("test");
  });

  it("categorizes build checks", () => {
    expect(categorizeFailure(makeCheck({ name: "build" }))).toBe("build");
    expect(categorizeFailure(makeCheck({ name: "compile" }))).toBe("build");
    expect(categorizeFailure(makeCheck({ name: "webpack-build" }))).toBe("build");
    expect(categorizeFailure(makeCheck({ name: "vite-build" }))).toBe("build");
    expect(categorizeFailure(makeCheck({ name: "rollup" }))).toBe("build");
    expect(categorizeFailure(makeCheck({ name: "bundle" }))).toBe("build");
  });

  it("categorizes typecheck checks", () => {
    expect(categorizeFailure(makeCheck({ name: "typecheck" }))).toBe("typecheck");
    expect(categorizeFailure(makeCheck({ name: "type-check" }))).toBe("typecheck");
    expect(categorizeFailure(makeCheck({ name: "tsc" }))).toBe("typecheck");
    expect(categorizeFailure(makeCheck({ name: "typescript-check" }))).toBe("typecheck");
  });

  it("returns other for unrecognized checks", () => {
    expect(categorizeFailure(makeCheck({ name: "deploy" }))).toBe("other");
    expect(categorizeFailure(makeCheck({ name: "security-scan" }))).toBe("other");
    expect(categorizeFailure(makeCheck({ name: "codeql" }))).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(categorizeFailure(makeCheck({ name: "LINT" }))).toBe("lint");
    expect(categorizeFailure(makeCheck({ name: "Test" }))).toBe("test");
    expect(categorizeFailure(makeCheck({ name: "BUILD" }))).toBe("build");
  });
});

describe("generateFixupSummary", () => {
  function makeParsed(overrides: Partial<ParsedCI> = {}): ParsedCI {
    return {
      name: "test",
      status: "failed",
      category: "test",
      detailsUrl: "",
      conclusion: "FAILURE",
      ...overrides,
    };
  }

  it("returns no-failure message for empty array", () => {
    const result = generateFixupSummary([]);
    expect(result).toBe("No failures detected.");
  });

  it("generates summary for a single failure", () => {
    const failures = [
      makeParsed({
        name: "unit-tests",
        category: "test",
        detailsUrl: "https://example.com/run/1",
      }),
    ];

    const result = generateFixupSummary(failures);

    expect(result).toContain("1 CI check(s) failed:");
    expect(result).toContain("Tests:");
    expect(result).toContain("unit-tests");
    expect(result).toContain("https://example.com/run/1");
  });

  it("groups failures by category", () => {
    const failures = [
      makeParsed({ name: "jest", category: "test" }),
      makeParsed({ name: "eslint", category: "lint" }),
      makeParsed({ name: "build", category: "build" }),
    ];

    const result = generateFixupSummary(failures);

    expect(result).toContain("3 CI check(s) failed:");
    expect(result).toContain("Tests:");
    expect(result).toContain("Lint/Format:");
    expect(result).toContain("Build:");
  });

  it("orders categories: build, typecheck, test, lint, other", () => {
    const failures = [
      makeParsed({ name: "lint-check", category: "lint" }),
      makeParsed({ name: "deploy", category: "other" }),
      makeParsed({ name: "tsc", category: "typecheck" }),
      makeParsed({ name: "build-app", category: "build" }),
      makeParsed({ name: "jest", category: "test" }),
    ];

    const result = generateFixupSummary(failures);
    const lines = result.split("\n");

    // Find category header positions
    const buildIdx = lines.findIndex((l) => l.includes("Build:"));
    const typecheckIdx = lines.findIndex((l) => l.includes("Type Check:"));
    const testIdx = lines.findIndex((l) => l.includes("Tests:"));
    const lintIdx = lines.findIndex((l) => l.includes("Lint/Format:"));
    const otherIdx = lines.findIndex((l) => l.includes("Other:"));

    expect(buildIdx).toBeLessThan(typecheckIdx);
    expect(typecheckIdx).toBeLessThan(testIdx);
    expect(testIdx).toBeLessThan(lintIdx);
    expect(lintIdx).toBeLessThan(otherIdx);
  });

  it("includes details URLs when present", () => {
    const failures = [
      makeParsed({ name: "test", detailsUrl: "https://example.com/run/42" }),
    ];

    const result = generateFixupSummary(failures);
    expect(result).toContain("(https://example.com/run/42)");
  });

  it("omits URL part when detailsUrl is empty", () => {
    const failures = [makeParsed({ name: "test", detailsUrl: "" })];

    const result = generateFixupSummary(failures);
    expect(result).not.toContain("()");
  });
});
