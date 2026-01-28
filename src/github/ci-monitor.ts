/**
 * CI Status Monitor
 *
 * Provides functions for monitoring GitHub Actions CI status on pull requests.
 * Used by the Temperer agent to determine when PRs are safe to merge and to
 * generate actionable summaries for fixup workers when CI fails.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type {
  CICheck,
  CIStatusResult,
  FailureCategory,
  ParsedCI,
  WorkflowRun,
} from "./types.js";

const execFile = promisify(execFileCb);

/** Raw check data as returned by `gh pr checks --json`. */
interface RawGHCheck {
  name: string;
  state: string;
  conclusion: string;
  detailsUrl?: string;
}

/** Function signature for executing shell commands. Exposed for testing. */
export type ExecFn = (
  file: string,
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Get the aggregated CI status for a pull request.
 *
 * Fetches check results via `gh pr checks` and parses them into a
 * structured result with failure categorization and summaries.
 */
export async function getCIStatus(
  prNumber: number,
  repo: string,
  exec: ExecFn = execFile,
): Promise<CIStatusResult> {
  let ghChecks: RawGHCheck[];

  try {
    const { stdout } = await exec(
      "gh",
      [
        "pr",
        "checks",
        String(prNumber),
        "--json",
        "name,state,conclusion,detailsUrl",
      ],
      { cwd: repo },
    );
    ghChecks = JSON.parse(stdout) as RawGHCheck[];
  } catch {
    return {
      status: "no_checks",
      checks: [],
      passedCount: 0,
      failedCount: 0,
      pendingCount: 0,
    };
  }

  if (ghChecks.length === 0) {
    return {
      status: "no_checks",
      checks: [],
      passedCount: 0,
      failedCount: 0,
      pendingCount: 0,
    };
  }

  const parsed = rawChecks.map((check): ParsedCI => {
    const conclusion = check.conclusion.toUpperCase();
    const state = check.state.toUpperCase();

    let status: ParsedCI["status"];
    if (conclusion === "FAILURE" || conclusion === "CANCELLED" || conclusion === "TIMED_OUT") {
      status = "failed";
    } else if (
      state === "PENDING" ||
      state === "QUEUED" ||
      state === "IN_PROGRESS"
    ) {
      status = "pending";
    } else {
      status = "passed";
    }

    return {
      name: check.name,
      status,
      category: categorizeFailure(check),
      detailsUrl: check.detailsUrl,
      conclusion: check.conclusion,
    };
  });

  const failed = parsed.filter((c) => c.status === "failed");
  const pending = parsed.filter((c) => c.status === "pending");
  const passed = parsed.filter((c) => c.status === "passed");

  if (failed.length > 0) {
    return {
      status: "failing",
      checks,
      failureSummary: generateFixupSummary(failed),
      workflowUrl: failed[0]?.detailsUrl,
      passedCount: passed.length,
      failedCount: failed.length,
      pendingCount: pending.length,
    };
  }

  if (pending.length > 0) {
    return {
      status: "pending",
      checks,
      passedCount: passed.length,
      failedCount: 0,
      pendingCount: pending.length,
    };
  }

  return {
    status: "passing",
    checks,
    passedCount: passed.length,
    failedCount: 0,
    pendingCount: 0,
  };
}

/**
 * Parse raw GitHub Actions workflow runs into structured results.
 *
 * Converts workflow run data (from `gh api`) into ParsedCI entries
 * with status and category information.
 */
export function parseWorkflowRuns(runs: WorkflowRun[]): ParsedCI[] {
  return runs.map((run): ParsedCI => {
    const conclusion = (run.conclusion ?? "").toUpperCase();
    const status = run.status.toUpperCase();

    let parsedStatus: ParsedCI["status"];
    if (conclusion === "FAILURE" || conclusion === "CANCELLED" || conclusion === "TIMED_OUT") {
      parsedStatus = "failed";
    } else if (
      status === "QUEUED" ||
      status === "IN_PROGRESS" ||
      status === "WAITING" ||
      status === "PENDING"
    ) {
      parsedStatus = "pending";
    } else {
      parsedStatus = "passed";
    }

    const check: CICheck = {
      name: run.name,
      status: run.status,
      conclusion: run.conclusion ?? "",
      url: run.html_url,
      detailsUrl: run.html_url,
    };

    return {
      name: run.name,
      status: parsedStatus,
      category: categorizeFailure(check),
      detailsUrl: run.html_url,
      conclusion: run.conclusion ?? "",
    };
  });
}

/**
 * Categorize a CI check failure by its name.
 *
 * Uses heuristic name matching to determine the type of failure:
 * - "lint" for linting/formatting checks
 * - "test" for test suite checks
 * - "build" for compilation/build checks
 * - "typecheck" for type checking
 * - "other" for anything else
 */
export function categorizeFailure(check: CICheck): FailureCategory {
  const name = check.name.toLowerCase();

  if (
    name.includes("lint") ||
    name.includes("eslint") ||
    name.includes("prettier") ||
    name.includes("format") ||
    name.includes("style")
  ) {
    return "lint";
  }

  if (
    name.includes("test") ||
    name.includes("spec") ||
    name.includes("jest") ||
    name.includes("vitest") ||
    name.includes("mocha") ||
    name.includes("pytest") ||
    name.includes("coverage")
  ) {
    return "test";
  }

  if (
    name.includes("build") ||
    name.includes("compile") ||
    name.includes("bundle") ||
    name.includes("webpack") ||
    name.includes("vite") ||
    name.includes("rollup")
  ) {
    return "build";
  }

  if (
    name.includes("typecheck") ||
    name.includes("type-check") ||
    name.includes("tsc") ||
    name.includes("typescript")
  ) {
    return "typecheck";
  }

  return "other";
}

/**
 * Generate an actionable summary for fixup workers from a list of failures.
 *
 * Produces a human-readable summary grouped by failure category,
 * suitable for inclusion in a fixup worker's task description.
 */
export function generateFixupSummary(failures: ParsedCI[]): string {
  if (failures.length === 0) {
    return "No failures detected.";
  }

  const byCategory = new Map<FailureCategory, ParsedCI[]>();
  for (const f of failures) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }

  const lines: string[] = [];
  lines.push(`${failures.length} CI check(s) failed:`);

  const categoryLabels: Record<FailureCategory, string> = {
    lint: "Lint/Format",
    test: "Tests",
    build: "Build",
    typecheck: "Type Check",
    other: "Other",
  };

  const categoryOrder: FailureCategory[] = ["build", "typecheck", "test", "lint", "other"];

  for (const category of categoryOrder) {
    const items = byCategory.get(category);
    if (!items) continue;

    lines.push(`  ${categoryLabels[category]}:`);
    for (const item of items) {
      const urlPart = item.detailsUrl ? ` (${item.detailsUrl})` : "";
      lines.push(`    - ${item.name}${urlPart}`);
    }
  }

  return lines.join("\n");
}
