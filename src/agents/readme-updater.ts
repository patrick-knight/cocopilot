/**
 * README Updater Agent
 *
 * Monitors worker completion status and triggers a README update
 * 5 minutes after all active workers have completed. Uses node-cron
 * for scheduling the check.
 *
 * Workflow:
 *   1. CRON job runs every minute to check worker status
 *   2. When all workers complete, starts 5-minute countdown
 *   3. After 5 minutes of all workers being completed, triggers update
 *   4. Uses Copilot CLI to generate README updates based on recent changes
 *   5. Creates a PR with the updated README
 */

import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { MessageBroker, MessageType } from "../messaging/index.js";
import { scopedAgentName, scopedWorkerName } from "./scoped-name.js";
import type { StateManager, WorkerState } from "../state/index.js";
import type { CocoMessage } from "../messaging/types.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReadmeUpdaterConfig {
  /** Path to the git repository. */
  repoPath: string;
  /** The repository name (used for scoped agent naming). */
  repoName: string;
  /** Agent name for messaging. */
  agentName?: string;
  /** Delay in minutes after all workers complete before updating. Default: 5 */
  delayMinutes?: number;
  /** CRON expression for checking worker status. Default: every minute */
  cronSchedule?: string;
  /** Branch to create for README updates. Default: "readme-update" */
  branch?: string;
}

export interface ReadmeUpdaterEvents {
  /** Emitted when the countdown starts. */
  countdownStarted: [completionTime: Date];
  /** Emitted when the countdown is cancelled (new worker started). */
  countdownCancelled: [];
  /** Emitted when README update begins. */
  updateStarted: [];
  /** Emitted when README update completes. */
  updateCompleted: [prUrl: string];
  /** Emitted on error. */
  error: [error: Error];
}

// ---------------------------------------------------------------------------
// ReadmeUpdaterAgent
// ---------------------------------------------------------------------------

export class ReadmeUpdaterAgent extends EventEmitter<ReadmeUpdaterEvents> {
  private readonly config: Required<ReadmeUpdaterConfig>;
  private readonly broker: MessageBroker;
  private readonly stateManager: StateManager;
  private _isRunning = false;
  private cronTask: ScheduledTask | null = null;
  private allCompletedAt: Date | null = null;
  private updateInProgress = false;
  private lastUpdateTime: Date | null = null;

  constructor(
    config: ReadmeUpdaterConfig,
    broker: MessageBroker,
    stateManager: StateManager,
  ) {
    super();
    this.config = {
      agentName: scopedAgentName("readme-updater", config.repoName),
      delayMinutes: 5,
      cronSchedule: "* * * * *", // Every minute
      branch: "readme-update",
      ...config,
    };
    this.broker = broker;
    this.stateManager = stateManager;
  }

  get name(): string {
    return this.config.agentName;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async start(): Promise<void> {
    // Subscribe to messages
    await this.broker.subscribe(this.name, (msg) => this.handleMessage(msg));

    // Start CRON job
    this.cronTask = cron.schedule(this.config.cronSchedule, () => {
      this.checkWorkerStatus().catch((err) => {
        this.emit("error", err as Error);
      });
    });

    this._isRunning = true;
  }

  async stop(): Promise<void> {
    // Stop CRON job
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }

    await this.broker.unsubscribe(this.name);
    this._isRunning = false;
  }

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  private async handleMessage(msg: CocoMessage): Promise<void> {
    // Listen for worker spawned events to reset countdown
    if (msg.type === MessageType.SPAWN_WORKER) {
      this.resetCountdown();
    }
    // Manual trigger for README update
    if (msg.type === MessageType.README_UPDATE_REQUEST) {
      await this.triggerUpdate();
    }
  }

  // -----------------------------------------------------------------------
  // Core logic
  // -----------------------------------------------------------------------

  /**
   * Check if all workers are completed and manage countdown.
   */
  private async checkWorkerStatus(): Promise<void> {
    const repo = this.stateManager.getRepo(this.config.repoName);
    if (!repo) return;

    const workers = Object.values(repo.workers);
    if (workers.length === 0) return;

    // Check if there are any active workers
    const activeWorkers = workers.filter(
      (w) => w.status === "working" || w.status === "starting"
    );

    if (activeWorkers.length > 0) {
      // Workers still active, reset countdown
      if (this.allCompletedAt) {
        this.resetCountdown();
      }
      return;
    }

    // All workers completed or failed
    const completedWorkers = workers.filter(
      (w) => w.status === "completed" || w.status === "failed" || w.status === "merged"
    );

    if (completedWorkers.length === 0) return;

    // Start countdown if not already started
    if (!this.allCompletedAt) {
      this.allCompletedAt = new Date();
      this.emit("countdownStarted", this.allCompletedAt);
    }

    // Check if delay has elapsed
    const now = new Date();
    const elapsedMs = now.getTime() - this.allCompletedAt.getTime();
    const delayMs = this.config.delayMinutes * 60 * 1000;

    if (elapsedMs >= delayMs && !this.updateInProgress) {
      // Check if we already updated recently (within last hour)
      if (this.lastUpdateTime) {
        const timeSinceLastUpdate = now.getTime() - this.lastUpdateTime.getTime();
        if (timeSinceLastUpdate < 60 * 60 * 1000) {
          // Skip - already updated in the last hour
          return;
        }
      }

      await this.triggerUpdate();
    }
  }

  /**
   * Reset the countdown timer.
   */
  private resetCountdown(): void {
    if (this.allCompletedAt) {
      this.allCompletedAt = null;
      this.emit("countdownCancelled");
    }
  }

