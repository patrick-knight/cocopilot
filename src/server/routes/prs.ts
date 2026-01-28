/**
 * PR pipeline routes (nested under a repository).
 *
 * GET /api/v1/repositories/:repoName/prs -- List PRs with pipeline stage info
 *
 * Derives PR pipeline data from worker state. Each worker that has created a
 * PR (has prNumber set) is represented as a PRPipelineEntry with a stage
 * inferred from the worker's current status.
 */

import { Router } from "express";
import type { StateManager } from "../../state/index.js";
import type { WorkerState, WorkerStatus } from "../../state/index.js";
import { createApiError } from "../middleware/error-handler.js";

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

export function prRoutes(stateManager: StateManager): Router {
  const router = Router({ mergeParams: true });

  // GET /repositories/:repoName/prs -- List PRs in the pipeline
  router.get("/", (req, res, next) => {
    const { repoName } = req.params as unknown as RepoParams;
    const repo = stateManager.getRepo(repoName);
    if (!repo) {
      next(createApiError(404, `Repository "${repoName}" not found`));
      return;
    }

    const entries: PRPipelineEntry[] = Object.values(repo.workers)
      .filter((w) => w.prNumber != null)
      .map((w) => workerToPipelineEntry(w))
      .sort((a, b) => b.number - a.number);

    res.json(entries);
  });

  return router;
}

// Exported for testing
export { workerStatusToStage, workerToPipelineEntry };
export type { PRPipelineEntry, PRStage };
