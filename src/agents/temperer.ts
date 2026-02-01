/**
 * The Temperer - Merge Queue Agent
 *
 * Continuously monitors open PRs from CoCoPilot workers and merges
 * when CI passes (single-player mode). On CI failure, spawns fixup
 * workers via the Chocolatier.
 *
 * Polls open PRs every 2 minutes (configurable) using `gh pr list`.
 * Checks CI status via `gh pr checks <number>`.
 * Auto-merges via `gh pr merge <number> --squash`.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
  MessageBroker,
  MessageType,
  type CocoMessage,
  type PRCreatedPayload,
} from "../messaging/index.js";
import {
  getCIStatus,
  generateFixupSummary,
  type CIExecFn,
} from "../github/index.js";
import type { CIStatusResult } from "../github/types.js";
import { scopedAgentName } from "./scoped-name.js";

const execFile = promisify(execFileCb);

const DEFAULT_POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const AGENT_TYPE = "temperer";
const DEFAULT_LABEL = "cocopilot";

/**
 * Build the unique agent name for a repo-specific Temperer.
 * Used both internally and by API routes that address this agent.
 */
export function tempererAgentName(repoName: string): string {
  return `${AGENT_TYPE}:${repoName}`;
}

/** Configuration for the Temperer agent. */
export interface TempererConfig {
  /** Path to the git repository to monitor. */
  repoPath: string;
  /** Repository name for scoped agent naming. */
  repoName: string;
  /** MessageBroker instance for inter-agent communication. */
  broker: MessageBroker;
  /** Polling interval in milliseconds. Defaults to 120000 (2 min). */
  pollIntervalMs?: number;
  /** PR label used to identify CoCoPilot PRs. Defaults to "cocopilot". */
  label?: string;
}

/** A PR returned by `gh pr list`. */
export interface PRInfo {
  number: number;
  title: string;
  headRefName: string;
  url: string;
  author: string;
}

/** Status of an individual CI check. */
export interface CheckInfo {
  name: string;
  state: string;
  conclusion: string;
  detailsUrl?: string;
}

/** Aggregated CI status for a PR. */
export type CIStatus = "passing" | "failing" | "pending" | "no_checks";

/** Internal tracking state for a PR the Temperer is monitoring. */
export type TrackedPRState =
  | "watching"
  | "awaiting_security_review"
  | "merging"
  | "merged"
  | "fixup_requested"
  | "security_blocked";

export interface TrackedPR {
  number: number;
  url: string;
  title: string;
  branch: string;
  state: TrackedPRState;
  originalWorker?: string;
  fixupRequestedAt?: number;
  securityReviewPassed?: boolean;
  securityWarnings?: string[];
}

