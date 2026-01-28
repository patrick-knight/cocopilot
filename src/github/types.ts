/**
 * GitHub CI Status Types
 *
 * Types for CI status monitoring, workflow run parsing, and failure
 * categorization used by the Temperer agent.
 */

/** Categorization of a CI check failure. */
export type FailureCategory = "lint" | "test" | "build" | "typecheck" | "other";

/** A single CI check as returned by `gh pr checks`. */
export interface CICheck {
  name: string;
  state: string;
  conclusion: string;
  detailsUrl: string;
}

/** A GitHub Actions workflow run as returned by `gh api`. */
export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  run_started_at: string;
  jobs_url: string;
}

/** A parsed CI result with structured failure information. */
export interface ParsedCI {
  name: string;
  status: "passed" | "failed" | "pending";
  category: FailureCategory;
  detailsUrl: string;
  conclusion: string;
}

/** Aggregated CI status result for a PR. */
export interface CIStatusResult {
  /** Overall CI status. */
  status: "passing" | "failing" | "pending" | "no_checks";
  /** All parsed CI checks. */
  checks: ParsedCI[];
  /** Summary of failures (if any). */
  failureSummary?: string;
  /** URL to the first failing workflow (if any). */
  workflowUrl?: string;
  /** Number of checks that passed. */
  passedCount: number;
  /** Number of checks that failed. */
  failedCount: number;
  /** Number of checks still pending. */
  pendingCount: number;
}
