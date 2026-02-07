/**
 * GitHub CLI Helper Functions
 *
 * Typed wrappers around `gh` CLI commands for common GitHub operations.
 * All functions accept an ExecFn for dependency injection (testability)
 * and a repository path for `cwd`.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import type {
  CIStatusResult,
  CIStatusSummary,
  CreatePROptions,
  CreatePRResult,
  ExecFn,
  ListPRsOptions,
  MergePROptions,
  MergePRResult,
  ParsedCI,
  PRInfo,
  PRReview,
  RepoInfo,
} from "./types.js";
import { categorizeFailure } from "./ci-monitor.js";

const execFileDefault = promisify(execFileCb);

/** Shared context for all helper functions. */
export interface GitHubHelperContext {
  /** Path to the git repository working directory. */
  repoPath: string;
  /** Optional exec function override for testing. */
  execFn?: ExecFn;
}

function exec(ctx: GitHubHelperContext): ExecFn {
  return ctx.execFn ?? execFileDefault;
}

/**
 * Create a pull request.
 *
 * Runs: `gh pr create --title ... --body ... --head ... [--base ...] [--draft] [--label ...]`
 */
export async function createPR(
  ctx: GitHubHelperContext,
  options: CreatePROptions,
): Promise<CreatePRResult> {
  const args = [
    "pr",
    "create",
    "--title",
    options.title,
    "--body",
    options.body,
    "--head",
    options.head,
  ];

  if (options.base) {
    args.push("--base", options.base);
  }
  if (options.draft) {
    args.push("--draft");
  }
  if (options.labels && options.labels.length > 0) {
    args.push("--label", options.labels.join(","));
  }

  const { stdout } = await exec(ctx)("gh", args, { cwd: ctx.repoPath });

  // gh pr create outputs the PR URL on success
  const url = stdout.trim();
  const numberMatch = /\/pull\/(\d+)/.exec(url);
  const number = numberMatch ? parseInt(numberMatch[1], 10) : 0;

  return { number, url };
}

/**
 * List pull requests matching the given filters.
 *
 * Runs: `gh pr list --state ... --json ... [--label ...] [--limit ...] [--base ...]`
 */
export async function listPRs(
  ctx: GitHubHelperContext,
  options?: ListPRsOptions,
): Promise<PRInfo[]> {
  const state = options?.state ?? "open";
  const limit = options?.limit ?? 100;

  const args = [
    "pr",
    "list",
    "--state",
    state,
    "--json",
    "number,title,headRefName,baseRefName,url,author,isDraft,state,labels,createdAt,updatedAt",
    "--limit",
    String(limit),
  ];

  if (options?.label) {
    args.push("--label", options.label);
  }
  if (options?.base) {
    args.push("--base", options.base);
  }

  try {
    const { stdout } = await exec(ctx)("gh", args, { cwd: ctx.repoPath });

    const raw = JSON.parse(stdout) as Array<{
      number: number;
      title: string;
      headRefName: string;
      baseRefName: string;
      url: string;
      author: { login: string };
      isDraft: boolean;
      state: string;
      labels: Array<{ name: string }>;
      createdAt: string;
      updatedAt: string;
    }>;

    return raw.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      url: pr.url,
      author: pr.author.login,
      isDraft: pr.isDraft,
      state: pr.state,
      labels: pr.labels.map((l) => l.name),
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
    }));
  } catch {
    return [];
  }
}

/**
 * Get CI status for a pull request.
 *
 * Runs: `gh pr checks <number> --json name,state,conclusion,detailsUrl`
 */
export async function getCIStatus(
  ctx: GitHubHelperContext,
  prNumber: number,
): Promise<CIStatusResult> {
  try {
    const { stdout } = await exec(ctx)(
      "gh",
      [
        "pr",
        "checks",
        String(prNumber),
        "--json",
        "name,state,conclusion,detailsUrl",
      ],
      { cwd: ctx.repoPath },
    );

    const rawChecks = JSON.parse(stdout) as Array<{
      name: string;
      state: string;
      conclusion: string;
      detailsUrl: string;
    }>;

    const checks: ParsedCI[] = rawChecks.map((c) => {
      const conclusion = (c.conclusion ?? "").toUpperCase();
      const state = (c.state ?? "").toUpperCase();

      let status: ParsedCI["status"];
      if (conclusion === "FAILURE" || conclusion === "TIMED_OUT" || conclusion === "CANCELLED") {
        status = "failed";
      } else if (state === "PENDING" || state === "QUEUED" || state === "IN_PROGRESS") {
        status = "pending";
      } else {
        status = "passed";
      }

      return {
        name: c.name,
        status,
        category: categorizeFailure({
          name: c.name,
          state: c.state,
          conclusion: c.conclusion,
          detailsUrl: c.detailsUrl,
        }),
        detailsUrl: c.detailsUrl,
        conclusion: c.conclusion,
      };
    });

    if (checks.length === 0) {
      return { status: "no_checks", checks };
    }

    const failed = checks.filter((c) => c.status === "failed");
    const pending = checks.filter((c) => c.status === "pending");

    if (failed.length > 0) {
      const failedNames = failed.map((c) => c.name).join(", ");
      const failureSummary = `${failed.length} check(s) failed: ${failedNames}`;
      const workflowUrl = failed[0]?.detailsUrl;
      return { status: "failing", checks, failureSummary, workflowUrl };
    }

    if (pending.length > 0) {
      return { status: "pending", checks };
    }

    return { status: "passing", checks };
  } catch {
    return { status: "no_checks", checks: [] };
  }
}

