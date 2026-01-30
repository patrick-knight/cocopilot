/**
 * Workspace Agent
 *
 * A personal persistent Copilot session - your "home base" for a repository.
 * Unlike Truffle workers which are task-focused and ephemeral, a Workspace
 * is a long-running session where you can explore, prototype, and spawn workers.
 *
 * Features:
 *   - Persistent git worktree (survives daemon restarts)
 *   - User-driven interaction (no assigned task)
 *   - Can spawn Truffle workers for specific tasks
 *   - Remembers context across sessions
 */

import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";

import type { WorkspaceConfig, WorkspaceState } from "./types.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface WorkspaceEvents {
  /** Emitted when the workspace is activated. */
  activated: [];
  /** Emitted when the workspace is deactivated. */
  deactivated: [];
  /** Emitted when the workspace encounters an error. */
  error: [error: Error];
  /** Emitted when changes are detected. */
  changesDetected: [hasChanges: boolean];
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const WORKSPACE_SYSTEM_PROMPT = `You are a personal Copilot workspace for CoCoPilot.

This is your home base - a persistent session where you can:
- Explore and understand the codebase
- Make experimental changes
- Spawn dedicated workers for specific tasks
- Coordinate with other agents

Unlike task-focused workers, you have no specific assignment. You're here to help
the user with whatever they need.

## Available Commands

- /refresh - Sync with main branch (fetch, rebase)
- /status - Check workspace status
- /workers - List active workers
- /spawn <task> - Spawn a new Truffle worker
- /commit <message> - Commit current changes
- /push - Push changes to remote

## Tips

- Keep your workspace clean - commit or stash frequently
- Spawn workers for well-defined tasks
- Use this workspace for exploration and coordination
`;

// ---------------------------------------------------------------------------
// WorkspaceAgent
// ---------------------------------------------------------------------------

export class WorkspaceAgent extends EventEmitter<WorkspaceEvents> {
  private readonly config: WorkspaceConfig;
  private _state: WorkspaceState;
  private _worktreeReady = false;

  constructor(config: WorkspaceConfig) {
    super();
    this.config = {
      branch: `workspace/${config.name}`,
      ...config,
    };
    this._state = {
      name: config.name,
      repoName: config.repoName,
      status: "inactive",
      branch: this.config.branch!,
      worktreePath: config.worktreePath,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Read-only accessors
  // -----------------------------------------------------------------------

  get name(): string {
    return this.config.name;
  }

  get branch(): string {
    return this.config.branch!;
  }

  get worktreePath(): string {
    return this.config.worktreePath;
  }

  get state(): Readonly<WorkspaceState> {
    return this._state;
  }

  get isActive(): boolean {
    return this._state.status === "active";
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Initialize the workspace by setting up the git worktree.
   */
  async init(): Promise<void> {
    await this.setupWorktree();
    this._state.status = "active";
    this._state.lastAccessedAt = new Date().toISOString();
    this.emit("activated");
  }

  /**
   * Activate an existing workspace (worktree already exists).
   */
  async activate(): Promise<void> {
    if (!this._worktreeReady) {
      // Check if worktree exists
      const exists = await fs.promises
        .access(path.join(this.config.worktreePath, ".git"))
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        throw new Error(
          `Workspace "${this.name}" worktree not found at ${this.config.worktreePath}`,
        );
      }
      this._worktreeReady = true;
    }

    this._state.status = "active";
    this._state.lastAccessedAt = new Date().toISOString();
    this.emit("activated");
  }

  /**
   * Deactivate the workspace (keeps worktree for later use).
   */
  async deactivate(): Promise<void> {
    this._state.status = "inactive";
    this.emit("deactivated");
  }

  /**
   * Remove the workspace entirely (deletes worktree).
   */
  async remove(): Promise<void> {
    // Check for uncommitted changes
    const hasChanges = await this.hasUncommittedChanges();
    if (hasChanges) {
      throw new Error(
        `Workspace "${this.name}" has uncommitted changes. Commit or discard them first.`,
      );
    }

    await this.cleanupWorktree();
    this._state.status = "inactive";
  }

  // -----------------------------------------------------------------------
  // Git worktree management
  // -----------------------------------------------------------------------

  /**
   * Create the git worktree for this workspace.
   */
  private async setupWorktree(): Promise<void> {
    const { repoPath, worktreePath, branch } = this.config;

    // Ensure parent directory exists
    await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });

    // Check if branch already exists
    const branchExists = await this.branchExists(branch!);

    if (branchExists) {
      // Checkout existing branch
      await this.git(["worktree", "add", worktreePath, branch!], repoPath);
    } else {
      // Create new branch from main/master
      const defaultBranch = await this.getDefaultBranch();
      await this.git(
        ["worktree", "add", "-b", branch!, worktreePath, defaultBranch],
        repoPath,
      );
    }

    this._worktreeReady = true;
  }