  /**
   * Trigger the README update process.
   */
  private async triggerUpdate(): Promise<void> {
    if (this.updateInProgress) return;

    this.updateInProgress = true;
    this.emit("updateStarted");

    try {
      // Get list of recently completed workers and their tasks
      const repo = this.stateManager.getRepo(this.config.repoName);
      if (!repo) throw new Error("Repository not found");

      const recentWorkers = Object.values(repo.workers)
        .filter((w) => w.status === "completed" || w.status === "merged")
        .sort((a, b) => new Date(b.completedAt ?? b.updatedAt).getTime() - 
                        new Date(a.completedAt ?? a.updatedAt).getTime())
        .slice(0, 10);

      if (recentWorkers.length === 0) {
        throw new Error("No completed workers found");
      }

      // Generate summary of recent changes
      const changesSummary = recentWorkers
        .map((w) => `- ${w.task}${w.prNumber ? ` (PR #${w.prNumber})` : ""}`)
        .join("\n");

      // Create/update README using Copilot CLI
      const prUrl = await this.updateReadme(changesSummary);
      
      this.lastUpdateTime = new Date();
      this.allCompletedAt = null;
      this.emit("updateCompleted", prUrl);

    } catch (error) {
      this.emit("error", error as Error);
    } finally {
      this.updateInProgress = false;
    }
  }

  /**
   * Update the README using Copilot CLI and create a PR.
   */
  private async updateReadme(changesSummary: string): Promise<string> {
    const { repoPath, branch, repoName } = this.config;

    // Ensure we're on main/master branch first
    await execFileAsync("git", ["checkout", "main"], { cwd: repoPath }).catch(() =>
      execFileAsync("git", ["checkout", "master"], { cwd: repoPath })
    );

    // Pull latest
    await execFileAsync("git", ["pull", "--rebase"], { cwd: repoPath });

    // Create/checkout branch for README update
    const branchName = `${branch}-${Date.now()}`;
    try {
      await execFileAsync("git", ["checkout", "-b", branchName], { cwd: repoPath });
    } catch {
      // Branch might exist, try to checkout
      await execFileAsync("git", ["checkout", branchName], { cwd: repoPath });
    }

    // Read current README
    const readmePath = path.join(repoPath, "README.md");
    let currentReadme = "";
    try {
      currentReadme = await fs.readFile(readmePath, "utf-8");
    } catch {
      currentReadme = `# ${repoName}\n\nProject documentation.\n`;
    }

    // Use Copilot CLI to suggest README updates
    const prompt = `Update the following README.md to document recent changes. 
Keep the existing structure but add or update sections as needed.
Be concise and professional.

Recent changes made by CoCoPilot workers:
${changesSummary}

Current README:
${currentReadme}

Respond with ONLY the updated README content, no explanation.`;

    let updatedReadme: string;
    try {
      const { stdout } = await execFileAsync(
        "gh",
        ["copilot", "suggest", "-t", "shell", prompt],
        { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }
      );
      updatedReadme = stdout.trim();
      
      // If Copilot didn't give us valid markdown, fall back to appending changelog
      if (!updatedReadme || updatedReadme.length < 50) {
        updatedReadme = this.appendChangelog(currentReadme, changesSummary);
      }
    } catch {
      // Fallback: append a changelog section
      updatedReadme = this.appendChangelog(currentReadme, changesSummary);
    }

    // Write updated README
    await fs.writeFile(readmePath, updatedReadme, "utf-8");

    // Commit and push
    await execFileAsync("git", ["add", "README.md"], { cwd: repoPath });
    await execFileAsync(
      "git",
      ["commit", "-m", "docs: update README with recent changes"],
      { cwd: repoPath }
    );
    await execFileAsync("git", ["push", "-u", "origin", branchName], { cwd: repoPath });

    // Create PR with labels from config
    const prLabels = this.stateManager.getConfig().github?.prLabels ?? ["cocopilot"];
    const labels = ["documentation", ...prLabels].filter((v, i, a) => a.indexOf(v) === i); // dedupe
    
    const prArgs = [
      "pr", "create",
      "--title", "docs: Update README with recent changes",
      "--body", `This PR updates the README to document recent changes made by CoCoPilot workers.\n\n## Recent Changes\n${changesSummary}`,
    ];
    
    if (labels.length > 0) {
      prArgs.push("--label", labels.join(","));
    }
    
    const { stdout: prUrl } = await execFileAsync("gh", prArgs, { cwd: repoPath });

    // Switch back to main
    await execFileAsync("git", ["checkout", "main"], { cwd: repoPath }).catch(() =>
      execFileAsync("git", ["checkout", "master"], { cwd: repoPath })
    );

    // Notify via message bus
    await this.broker.send({
      type: MessageType.README_UPDATED,
      from: this.name,
      to: "*",
      payload: {
        prUrl: prUrl.trim(),
        repoName,
      },
      priority: "normal",
      ack_required: false,
    });

    return prUrl.trim();
  }

  /**
   * Fallback: append a changelog section to the README.
   */
  private appendChangelog(readme: string, changes: string): string {
    const date = new Date().toISOString().split("T")[0];
    const changelogSection = `\n## Recent Changes (${date})\n\n${changes}\n`;

    // Check if there's already a "Recent Changes" section
    if (readme.includes("## Recent Changes")) {
      // Replace existing section
      return readme.replace(
        /## Recent Changes.*?(?=\n## |\n$|$)/s,
        changelogSection.trim()
      );
    }

    // Append to end
    return readme.trimEnd() + "\n" + changelogSection;
  }
}
