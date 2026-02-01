/**
 * The Enrober — PR Shepherd Agent for CoCoPilot multiplayer mode.
 *
 * In multiplayer mode (forks, team repos), the Enrober replaces the Temperer.
 * It tracks PRs needing human review, pings reviewers, checks approval status,
 * coordinates with upstream maintainers for fork workflows, and NEVER
 * auto-merges — humans make the final call.
 *
 * Polls open PRs every 2 minutes (configurable) using `gh pr list`.
 * Checks review status via `gh pr view`.
 * Posts review-request comments via `gh pr comment`.
 * Surfaces blocked PRs to the dashboard via the message broker.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
  MessageBroker,
  MessageType,
  type CocoMessage,
  type PRCreatedPayload,
} from "../messaging/index.js";
import type {
  EnroberConfig,
  ReviewerStatus,
  ApprovalState,
} from "./types.js";

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const AGENT_TYPE = "enrober";
const DEFAULT_LABEL = "cocopilot";

/**
 * Build the unique agent name for a repo-specific Enrober.
 * Used both internally and by API routes that address this agent.
 */
export function enroberAgentName(repoName: string): string {
  return `${AGENT_TYPE}:${repoName}`;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const ENROBER_SYSTEM_PROMPT = `You are the Enrober, the PR shepherd for CoCoPilot multiplayer mode. You coordinate human review for AI-generated pull requests.

Your responsibilities:
1. Track PRs that need human review
2. Ping reviewers when PRs are ready
3. Respect approval requirements before suggesting merge
4. Coordinate with upstream maintainers for fork workflows
5. Never auto-merge—humans make the final call

You have access to these tools:
- list_prs: Get all tracked PRs with their review and CI status
- check_approval: Check the approval state of a specific PR
- notify_reviewers: Post a comment on a PR requesting review

Guidelines:
- Poll open PRs every 2 minutes for review status changes
- When a PR has all CI checks passing, notify requested reviewers
- When a PR is approved and CI passes, surface it as "ready to merge" — but do NOT merge it
- If a reviewer requests changes, notify the original worker's Chocolatier
- For fork workflows, check upstream PR status and coordinate with maintainers
- Surface blocked PRs (stale reviews, no reviewers assigned, etc.) to the dashboard
- Always respect branch protection rules and required approval counts

Remember: "Every good chocolate needs a proper coating — and every PR needs a proper review."`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A PR returned by `gh pr list` with review-relevant fields. */
export interface EnroberPRInfo {
  number: number;
  title: string;
  headRefName: string;
  url: string;
  author: string;
  isDraft: boolean;
  reviewDecision: string;
}

/** Internal tracking state for a PR the Enrober is monitoring. */
export type TrackedEnroberPRState =
  | "needs_review"
  | "review_in_progress"
  | "changes_requested"
  | "approved"
  | "ready_to_merge"
  | "blocked";

export interface TrackedEnroberPR {
  number: number;
  url: string;
  title: string;
  branch: string;
  state: TrackedEnroberPRState;
  originalWorker?: string;
  approvalState?: ApprovalState;
  reviewersNotifiedAt?: number;
  blockedReason?: string;
  lastCheckedAt: number;
}

/** Function signature used to execute gh CLI commands. Exposed for testing. */
export type ExecFn = (
  file: string,
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

// ---------------------------------------------------------------------------
// Enrober class
// ---------------------------------------------------------------------------

/**
 * The Enrober PR shepherd agent.
 *
 * Lifecycle: create → start() → ... → stop()
 */
export class Enrober {
  private readonly config: Required<
    Pick<EnroberConfig, "repoPath" | "repoName" | "pollIntervalMs" | "label">
  > & { broker: MessageBroker };
  private readonly trackedPRs: Map<number, TrackedEnroberPR> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly execFn: ExecFn;
  private readonly broker: MessageBroker;

  constructor(
    config: EnroberConfig & { broker: MessageBroker },
    execFn?: ExecFn,
  ) {
    this.config = {
      repoPath: config.repoPath,
      repoName: config.repoName,
      broker: config.broker,
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      label: config.label ?? DEFAULT_LABEL,
    };
    this.broker = config.broker;
    this.execFn = execFn ?? execFile;
  }

  /** Get the repo-scoped agent name. */
  get agentName(): string {
    return enroberAgentName(this.config.repoName);
  }

  /** Get the repo-scoped chocolatier name for messaging. */
  get chocolatierName(): string {
    return `chocolatier:${this.config.repoName}`;
  }

  /** Start the Enrober: subscribe to messages and begin polling. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Subscribe to incoming messages (e.g., PR_CREATED from Truffles)
    await this.broker.subscribe(
      this.agentName,
      this.handleMessage.bind(this),
    );

    // Run first poll immediately, then on interval
    await this.pollOnce();
    this.pollTimer = setInterval(() => {
      this.pollOnce().catch(() => {});
    }, this.config.pollIntervalMs);
  }

  /** Stop polling and unsubscribe from messages. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await this.broker.unsubscribe(this.agentName);
  }

  /** Whether the agent is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Read-only view of tracked PRs. */
  getTrackedPRs(): ReadonlyMap<number, TrackedEnroberPR> {
    return this.trackedPRs;
  }

  // -----------------------------------------------------------------------
  // Poll cycle
  // -----------------------------------------------------------------------

  /**
   * Execute a single poll cycle:
   * 1. List open PRs with the cocopilot label
   * 2. For each PR, check review/approval status
   * 3. Notify reviewers, surface blocked PRs, or mark ready-to-merge
   */
  async pollOnce(): Promise<void> {
    const prs = await this.listOpenPRs();

    for (const pr of prs) {
      const existing = this.trackedPRs.get(pr.number);

      // Skip draft PRs — not ready for review
      if (pr.isDraft) {
        continue;
      }

      // Skip PRs already marked ready_to_merge
      if (existing?.state === "ready_to_merge") {
        continue;
      }

      // Ensure we're tracking this PR
      if (!existing) {
        this.trackedPRs.set(pr.number, {
          number: pr.number,
          url: pr.url,
          title: pr.title,
          branch: pr.headRefName,
          state: "needs_review",
          lastCheckedAt: Date.now(),
        });
      }

      // Check approval status
      const approvalState = await this.checkApproval(pr.number);
      const tracked = this.trackedPRs.get(pr.number)!;
      tracked.approvalState = approvalState;
      tracked.lastCheckedAt = Date.now();

      if (approvalState.changesRequested) {
        // Reviewer requested changes — notify Chocolatier
        if (tracked.state !== "changes_requested") {
          tracked.state = "changes_requested";
          await this.notifyChangesRequested(pr, approvalState);
        }
      } else if (approvalState.approved) {
        // PR is approved — check if CI passes to mark ready-to-merge
        const ciPassing = await this.isCIPassing(pr.number);
        if (ciPassing) {
          tracked.state = "ready_to_merge";
          await this.notifyReadyToMerge(pr, approvalState);
        } else {
          tracked.state = "approved";
        }
      } else if (approvalState.reviewers.length === 0) {
        // No reviewers assigned — surface as blocked
        if (tracked.state !== "blocked" || tracked.blockedReason !== "no_reviewers") {
          tracked.state = "blocked";
          tracked.blockedReason = "no_reviewers";
          await this.surfaceBlockedPR(pr, "No reviewers assigned");
        }
      } else {
        // Reviews pending — ping reviewers if not recently notified
        tracked.state = "review_in_progress";
        const shouldNotify =
          !tracked.reviewersNotifiedAt ||
          Date.now() - tracked.reviewersNotifiedAt > this.config.pollIntervalMs * 5;
        if (shouldNotify) {
          await this.pingReviewers(pr.number);
          tracked.reviewersNotifiedAt = Date.now();
        }
      }
    }

    // Clean up tracked PRs that are no longer open
    const openNumbers = new Set(prs.map((pr) => pr.number));
    for (const [num, tracked] of this.trackedPRs) {
      if (!openNumbers.has(num) && tracked.state !== "ready_to_merge") {
        this.trackedPRs.delete(num);
      }
    }
  }

  // -----------------------------------------------------------------------
  // GitHub queries
  // -----------------------------------------------------------------------

  /** List open PRs with the cocopilot label using `gh pr list`. */
  async listOpenPRs(): Promise<EnroberPRInfo[]> {
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
          "number,title,headRefName,url,author,isDraft,reviewDecision",
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
        isDraft: boolean;
        reviewDecision: string;
      }>;

      return raw.map((pr) => ({
        number: pr.number,
        title: pr.title,
        headRefName: pr.headRefName,
        url: pr.url,
        author: pr.author.login,
        isDraft: pr.isDraft,
        reviewDecision: pr.reviewDecision,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Check approval status for a PR using `gh pr view`.
   * Returns the aggregated approval state.
   */
  async checkApproval(prNumber: number): Promise<ApprovalState> {
    try {
      const { stdout } = await this.execFn(
        "gh",
        [
          "pr",
          "view",
          String(prNumber),
          "--json",
          "reviews,reviewRequests",
        ],
        { cwd: this.config.repoPath },
      );

      const data = JSON.parse(stdout) as {
        reviews: Array<{
          author: { login: string };
          state: string;
          submittedAt: string;
        }>;
        reviewRequests: Array<{
          login?: string;
          name?: string;
        }>;
      };

      // Build per-reviewer status from latest reviews
      const reviewerMap = new Map<string, ReviewerStatus>();

      // Add requested reviewers as PENDING
      for (const req of data.reviewRequests) {
        const login = req.login ?? req.name ?? "unknown";
        reviewerMap.set(login, {
          login,
          state: "PENDING",
          submittedAt: null,
        });
      }

      // Process actual reviews (latest review per reviewer wins)
      for (const review of data.reviews) {
        const login = review.author.login;
        const existing = reviewerMap.get(login);
        if (
          !existing ||
          existing.state === "PENDING" ||
          new Date(review.submittedAt).getTime() >
            (existing.submittedAt
              ? new Date(existing.submittedAt).getTime()
              : 0)
        ) {
          reviewerMap.set(login, {
            login,
            state: review.state as ReviewerStatus["state"],
            submittedAt: review.submittedAt,
          });
        }
      }

      const reviewers = Array.from(reviewerMap.values());
      const approvalCount = reviewers.filter(
        (r) => r.state === "APPROVED",
      ).length;
      const changesRequested = reviewers.some(
        (r) => r.state === "CHANGES_REQUESTED",
      );

      // Default required approvals to 1 (branch protection rules
      // would provide the real value; we use 1 as a safe default).
      const requiredApprovals = 1;
      const approved =
        approvalCount >= requiredApprovals && !changesRequested;

      return {
        approved,
        approvalCount,
        requiredApprovals,
        changesRequested,
        reviewers,
      };
    } catch {
      return {
        approved: false,
        approvalCount: 0,
        requiredApprovals: 1,
        changesRequested: false,
        reviewers: [],
      };
    }
  }

  /**
   * Check if CI is passing for a PR using `gh pr checks`.
   */
  async isCIPassing(prNumber: number): Promise<boolean> {
    try {
      const { stdout } = await this.execFn(
        "gh",
        [
          "pr",
          "checks",
          String(prNumber),
          "--json",
          "name,state,conclusion",
        ],
        { cwd: this.config.repoPath },
      );

      const checks = JSON.parse(stdout) as Array<{
        name: string;
        state: string;
        conclusion: string;
      }>;

      if (checks.length === 0) return false;

      const allPassed = checks.every(
        (c) =>
          c.conclusion === "SUCCESS" ||
          c.conclusion === "success" ||
          c.conclusion === "NEUTRAL" ||
          c.conclusion === "neutral" ||
          c.conclusion === "SKIPPED" ||
          c.conclusion === "skipped",
      );

      return allPassed;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Actions — never auto-merge, only notify
  // -----------------------------------------------------------------------

  /**
   * Post a comment on a PR requesting review from assigned reviewers.
   */
  async pingReviewers(prNumber: number): Promise<void> {
    try {
      await this.execFn(
        "gh",
        [
          "pr",
          "comment",
          String(prNumber),
          "--body",
          "🍫 **CoCoPilot Enrober**: This PR is ready for review. Reviewers, please take a look when you have a moment.",
        ],
        { cwd: this.config.repoPath },
      );
    } catch {
      // Comment failed — not critical, will retry next poll
    }
  }

  /**
   * Notify the Chocolatier that a reviewer requested changes on a PR.
   */
  private async notifyChangesRequested(
    pr: EnroberPRInfo,
    approvalState: ApprovalState,
  ): Promise<void> {
    const requesters = approvalState.reviewers
      .filter((r) => r.state === "CHANGES_REQUESTED")
      .map((r) => r.login)
      .join(", ");

    await this.broker.send({
      type: MessageType.BROADCAST,
      from: this.agentName,
      to: "*",
      payload: {
        message: `PR #${pr.number} (${pr.title}) has changes requested by: ${requesters}`,
        level: "warning" as const,
      },
    });
  }

  /**
   * Notify the dashboard and Chocolatier that a PR is ready to merge.
   * The Enrober NEVER auto-merges — only surfaces the suggestion.
   */
  private async notifyReadyToMerge(
    pr: EnroberPRInfo,
    approvalState: ApprovalState,
  ): Promise<void> {
    // Post a comment on the PR
    try {
      await this.execFn(
        "gh",
        [
          "pr",
          "comment",
          String(pr.number),
          "--body",
          `🍫 **CoCoPilot Enrober**: This PR is approved (${approvalState.approvalCount} approval(s)) and CI is passing. It is ready to merge when a maintainer is ready.`,
        ],
        { cwd: this.config.repoPath },
      );
    } catch {
      // Comment failed — not critical
    }

    // Broadcast to the dashboard
    await this.broker.send({
      type: MessageType.BROADCAST,
      from: this.agentName,
      to: "*",
      payload: {
        message: `PR #${pr.number} (${pr.title}) is ready to merge — approved and CI passing`,
        level: "info" as const,
      },
    });
  }

  /**
   * Surface a blocked PR to the dashboard via a broadcast message.
   */
  private async surfaceBlockedPR(
    pr: EnroberPRInfo,
    reason: string,
  ): Promise<void> {
    await this.broker.send({
      type: MessageType.BROADCAST,
      from: this.agentName,
      to: "*",
      payload: {
        message: `PR #${pr.number} (${pr.title}) is blocked: ${reason}`,
        level: "warning" as const,
      },
    });
  }

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

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
          state: "needs_review",
          originalWorker: message.from,
          lastCheckedAt: Date.now(),
        });
      }
    } catch (err) {
      // Log but don't crash on malformed messages
      console.error(`[Enrober] Error handling message ${message.type}:`, err);
    }
  }

  // -----------------------------------------------------------------------
  // Tool definitions (for Copilot SDK integration)
  // -----------------------------------------------------------------------

  /**
   * Returns the custom tool definitions for the Copilot SDK session.
   */
  getToolDefinitions(): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (params: Record<string, unknown>) => Promise<unknown>;
  }> {
    return [
      {
        name: "list_prs",
        description:
          "Get all tracked PRs with their review and CI status.",
        parameters: {
          type: "object",
          properties: {},
        },
        handler: async () => {
          const prs = Array.from(this.trackedPRs.values());
          return { prs, count: prs.length };
        },
      },
      {
        name: "check_approval",
        description:
          "Check the approval state of a specific PR including reviewer status.",
        parameters: {
          type: "object",
          properties: {
            pr_number: {
              type: "number",
              description: "The PR number to check",
            },
          },
          required: ["pr_number"],
        },
        handler: async (params) => {
          const prNumber = params.pr_number as number;
          const state = await this.checkApproval(prNumber);
          return state;
        },
      },
      {
        name: "notify_reviewers",
        description:
          "Post a comment on a PR requesting review from assigned reviewers.",
        parameters: {
          type: "object",
          properties: {
            pr_number: {
              type: "number",
              description: "The PR number to notify reviewers on",
            },
          },
          required: ["pr_number"],
        },
        handler: async (params) => {
          const prNumber = params.pr_number as number;
          await this.pingReviewers(prNumber);
          return { notified: true, pr_number: prNumber };
        },
      },
    ];
  }

  /**
   * Returns the system prompt for the Copilot SDK session.
   */
  getSystemPrompt(): string {
    return ENROBER_SYSTEM_PROMPT;
  }
}
