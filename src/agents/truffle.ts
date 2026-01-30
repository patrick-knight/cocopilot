/**
 * Truffle Worker Agent
 *
 * A Truffle is a CoCoPilot worker agent that executes a single task in an
 * isolated git worktree. Named after popular candies, each Truffle follows
 * the lifecycle: Spawn -> Work -> Commit -> PR -> Signal -> Cleanup.
 *
 * The Truffle:
 *   - Receives a task description and branch name at creation
 *   - Operates in an isolated git worktree
 *   - Makes small, incremental commits
 *   - Creates a PR when the task is complete (via `gh` CLI)
 *   - Signals completion to the Chocolatier supervisor
 *   - Can request help when stuck
 */

import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";

import {
  MessageBroker,
  MessageType,
  type CocoMessage,
  type CreateMessageOptions,
} from "../messaging/index.js";
import type { WorkerStatus } from "../state/schemas.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for creating a new Truffle worker agent. */
export interface TruffleConfig {
  /** Candy name for this worker (e.g., "Snickers", "KitKat"). */
  name: string;
  /** The task description this Truffle is assigned to complete. */
  task: string;
  /** Git branch for this worker's changes. */
  branch: string;
  /** Absolute path to the repository clone on the host. */
  repoPath: string;
  /** The name of the tracked repository (for state/messaging). */
  repoName: string;
  /** Absolute path where the git worktree will be created. */
  worktreePath: string;
  /** AI model to use for the Copilot session. */
  model?: string;
  /** Custom text appended to the system prompt. */
  customPrompt?: string;
  /** Branch to create the worktree from (defaults to "main"). */
  baseBranch?: string;
  /** Labels to apply to the pull request. */
  prLabels?: string[];
  /** Name of the supervisor agent to report to. */
  supervisorName?: string;
  /** Name of the merge queue agent to notify of PRs. */
  mergeQueueName?: string;
  /**
   * Push to an existing branch instead of creating a new one.
   * When set, the worker will checkout this existing branch and push to it.
   * Useful for iterating on existing PRs.
   */
  pushTo?: string;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface TruffleEvents {
  /** Emitted when the Truffle's status changes. */
  statusChanged: [status: WorkerStatus, previous: WorkerStatus];
  /** Emitted after a successful commit. */
  committed: [hash: string, message: string];
  /** Emitted after a PR is created. */
  prCreated: [pr: PRResult];
  /** Emitted when the Truffle encounters an error. */
  error: [error: Error];
  /** Emitted when the Truffle receives a nudge from the Chocolatier. */
  nudged: [hint: string, context?: string];
  /** Emitted when the Truffle finishes (completed or failed). */
  done: [status: "completed" | "failed", summary: string];
}

/** Result from creating a pull request. */
export interface PRResult {
  number: number;
  url: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Default system prompt template
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `You are a Truffle worker for CoCoPilot. Your task: {task}

Rules:
1. Work only on your assigned branch: {branch}
2. Make small, incremental commits with clear messages
3. Create a PR when your task is complete
4. Signal completion to the Chocolatier when done
5. Ask for help if you're stuck for more than 15 minutes

You have access to standard Copilot tools plus:
- send_message: Communicate with Chocolatier or other agents
- mark_complete: Signal task completion
- request_help: Ask Chocolatier for guidance`;

// ---------------------------------------------------------------------------
// TruffleAgent
// ---------------------------------------------------------------------------

/**
 * TruffleAgent manages the full lifecycle of a CoCoPilot worker.
 *
 * It handles git worktree isolation, incremental commits, PR creation,
 * and inter-agent messaging. The agent is designed to be driven externally
 * (by a Copilot SDK session or test harness) through its public methods.
 */
export class TruffleAgent extends EventEmitter<TruffleEvents> {
  private readonly config: TruffleConfig;
  private readonly broker: MessageBroker;
  private _status: WorkerStatus = "starting";
  private _filesChanged = 0;
  private _commitCount = 0;
  private _prResult: PRResult | null = null;
  private _worktreeReady = false;

  constructor(config: TruffleConfig, broker: MessageBroker) {
    super();
    this.config = Object.freeze({ ...config });
    this.broker = broker;
  }

  // -----------------------------------------------------------------------
  // Read-only accessors
  // -----------------------------------------------------------------------

  get name(): string {
    return this.config.name;
  }

  get task(): string {
    return this.config.task;
  }

  get branch(): string {
    return this.config.branch;
  }

  get status(): WorkerStatus {
    return this._status;
  }

  get filesChanged(): number {
    return this._filesChanged;
  }

  get commitCount(): number {
    return this._commitCount;
  }

  get prResult(): Readonly<PRResult> | null {
    return this._prResult;
  }

  get worktreePath(): string {
    return this.config.worktreePath;
  }

  // -----------------------------------------------------------------------
  // System prompt
  // -----------------------------------------------------------------------