  /**
   * Remove the git worktree.
   */
  private async cleanupWorktree(): Promise<void> {
    if (!this._worktreeReady) return;

    const { repoPath, worktreePath } = this.config;

    // Remove the worktree directory
    await fs.promises.rm(worktreePath, { recursive: true, force: true });

    // Prune stale worktree entries
    await this.git(["worktree", "prune"], repoPath);

    this._worktreeReady = false;
  }

  // -----------------------------------------------------------------------
  // Git operations (run inside the worktree)
  // -----------------------------------------------------------------------

  /**
   * Check if there are uncommitted changes.
   */
  async hasUncommittedChanges(): Promise<boolean> {
    if (!this._worktreeReady) return false;

    const { stdout } = await this.git(
      ["status", "--porcelain"],
      this.config.worktreePath,
    );
    const hasChanges = stdout.trim().length > 0;
    this._state.hasUncommittedChanges = hasChanges;
    this.emit("changesDetected", hasChanges);
    return hasChanges;
  }

  /**
   * Refresh the workspace by fetching and rebasing on the default branch.
   */
  async refresh(): Promise<void> {
    this.requireWorktree();
    const cwd = this.config.worktreePath;

    // Fetch latest
    await this.git(["fetch", "origin"], cwd);

    // Get default branch
    const defaultBranch = await this.getDefaultBranch();

    // Rebase on default branch
    await this.git(["rebase", `origin/${defaultBranch}`], cwd);
  }

  /**
   * Commit staged changes.
   */
  async commit(message: string): Promise<string> {
    this.requireWorktree();
    const cwd = this.config.worktreePath;

    // Stage all changes
    await this.git(["add", "-A"], cwd);

    // Commit
    await this.git(["commit", "-m", message], cwd);

    // Get the short hash
    const { stdout } = await this.git(["rev-parse", "--short", "HEAD"], cwd);
    return stdout.trim();
  }

  /**
   * Push changes to remote.
   */
  async push(): Promise<void> {
    this.requireWorktree();
    await this.git(
      ["push", "-u", "origin", this.config.branch!],
      this.config.worktreePath,
    );
  }

  /**
   * Get workspace status summary.
   */
  async getStatus(): Promise<{
    branch: string;
    hasChanges: boolean;
    aheadBehind: string;
  }> {
    this.requireWorktree();
    const cwd = this.config.worktreePath;

    const hasChanges = await this.hasUncommittedChanges();

    // Get ahead/behind count
    let aheadBehind = "up to date";
    try {
      const { stdout } = await this.git(
        ["rev-list", "--left-right", "--count", `origin/${this.config.branch}...HEAD`],
        cwd,
      );
      const [behind, ahead] = stdout.trim().split(/\s+/).map(Number);
      if (ahead > 0 && behind > 0) {
        aheadBehind = `${ahead} ahead, ${behind} behind`;
      } else if (ahead > 0) {
        aheadBehind = `${ahead} ahead`;
      } else if (behind > 0) {
        aheadBehind = `${behind} behind`;
      }
    } catch {
      // Branch may not exist on remote yet
      aheadBehind = "not pushed";
    }

    return {
      branch: this.config.branch!,
      hasChanges,
      aheadBehind,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Check if a branch exists.
   */
  private async branchExists(branch: string): Promise<boolean> {
    try {
      await this.git(
        ["rev-parse", "--verify", branch],
        this.config.repoPath,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the default branch name (main or master).
   */
  private async getDefaultBranch(): Promise<string> {
    try {
      const { stdout } = await this.git(
        ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
        this.config.repoPath,
      );
      return stdout.trim().replace("origin/", "");
    } catch {
      // Fallback to main
      return "main";
    }
  }

  /** Ensure the worktree has been set up. */
  private requireWorktree(): void {
    if (!this._worktreeReady) {
      throw new Error(
        `Workspace "${this.name}": not initialized. Call init() or activate() first.`,
      );
    }
  }

  /** Run a git command. */
  private async git(
    args: string[],
    cwd: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    });
  }
}
