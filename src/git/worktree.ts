/**
 * Git Worktree Management Utilities
 *
 * Provides functions to create, list, and remove git worktrees for
 * CoCoPilot worker agents (Truffles). Each worker gets an isolated
 * worktree on its own branch under ~/.cocopilot/repos/<repo>/worktrees/.
 */

import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import type { WorktreeInfo } from "./types.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COCOPILOT_BASE = path.join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".cocopilot",
);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path where a worker's worktree should live.
 *
 * Path format: `~/.cocopilot/repos/<repoName>/worktrees/<workerName>/`
 */
export function getWorktreePath(repoName: string, workerName: string): string {
  return path.join(COCOPILOT_BASE, "repos", repoName, "worktrees", workerName);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create an isolated git worktree for a worker agent.
 *
 * Runs `git worktree add` to create a new worktree at the standard
 * CoCoPilot path on a new branch named `work/<workerName>`, branching
 * from `baseBranch`.
 *
 * @param repoPath   - Absolute path to the main repository clone.
 * @param workerName - Name of the worker (e.g., "Snickers").
 * @param baseBranch - Branch to base the new worktree branch on (e.g., "main").
 * @returns The absolute path to the created worktree directory.
 */
export async function createWorktree(
  repoPath: string,
  workerName: string,
  baseBranch: string,
): Promise<string> {
  // Derive repo name from repoPath (last segment)
  const repoName = path.basename(repoPath);
  const worktreePath = getWorktreePath(repoName, workerName);
  const branchName = `work/${workerName}`;

  // git worktree add -b <new-branch> <path> <start-point>
  await execFileAsync(
    "git",
    ["worktree", "add", "-b", branchName, worktreePath, baseBranch],
    { cwd: repoPath },
  );

  return worktreePath;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * Parse the porcelain output of `git worktree list --porcelain`.
 *
 * Each worktree block is separated by a blank line and contains lines like:
 * ```
 * worktree /path/to/main
 * HEAD abc123def456
 * branch refs/heads/main
 *
 * worktree /path/to/wt
 * HEAD 789abc012345
 * branch refs/heads/work/Snickers
 * ```
 */
function parsePorcelain(output: string): WorktreeInfo[] {
  const results: WorktreeInfo[] = [];
  // Split on double newlines to get individual worktree blocks,
  // filtering out empty trailing blocks.
  const blocks = output.split("\n\n").filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    const lines = block.split("\n");
    let wtPath = "";
    let head = "";
    let branch: string | undefined;
    let bare = false;
    let prunable = false;
    let detached = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        wtPath = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length);
      } else if (line === "bare") {
        bare = true;
      } else if (line === "prunable") {
        prunable = true;
      } else if (line === "detached") {
        detached = true;
      }
    }

    if (wtPath) {
      results.push({ path: wtPath, head, branch, bare, prunable, detached });
    }
  }

  return results;
}

/**
 * List all git worktrees for a repository.
 *
 * Runs `git worktree list --porcelain` and parses the output into
 * structured {@link WorktreeInfo} objects.
 *
 * @param repoPath - Absolute path to the main repository clone.
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["worktree", "list", "--porcelain"],
    { cwd: repoPath },
  );

  return parsePorcelain(stdout);
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

/**
 * Remove a worker's git worktree and its associated branch.
 *
 * 1. Runs `git worktree remove --force` to delete the worktree directory.
 * 2. Runs `git branch -D` to delete the `work/<workerName>` branch.
 *
 * @param repoPath   - Absolute path to the main repository clone.
 * @param workerName - Name of the worker whose worktree to remove.
 */
export async function removeWorktree(
  repoPath: string,
  workerName: string,
): Promise<void> {
  const repoName = path.basename(repoPath);
  const worktreePath = getWorktreePath(repoName, workerName);
  const branchName = `work/${workerName}`;

  // Remove the worktree (--force handles uncommitted changes)
  await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], {
    cwd: repoPath,
  });

  // Clean up the branch
  await execFileAsync("git", ["branch", "-D", branchName], {
    cwd: repoPath,
  });
}