  /**
   * Build the system prompt for this Truffle's Copilot session.
   * Injects the task description and branch into the template,
   * then appends any custom prompt text.
   */
  buildSystemPrompt(): string {
    let prompt = DEFAULT_SYSTEM_PROMPT_TEMPLATE.replace("{task}", this.config.task).replace(
      "{branch}",
      this.config.branch,
    );

    if (this.config.customPrompt) {
      prompt += "\n\n" + this.config.customPrompt;
    }

    return prompt;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Initialize the Truffle: set up the git worktree and subscribe to
   * messages from other agents.
   */
  async init(): Promise<void> {
    await this.setupWorktree();
    await this.broker.subscribe(this.config.name, (msg) =>
      this.handleMessage(msg),
    );
    this.setStatus("working");
  }

  /**
   * Graceful shutdown. Unsubscribes from messages. Does NOT remove the
   * worktree (call `cleanupWorktree()` explicitly if desired).
   */
  async stop(): Promise<void> {
    await this.broker.unsubscribe(this.config.name);
    if (this._status === "working") {
      this.setStatus("terminated");
    }
  }

  // -----------------------------------------------------------------------
  // Git worktree management
  // -----------------------------------------------------------------------

  /**
   * Create an isolated git worktree for this worker.
   * If pushTo is set, checks out the existing branch for iteration.
   * Otherwise creates a new branch from baseBranch (default "main").
   */
  async setupWorktree(): Promise<void> {
    const { repoPath, worktreePath, branch, pushTo } = this.config;
    const baseBranch = this.config.baseBranch ?? "main";

    // Ensure parent directory exists
    await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });

    if (pushTo) {
      // Iterating on existing PR: fetch and checkout the existing branch
      await this.git(["fetch", "origin", pushTo], repoPath);
      await this.git(
        ["worktree", "add", worktreePath, `origin/${pushTo}`],
        repoPath,
      );
      // Create local tracking branch
      await this.git(
        ["checkout", "-B", pushTo, `origin/${pushTo}`],
        worktreePath,
      );
    } else {
      // New work: create the worktree on a new branch
      await this.git(
        ["worktree", "add", "-b", branch, worktreePath, baseBranch],
        repoPath,
      );
    }

    this._worktreeReady = true;
  }

