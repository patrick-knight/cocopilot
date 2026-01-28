/**
 * GitHub Integration Types
 *
 * Type definitions for GitHub API interactions used across CoCoPilot.
 * Includes CI monitoring types (used by Temperer) and helper function
 * types (used by MCP integration and GitHub operations).
 */

// ─── CI Monitor Types (used by ci-monitor.ts / Temperer) ───

/** Categorization of a CI check failure. */
export type FailureCategory = "lint" | "test" | "build" | "typecheck" | "other";

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

// ─── GitHub Integration Types (used by helpers.ts / MCP) ───

/** PR lifecycle status as tracked by CoCoPilot. */
export type PRStatus =
  | "draft"
  | "ready"
  | "ci_running"
  | "ci_passed"
  | "merged";

/** Status of an individual CI check from GitHub Actions. */
export interface CICheck {
  /** Name of the check run (e.g., "build", "test"). */
  name: string;
  /** Current state (e.g., "COMPLETED", "IN_PROGRESS", "QUEUED"). */
  state: string;
  /** Check conclusion (e.g., "SUCCESS", "FAILURE", "NEUTRAL"). Empty if not completed. */
  conclusion: string;
  /** URL to the check details page. */
  detailsUrl: string;
}

/** A GitHub label. */
export interface GitHubLabel {
  /** Label name (e.g., "cocopilot", "bug"). */
  name: string;
  /** Label color hex code (e.g., "0e8a16"). */
  color: string;
  /** Label description. */
  description: string;
}

/** Information about a pull request from `gh pr list` or `gh pr view`. */
export interface PRInfo {
  /** PR number. */
  number: number;
  /** PR title. */
  title: string;
  /** Head branch name (e.g., "work/Snickers"). */
  headRefName: string;
  /** Base branch name (e.g., "main"). */
  baseRefName: string;
  /** Full PR URL. */
  url: string;
  /** Author login (e.g., "bot"). */
  author: string;
  /** Whether the PR is a draft. */
  isDraft: boolean;
  /** Current PR state (e.g., "OPEN", "CLOSED", "MERGED"). */
  state: string;
  /** Labels applied to the PR. */
  labels: string[];
  /** When the PR was created (ISO 8601). */
  createdAt: string;
  /** When the PR was last updated (ISO 8601). */
  updatedAt: string;
}

/** A review on a pull request. */
export interface PRReview {
  /** Reviewer login. */
  author: string;
  /** Review state: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING. */
  state: string;
  /** Review body text. */
  body: string;
  /** When the review was submitted (ISO 8601). */
  submittedAt: string;
}

/** Information about a GitHub repository. */
export interface RepoInfo {
  /** Repository name (e.g., "cocopilot"). */
  name: string;
  /** Full repository name (e.g., "org/cocopilot"). */
  nameWithOwner: string;
  /** Repository URL. */
  url: string;
  /** Default branch name (e.g., "main"). */
  defaultBranch: string;
  /** Whether this repo is a fork. */
  isFork: boolean;
  /** Parent repository name if this is a fork. */
  parent: string | null;
  /** Whether the repo is private. */
  isPrivate: boolean;
}

/** Aggregated CI status for a PR. */
export type CIStatusSummary = "passing" | "failing" | "pending" | "no_checks";

/** Result of a CI status check. */
export interface CIStatusResult {
  /** Aggregated status. */
  status: CIStatusSummary;
  /** Individual check results. */
  checks: ParsedCI[];
  /** Human-readable summary of failures (if any). */
  failureSummary?: string;
  /** URL to the first failing workflow (if any). */
  workflowUrl?: string;
  /** Number of checks that passed. */
  passedCount?: number;
  /** Number of checks that failed. */
  failedCount?: number;
  /** Number of checks still pending. */
  pendingCount?: number;
}

/** Options for creating a pull request. */
export interface CreatePROptions {
  /** PR title. */
  title: string;
  /** PR body/description. */
  body: string;
  /** Base branch to merge into. Defaults to repo default branch. */
  base?: string;
  /** Head branch containing changes. */
  head: string;
  /** Whether to create as draft. */
  draft?: boolean;
  /** Labels to apply. */
  labels?: string[];
}

/** Result of creating a pull request. */
export interface CreatePRResult {
  /** PR number. */
  number: number;
  /** Full PR URL. */
  url: string;
}

/** Options for listing pull requests. */
export interface ListPRsOptions {
  /** Filter by state. Defaults to "open". */
  state?: "open" | "closed" | "merged" | "all";
  /** Filter by label. */
  label?: string;
  /** Maximum number of results. Defaults to 100. */
  limit?: number;
  /** Base branch filter. */
  base?: string;
}

/** Options for merging a pull request. */
export interface MergePROptions {
  /** Merge method. Defaults to "squash". */
  method?: "merge" | "squash" | "rebase";
  /** Whether to delete the branch after merge. Defaults to true. */
  deleteBranch?: boolean;
}

/** Result of merging a pull request. */
export interface MergePRResult {
  /** Whether the merge was successful. */
  merged: boolean;
  /** Merge commit SHA. */
  sha: string;
}

/** Function signature for executing shell commands. Exposed for testing. */
export type ExecFn = (
  file: string,
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

// ─── Fork Detection Types ───

/**
 * GitHub-specific types for fork detection and repository configuration.
 */

export interface ForkInfo {
  isFork: boolean;
  parentOwner?: string;
  parentRepo?: string;
  sourceOwner?: string;
  sourceRepo?: string;
  defaultBranch: string;
}
