/**
 * Fork detection for GitHub repositories.
 *
 * Uses the GitHub CLI (`gh`) to query the GitHub API and determine
 * whether a repository is a fork. If so, extracts parent and source
 * information for upstream tracking.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ForkInfo } from "./types.js";
import type { RepoConfig } from "../state/schemas.js";

const execFileAsync = promisify(execFile);

/**
 * Extract owner and repo name from a GitHub URL.
 * Expects format: https://github.com/{owner}/{repo}[.git][/]
 */
export function ownerAndRepoFromUrl(url: string): { owner: string; repo: string } {
  const cleaned = url.replace(/\.git$/, "").replace(/\/$/, "");
  const parts = cleaned.split("/");
  const repo = parts[parts.length - 1];
  const owner = parts[parts.length - 2];
  return { owner, repo };
}

/**
 * Detect whether a GitHub repository is a fork by calling the GitHub API
 * via the `gh` CLI. Returns fork metadata including parent/source info.
 */
export async function detectFork(repoUrl: string): Promise<ForkInfo> {
  const { owner, repo } = ownerAndRepoFromUrl(repoUrl);

  const { stdout } = await execFileAsync("gh", [
    "api",
    `repos/${owner}/${repo}`,
    "--jq",
    '{fork: .fork, default_branch: .default_branch, parent_owner: .parent.owner.login, parent_repo: .parent.name, source_owner: .source.owner.login, source_repo: .source.name}',
  ]);

  const data = JSON.parse(stdout);

  return {
    isFork: Boolean(data.fork),
    parentOwner: data.parent_owner || undefined,
    parentRepo: data.parent_repo || undefined,
    sourceOwner: data.source_owner || undefined,
    sourceRepo: data.source_repo || undefined,
    defaultBranch: data.default_branch || "main",
  };
}

/**
 * Adjust repository configuration for fork/multiplayer mode.
 *
 * When a fork is detected:
 * - Disables autoMerge (upstream PRs need manual review)
 * - Sets activeAgent to 'enrober' instead of 'temperer'
 * - Records upstream remote info for tracking
 */
export function configureMultiplayer(
  config: RepoConfig,
  forkInfo: ForkInfo,
): RepoConfig {
  if (!forkInfo.isFork) {
    return config;
  }

  return {
    ...config,
    mode: "multiplayer",
    autoMerge: false,
    activeAgent: "enrober",
    upstream: {
      owner: forkInfo.parentOwner!,
      repo: forkInfo.parentRepo!,
      defaultBranch: forkInfo.defaultBranch,
    },
  };
}