/** Function signature used to execute gh CLI commands. Exposed for testing. */
export type ExecFn = (
  file: string,
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * The Temperer merge queue agent.
 *
 * Lifecycle: create → start() → ... → stop()
 */
export class Temperer {
  private readonly config: Required<
    Pick<TempererConfig, "repoPath" | "pollIntervalMs" | "agentName" | "chocolatierName" | "securityReviewerName" | "label">
  > & { broker: MessageBroker };
  private readonly trackedPRs: Map<number, TrackedPR> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly execFn: ExecFn;

  constructor(config: TempererConfig, execFn?: ExecFn) {
    this.config = {
      repoPath: config.repoPath,
      repoName: config.repoName,
      broker: config.broker,
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      agentName: config.agentName ?? scopedAgentName("temperer", config.repoName),
      chocolatierName: config.chocolatierName ?? scopedAgentName("chocolatier", config.repoName),
      securityReviewerName: config.securityReviewerName ?? scopedAgentName("security-reviewer", config.repoName),
      label: config.label ?? DEFAULT_LABEL,
    };
    this.execFn = execFn ?? execFile;
  }

  /** Get the repo-scoped agent name. */
  get agentName(): string {
    return tempererAgentName(this.config.repoName);
  }

  /** Get the repo-scoped chocolatier name for messaging. */
  get chocolatierName(): string {
    return `chocolatier:${this.config.repoName}`;
  }

  /** Get the repo-scoped security reviewer name for messaging. */
  get securityReviewerName(): string {
    return `security-reviewer:${this.config.repoName}`;
  }

  /** Start the Temperer: subscribe to messages and begin polling. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Subscribe to incoming messages (e.g., PR_CREATED from Truffles)
    await this.config.broker.subscribe(
      this.agentName,
      this.handleMessage.bind(this),
    );

    // Run first poll immediately, then on interval
    await this.pollOnce();
    this.pollTimer = setInterval(() => {
      this.pollOnce().catch(() => {
        // Errors are handled within pollOnce; swallow here to keep interval alive
      });
    }, this.config.pollIntervalMs);
  }

  /** Stop polling and unsubscribe from messages. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await this.config.broker.unsubscribe(this.agentName);
  }

  /** Whether the agent is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Read-only view of tracked PRs. */
  getTrackedPRs(): ReadonlyMap<number, TrackedPR> {
    return this.trackedPRs;
  }

  /**
   * Execute a single poll cycle:
   * 1. List open PRs with the cocopilot label
   * 2. For each PR, check CI status
   * 3. Merge if passing AND security review passed, request fixup if failing, skip if pending
   */
  async pollOnce(): Promise<void> {
    const prs = await this.listOpenPRs();

    for (const pr of prs) {
      const tracked = this.trackedPRs.get(pr.number);

      // Skip PRs we've already merged or are currently merging
      if (tracked?.state === "merged" || tracked?.state === "merging") {
        continue;
      }

      // Skip PRs awaiting security review or blocked by security issues
      if (tracked?.state === "awaiting_security_review" || tracked?.state === "security_blocked") {
        continue;
      }

      // Ensure we're tracking this PR
      if (!tracked) {
        this.trackedPRs.set(pr.number, {
          number: pr.number,
          url: pr.url,
          title: pr.title,
          branch: pr.headRefName,
          state: "awaiting_security_review",
          securityReviewPassed: false,
        });
        // Request security review for new PRs we discover
        await this.requestSecurityReview(pr.number, pr.url, pr.headRefName, "unknown");
        continue;
      }

      const { status, failureSummary, workflowUrl } = await this.checkCI(
        pr.number,
      );

      switch (status) {
        case "passing":
          // Only merge if security review has passed
          if (tracked.securityReviewPassed) {
            await this.mergePR(pr);
          }
          break;
        case "failing": {
          const current = this.trackedPRs.get(pr.number)!;
          // Don't re-request fixup if we already have one in flight
          if (current.state !== "fixup_requested") {
            await this.handleCIFailure(
              pr,
              failureSummary ?? "CI checks failed",
              workflowUrl,
            );
          }
          break;
        }
        case "pending":
        case "no_checks":
          // Nothing to do yet; check again next poll
          break;
      }
    }

    // Clean up tracked PRs that are no longer open
    const openNumbers = new Set(prs.map((pr) => pr.number));
    for (const [num, tracked] of this.trackedPRs) {
      if (!openNumbers.has(num) && tracked.state !== "merged") {
        this.trackedPRs.delete(num);
      }
    }
  }

  // --- Private helpers ---

  /** Handle incoming messages (e.g., PR_CREATED from Truffles). */
  private async handleMessage(message: CocoMessage): Promise<void> {
    try {
      if (message.type === MessageType.PR_CREATED) {
        const payload = message.payload as PRCreatedPayload;
        this.trackedPRs.set(payload.pr_number, {
          number: payload.pr_number,
          url: payload.pr_url,
          title: payload.title,
          branch: payload.branch,
          state: "awaiting_security_review",
          originalWorker: message.from,
          securityReviewPassed: false,
        });
        // Request security review
        await this.requestSecurityReview(payload.pr_number, payload.pr_url, payload.branch, message.from);
      }

      if (message.type === MessageType.SECURITY_REVIEW_PASSED) {
        const payload = message.payload as { prNumber: number; warnings: string[] };
        const tracked = this.trackedPRs.get(payload.prNumber);
        if (tracked) {
          tracked.securityReviewPassed = true;
          tracked.securityWarnings = payload.warnings;
          tracked.state = "watching";
        }
      }

      if (message.type === MessageType.SECURITY_REVIEW_FAILED) {
        const payload = message.payload as { prNumber: number; issues: Array<{ severity: string; file: string; line?: number; description: string; cwe?: string }> };
        const tracked = this.trackedPRs.get(payload.prNumber);
        if (tracked) {
          tracked.securityReviewPassed = false;
          tracked.state = "security_blocked";
          // Post comment with security issues
          await this.postSecurityComment(payload.prNumber, payload.issues);
          // Request fixup from original worker
          if (tracked.originalWorker) {
            await this.requestSecurityFixup(tracked, payload.issues);
          }
        }
      }
    } catch (err) {
      // Log but don't crash on malformed messages
      console.error(`[Temperer] Error handling message ${message.type}:`, err);
    }
  }

  /** Request security review for a PR. */
  private async requestSecurityReview(
    prNumber: number,
    prUrl: string,
    branch: string,
    workerName: string,
  ): Promise<void> {
    await this.config.broker.send({
      type: MessageType.SECURITY_REVIEW_REQUEST,
      from: this.agentName,
      to: this.securityReviewerName,
      payload: { prNumber, prUrl, branch, workerName },
      priority: "high",
      ack_required: false,
    });
  }

  /** Post a comment on a PR with security issues. */
  private async postSecurityComment(
    prNumber: number,
    issues: Array<{ severity: string; file: string; line?: number; description: string; cwe?: string }>,
  ): Promise<void> {
    const body = [
      "## 🔒 Security Review Failed\n",
      "The following security issues must be addressed before this PR can be merged:\n",
      ...issues.map((i) => {
        const location = i.line ? `${i.file}:${i.line}` : i.file;
        const cwe = i.cwe ? ` (${i.cwe})` : "";
        return `- **[${i.severity.toUpperCase()}]** ${location}: ${i.description}${cwe}`;
      }),
      "\nPlease fix these issues and push new commits to this PR.",
    ].join("\n");

    try {
      await this.execFn(
        "gh",
        ["pr", "comment", String(prNumber), "--body", body],
        { cwd: this.config.repoPath },
      );
    } catch {
      // Ignore comment failures
    }
  }

  /** Request security fixup from the original worker. */
  private async requestSecurityFixup(
    tracked: TrackedPR,
    issues: Array<{ severity: string; file: string; line?: number; description: string; cwe?: string }>,
  ): Promise<void> {
    const issuesSummary = issues
      .map((i) => `[${i.severity.toUpperCase()}] ${i.file}: ${i.description}`)
      .join("\n");

    await this.config.broker.send({
      type: MessageType.SPAWN_FIXUP,
      from: this.agentName,
      to: this.chocolatierName,
      payload: {
        pr_number: tracked.number,
        pr_url: tracked.url,
        failure_summary: `Security review failed:\n${issuesSummary}`,
        original_worker: tracked.originalWorker ?? "unknown",
      },
      priority: "high",
      ack_required: false,
    });

    tracked.state = "fixup_requested";
    tracked.fixupRequestedAt = Date.now();
  }

  /** List open PRs with the cocopilot label using `gh pr list`. */
  async listOpenPRs(): Promise<PRInfo[]> {
    try {
      const { stdout } = await this.execFn(
        "gh",
        [
          "pr",
          "list",
          "--state",
          "open",
          "--label",
          this.config.label,
          "--json",
          "number,title,headRefName,url,author",
          "--limit",
          "100",
        ],
        { cwd: this.config.repoPath },
      );

      const raw = JSON.parse(stdout) as Array<{
        number: number;
        title: string;
        headRefName: string;
        url: string;
        author: { login: string };
      }>;

      return raw.map((pr) => ({
        number: pr.number,
        title: pr.title,
        headRefName: pr.headRefName,
        url: pr.url,
        author: pr.author.login,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Check CI status for a PR using the CI monitor module.
   * Returns aggregated status with categorized failure details.
   */
  async checkCI(prNumber: number): Promise<{
    status: CIStatus;
    checks: CheckInfo[];
    failureSummary?: string;
    workflowUrl?: string;
  }> {
    const result: CIStatusResult = await getCIStatus(
      prNumber,
      this.config.repoPath,
      this.execFn as CIExecFn,
    );

    // Map ParsedCI[] back to CheckInfo[] for backward compatibility
    const checks: CheckInfo[] = result.checks.map((c) => ({
      name: c.name,
      state: c.status === "pending" ? "PENDING" : "COMPLETED",
      conclusion: c.status === "failed" ? "FAILURE" : c.status === "passed" ? "SUCCESS" : "",
      detailsUrl: c.detailsUrl,
    }));

    return {
      status: result.status,
      checks,
      failureSummary: result.failureSummary,
      workflowUrl: result.workflowUrl,
    };
  }

  /** Merge a PR via `gh pr merge --squash` and notify Chocolatier. */
  private async mergePR(pr: PRInfo): Promise<void> {
    const tracked = this.trackedPRs.get(pr.number);
    if (tracked) {
      tracked.state = "merging";
    }

    try {
      const { stdout } = await this.execFn(
        "gh",
        [
          "pr",
          "merge",
          String(pr.number),
          "--squash",
          "--delete-branch",
        ],
        { cwd: this.config.repoPath },
      );

      // Extract merge SHA from output or use a placeholder
      const mergeSha = this.parseMergeSha(stdout);

      if (tracked) {
        tracked.state = "merged";
      }

      // Notify Chocolatier of the successful merge
      await this.config.broker.send({
        type: MessageType.PR_MERGED,
        from: this.agentName,
        to: this.chocolatierName,
        payload: {
          pr_number: pr.number,
          pr_url: pr.url,
          merge_sha: mergeSha,
        },
      });
    } catch (err) {
      // Merge failed - revert to watching so we retry next poll
      if (tracked) {
        tracked.state = "watching";
      }
      throw err;
    }
  }

  /** Handle a CI failure: notify Chocolatier and request a fixup worker. */
  private async handleCIFailure(
    pr: PRInfo,
    failureSummary: string,
    workflowUrl?: string,
  ): Promise<void> {
    const tracked = this.trackedPRs.get(pr.number);
    if (tracked) {
      tracked.state = "fixup_requested";
      tracked.fixupRequestedAt = Date.now();
    }

    // Send CI_FAILED notification
    await this.config.broker.send({
      type: MessageType.CI_FAILED,
      from: this.agentName,
      to: this.chocolatierName,
      payload: {
        pr_number: pr.number,
        pr_url: pr.url,
        failure_summary: failureSummary,
        workflow_url: workflowUrl,
      },
      priority: "high",
    });

    // Request fixup worker via SPAWN_FIXUP
    await this.config.broker.send({
      type: MessageType.SPAWN_FIXUP,
      from: this.agentName,
      to: this.chocolatierName,
      payload: {
        pr_number: pr.number,
        pr_url: pr.url,
        failure_summary: failureSummary,
        original_worker: tracked?.originalWorker ?? "unknown",
      },
      priority: "high",
    });
  }

  /** Try to extract a merge SHA from gh pr merge output. */
  private parseMergeSha(output: string): string {
    // gh pr merge output may contain the merge commit SHA
    const match = /([0-9a-f]{40})/i.exec(output);
    return match ? match[1] : "unknown";
  }
}
