/**
 * PR pipeline routes (nested under a repository).
 *
 * GET /api/v1/repositories/:repoName/prs -- List PRs with pipeline stage info
 *
 * Derives PR pipeline data from:
 * 1. Worker state (workers that have created PRs)
 * 2. GitHub API (open PRs in the repository)
 *
 * This provides a complete view of all PRs, whether created by CoCoPilot workers
 * or through other means.
 */

import { Router } from "express";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { StateManager } from "../../state/index.js";
import type { WorkerState, WorkerStatus } from "../../state/index.js";
import { createApiError } from "../middleware/error-handler.js";

const execAsync = promisify(exec);

interface RepoParams {
  repoName: string;
  [key: string]: string;
}

/** Stages a PR progresses through in the merge pipeline. */
type PRStage = "draft" | "ready" | "ci_running" | "ci_passed" | "ci_failed" | "merged";

/** A pull request tracked in the pipeline visualization. */
interface PRPipelineEntry {
  number: number;
  title: string;
  url: string;
  branch: string;
  author: string;
  stage: PRStage;
  workerName?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Map worker status to a PR pipeline stage.
 *
 * The mapping captures the typical flow:
 *   worker starting/working → draft (PR just created, worker still active)
 *   worker completed         → ready (work done, awaiting CI)
 *   worker stuck             → ci_running (PR exists, something stalled)
 *   worker failed            → ci_failed
 *   worker terminated        → ci_failed (abnormal stop)
 *
 * The "merged" stage is not derived from worker status; it comes from broker
 * events (PR_MERGED) which update worker state externally.
 */
function workerStatusToStage(status: WorkerStatus): PRStage {
  switch (status) {
    case "starting":
    case "working":
      return "draft";
    case "completed":
      return "ready";
    case "stuck":
      return "ci_running";
    case "failed":
    case "terminated":
      return "ci_failed";
    default:
      return "draft";
  }
}

/**
 * Convert a worker with a PR into a PRPipelineEntry.
 */
function workerToPipelineEntry(worker: Readonly<WorkerState>): PRPipelineEntry {
  return {
    number: worker.prNumber!,
    title: worker.task,
    url: worker.prUrl ?? "",
    branch: worker.branch,
    author: worker.name,
    stage: workerStatusToStage(worker.status),
    workerName: worker.name,
    createdAt: worker.createdAt,
    updatedAt: worker.updatedAt,
  };
}

/** GitHub PR from gh CLI JSON output */
interface GitHubPR {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  author: { login: string };
  isDraft: boolean;
  state: string;
  createdAt: string;
  updatedAt: string;
  statusCheckRollup?: Array<{ state: string }> | null;
}

/**
 * Fetch open PRs from GitHub using the gh CLI.
 */
async function fetchGitHubPRs(repoPath: string): Promise<PRPipelineEntry[]> {
  try {
    const { stdout } = await execAsync(
      'gh pr list --state open --json number,title,url,headRefName,author,isDraft,state,createdAt,updatedAt,statusCheckRollup --limit 50',
      { cwd: repoPath, timeout: 15000 }
    );
    
    const prs: GitHubPR[] = JSON.parse(stdout || '[]');
    
    return prs.map((pr): PRPipelineEntry => {
      // Determine stage from GitHub PR state
      let stage: PRStage = "ready";
      if (pr.isDraft) {
        stage = "draft";
      } else if (pr.state === "MERGED") {
        stage = "merged";
      } else if (pr.statusCheckRollup && pr.statusCheckRollup.length > 0) {
        const hasFailure = pr.statusCheckRollup.some((c) => c.state === "FAILURE" || c.state === "ERROR");
        const hasPending = pr.statusCheckRollup.some((c) => c.state === "PENDING" || c.state === "EXPECTED");
        const allSuccess = pr.statusCheckRollup.every((c) => c.state === "SUCCESS");
        
        if (hasFailure) {
          stage = "ci_failed";
        } else if (allSuccess) {
          stage = "ci_passed";
        } else if (hasPending) {
          stage = "ci_running";
        }
      }

      return {
        number: pr.number,
        title: pr.title,
        url: pr.url,
        branch: pr.headRefName,
        author: pr.author?.login ?? "unknown",
        stage,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
      };
    });
  } catch (err) {
    // gh CLI not available or failed - return empty
    console.error('[PRRoutes] Failed to fetch GitHub PRs:', err instanceof Error ? err.message : err);
    return [];
  }
}

export function prRoutes(stateManager: StateManager): Router {
  const router = Router({ mergeParams: true });

  // GET /repositories/:repoName/prs -- List PRs in the pipeline
  router.get("/", async (req, res, next) => {
    const { repoName } = req.params as unknown as RepoParams;
    const repo = stateManager.getRepo(repoName);
    if (!repo) {
      next(createApiError(404, `Repository "${repoName}" not found`));
      return;
    }

    // Get PRs from worker state
    const workerPRs: PRPipelineEntry[] = Object.values(repo.workers)
      .filter((w) => w.prNumber != null)
      .map((w) => workerToPipelineEntry(w));

    // Also fetch PRs from GitHub for a complete picture
    const repoPath = repo.localPath;
    const githubPRs = repoPath ? await fetchGitHubPRs(repoPath) : [];

    // Merge: prefer worker info for PRs we know about, add GitHub-only PRs
    const prMap = new Map<number, PRPipelineEntry>();
    
    // First add worker PRs (they have richer context like workerName)
    for (const pr of workerPRs) {
      prMap.set(pr.number, pr);
    }
    
    // Then add GitHub PRs that aren't already tracked
    for (const pr of githubPRs) {
      if (!prMap.has(pr.number)) {
        prMap.set(pr.number, pr);
      } else {
        // Merge GitHub status into worker PR (more accurate CI status)
        const existing = prMap.get(pr.number)!;
        if (pr.stage !== "draft" && pr.stage !== "ready") {
          existing.stage = pr.stage; // Use GitHub's CI status
        }
      }
    }

    const entries = Array.from(prMap.values()).sort((a, b) => b.number - a.number);
    res.json({ prs: entries });
  });

  return router;
}

// Exported for testing
export { workerStatusToStage, workerToPipelineEntry, fetchGitHubPRs };
export type { PRPipelineEntry, PRStage };