  /**
   * Remove the git worktree and prune stale entries.
   */
  async cleanupWorktree(): Promise<void> {
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
   * Stage all changes and create an incremental commit.
   * Returns the short commit hash.
   */
  async commit(message: string): Promise<string> {
    this.requireWorktree();

    const cwd = this.config.worktreePath;

    // Stage all changes
    await this.git(["add", "-A"], cwd);

    // Check if there are staged changes
    const diffResult = await this.git(
      ["diff", "--cached", "--quiet"],
      cwd,
    ).catch(() => null);

    // diff --quiet exits with 1 when there are changes
    if (diffResult !== null) {
      // Exit code 0 means no changes
      return "";
    }

    // Count changed files for tracking
    const { stdout: diffStat } = await this.git(
      ["diff", "--cached", "--numstat"],
      cwd,
    );
    const changedFiles = diffStat
      .trim()
      .split("\n")
      .filter((l) => l.length > 0).length;
    this._filesChanged += changedFiles;

    // Commit
    await this.git(["commit", "-m", message], cwd);

    // Get the short hash
    const { stdout: hash } = await this.git(
      ["rev-parse", "--short", "HEAD"],
      cwd,
    );
    const shortHash = hash.trim();

    this._commitCount++;
    this.emit("committed", shortHash, message);

    return shortHash;
  }

  /**
   * Push the current branch to the remote.
   * If pushTo is set, pushes to that branch instead of the worker's branch.
   */
  async push(): Promise<void> {
    this.requireWorktree();
    const targetBranch = this.config.pushTo ?? this.config.branch;
    await this.git(
      ["push", "-u", "origin", `HEAD:${targetBranch}`],
      this.config.worktreePath,
    );
  }

  /**
   * Create a pull request using the GitHub CLI.
   * Pushes the branch first, then runs `gh pr create`.
   */
  async createPR(title: string, body: string): Promise<PRResult> {
    this.requireWorktree();

    // Push changes first
    await this.push();

    // Build gh pr create arguments
    const args = ["pr", "create", "--title", title, "--body", body];

    const baseBranch = this.config.baseBranch ?? "main";
    args.push("--base", baseBranch);

    if (this.config.prLabels && this.config.prLabels.length > 0) {
      for (const label of this.config.prLabels) {
        args.push("--label", label);
      }
    }

    const { stdout } = await this.exec("gh", args, this.config.worktreePath);
    const prUrl = stdout.trim();

    // Extract PR number from URL (e.g., https://github.com/org/repo/pull/42)
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;

    const pr: PRResult = {
      number: prNumber,
      url: prUrl,
      title,
    };

    this._prResult = pr;
    this.emit("prCreated", pr);

    // Notify merge queue agent
    await this.notifyPRCreated(pr);

    return pr;
  }

  // -----------------------------------------------------------------------
  // Messaging: outbound signals
  // -----------------------------------------------------------------------

  /**
   * Signal successful task completion to the Chocolatier.
   */
  async signalComplete(summary: string, prUrl?: string): Promise<void> {
    const supervisor = this.config.supervisorName ?? "chocolatier";
    await this.broker.send({
      type: MessageType.TASK_COMPLETE,
      from: this.config.name,
      to: supervisor,
      payload: {
        summary,
        pr_url: prUrl ?? this._prResult?.url,
        files_changed: this._filesChanged,
        commits: this._commitCount,
      },
    });

    this.setStatus("completed");
    this.emit("done", "completed", summary);
  }

  /**
   * Signal task failure to the Chocolatier.
   */
  async signalFailed(
    error: string,
    recoverable: boolean = false,
  ): Promise<void> {
    const supervisor = this.config.supervisorName ?? "chocolatier";
    await this.broker.send({
      type: MessageType.TASK_FAILED,
      from: this.config.name,
      to: supervisor,
      payload: {
        error,
        task: this.config.task,
        recoverable,
      },
    });

    this.setStatus("failed");
    this.emit("done", "failed", error);
  }

  /**
   * Request help from the Chocolatier when stuck.
   * Sends a TASK_FAILED message with recoverable=true and updates
   * status to "stuck".
   */
  async requestHelp(message: string): Promise<void> {
    const supervisor = this.config.supervisorName ?? "chocolatier";
    await this.broker.send({
      type: MessageType.TASK_FAILED,
      from: this.config.name,
      to: supervisor,
      payload: {
        error: message,
        task: this.config.task,
        recoverable: true,
      },
      priority: "high",
    });

    this.setStatus("stuck");
  }

  /**
   * Respond to a STATUS_REQUEST with current agent status.
   */
  async respondStatus(requestId: string, requester: string): Promise<void> {
    await this.broker.send({
      type: MessageType.STATUS_RESPONSE,
      from: this.config.name,
      to: requester,
      payload: {
        request_id: requestId,
        status: this._status,
        current_action: this.config.task,
        progress: this.estimateProgress(),
      },
    });
  }

  // -----------------------------------------------------------------------
  // Messaging: inbound handling
  // -----------------------------------------------------------------------

  /**
   * Handle an incoming message from another agent.
   */
  private async handleMessage(message: CocoMessage): Promise<void> {
    switch (message.type) {
      case MessageType.NUDGE: {
        const payload = message.payload as { hint: string; context?: string };
        this.emit("nudged", payload.hint, payload.context);
        break;
      }
      case MessageType.STATUS_REQUEST: {
        const payload = message.payload as { request_id: string };
        await this.respondStatus(payload.request_id, message.from);
        break;
      }
      case MessageType.BROADCAST: {
        // Broadcasts are informational; no action needed
        break;
      }
      default:
        // Unknown or irrelevant message types are ignored
        break;
    }

    // Acknowledge if required
    if (message.ack_required) {
      await this.broker.acknowledge(this.config.name, message.id);
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Notify the Temperer (merge queue) that a PR has been created.
   */
  private async notifyPRCreated(pr: PRResult): Promise<void> {
    const mergeQueue = this.config.mergeQueueName ?? "temperer";
    await this.broker.send({
      type: MessageType.PR_CREATED,
      from: this.config.name,
      to: mergeQueue,
      payload: {
        pr_number: pr.number,
        pr_url: pr.url,
        title: pr.title,
        branch: this.config.branch,
      },
    });
  }

  /** Transition status and emit event. */
  private setStatus(status: WorkerStatus): void {
    const previous = this._status;
    if (previous === status) return;
    this._status = status;
    this.emit("statusChanged", status, previous);
  }

  /** Estimate task progress (0-100) based on lifecycle stage. */
  private estimateProgress(): number {
    if (this._prResult) return 90;
    if (this._commitCount > 0) return 50 + Math.min(this._commitCount * 10, 40);
    if (this._worktreeReady) return 10;
    return 0;
  }

  /** Ensure the worktree has been set up before git operations. */
  private requireWorktree(): void {
    if (!this._worktreeReady) {
      throw new Error(
        `Truffle "${this.config.name}": worktree not initialized. Call init() first.`,
      );
    }
  }

  /** Run a git command and return stdout/stderr. */
  private async git(
    args: string[],
    cwd: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return this.exec("git", args, cwd);
  }

  /** Run an external command. */
  private async exec(
    command: string,
    args: string[],
    cwd: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(command, args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 120_000, // 2 minutes
    });
  }
}