/**
 * Merge a pull request.
 *
 * Runs: `gh pr merge <number> --squash|--merge|--rebase [--delete-branch]`
 */
export async function mergePR(
  ctx: GitHubHelperContext,
  prNumber: number,
  options?: MergePROptions,
): Promise<MergePRResult> {
  const method = options?.method ?? "squash";
  const deleteBranch = options?.deleteBranch ?? true;

  const args = ["pr", "merge", String(prNumber), `--${method}`];
  if (deleteBranch) {
    args.push("--delete-branch");
  }

  try {
    const { stdout } = await exec(ctx)("gh", args, { cwd: ctx.repoPath });

    // Try to extract merge SHA from gh output
    const shaMatch = /([0-9a-f]{40})/i.exec(stdout);
    const sha = shaMatch ? shaMatch[1] : "unknown";

    return { merged: true, sha };
  } catch {
    return { merged: false, sha: "" };
  }
}

/**
 * Add labels to a pull request.
 *
 * Runs: `gh pr edit <number> --add-label label1,label2`
 */
export async function addLabels(
  ctx: GitHubHelperContext,
  prNumber: number,
  labels: string[],
): Promise<boolean> {
  if (labels.length === 0) return true;

  try {
    await exec(ctx)(
      "gh",
      ["pr", "edit", String(prNumber), "--add-label", labels.join(",")],
      { cwd: ctx.repoPath },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Get reviews for a pull request.
 *
 * Runs: `gh pr view <number> --json reviews`
 */
export async function getPRReviews(
  ctx: GitHubHelperContext,
  prNumber: number,
): Promise<PRReview[]> {
  try {
    const { stdout } = await exec(ctx)(
      "gh",
      [
        "pr",
        "view",
        String(prNumber),
        "--json",
        "reviews",
      ],
      { cwd: ctx.repoPath },
    );

    const parsed = JSON.parse(stdout) as {
      reviews: Array<{
        author: { login: string };
        state: string;
        body: string;
        submittedAt: string;
      }>;
    };

    return parsed.reviews.map((r) => ({
      author: r.author.login,
      state: r.state,
      body: r.body,
      submittedAt: r.submittedAt,
    }));
  } catch {
    return [];
  }
}

/** Result of checking PR mergeability. */
export interface MergeabilityResult {
  mergeable: boolean;
  reason?: string;
  baseBranch?: string;
}

/**
 * Check if a PR has merge conflicts with its base branch.
 *
 * Runs: `gh pr view <number> --json mergeable,mergeStateStatus,baseRefName`
 * Returns mergeable: true if the check fails (to avoid blocking merges).
 */
export async function checkMergeability(
  ctx: GitHubHelperContext,
  prNumber: number,
): Promise<MergeabilityResult> {
  try {
    const { stdout } = await exec(ctx)(
      "gh",
      [
        "pr",
        "view",
        String(prNumber),
        "--json",
        "mergeable,mergeStateStatus,baseRefName",
      ],
      { cwd: ctx.repoPath },
    );

    const data = JSON.parse(stdout) as {
      mergeable: string;
      mergeStateStatus: string;
      baseRefName: string;
    };

    if (data.mergeable === "CONFLICTING" || data.mergeStateStatus === "DIRTY") {
      return {
        mergeable: false,
        reason: `mergeable=${data.mergeable}, mergeStateStatus=${data.mergeStateStatus}`,
        baseBranch: data.baseRefName,
      };
    }

    return { mergeable: true, baseBranch: data.baseRefName };
  } catch {
    // If check fails, don't block the merge
    return { mergeable: true };
  }
}

/**
 * Get repository information.
 *
 * Runs: `gh repo view --json name,nameWithOwner,url,defaultBranchRef,isFork,parent,isPrivate`
 */
export async function getRepoInfo(
  ctx: GitHubHelperContext,
): Promise<RepoInfo | null> {
  try {
    const { stdout } = await exec(ctx)(
      "gh",
      [
        "repo",
        "view",
        "--json",
        "name,nameWithOwner,url,defaultBranchRef,isFork,parent,isPrivate",
      ],
      { cwd: ctx.repoPath },
    );

    const raw = JSON.parse(stdout) as {
      name: string;
      nameWithOwner: string;
      url: string;
      defaultBranchRef: { name: string };
      isFork: boolean;
      parent: { nameWithOwner: string } | null;
      isPrivate: boolean;
    };

    return {
      name: raw.name,
      nameWithOwner: raw.nameWithOwner,
      url: raw.url,
      defaultBranch: raw.defaultBranchRef.name,
      isFork: raw.isFork,
      parent: raw.parent?.nameWithOwner ?? null,
      isPrivate: raw.isPrivate,
    };
  } catch {
    return null;
  }
}
