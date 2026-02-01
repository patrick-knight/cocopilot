/**
 * Reviewer Agent
 *
 * A dedicated code review bot that reads PRs and leaves comments.
 * Following the multiclaude philosophy: "Forward progress is forward."
 * Default to non-blocking suggestions unless there's a genuine concern.
 *
 * Blocking issues:
 *   - Security vulnerabilities
 *   - Obvious bugs (nil deref, race conditions)
 *   - Breaking changes without migration
 *   - Roadmap violations (out-of-scope features)
 *
 * Non-blocking (suggestions):
 *   - Style suggestions
 *   - Naming improvements
 *   - Performance optimizations (unless severe)
 *   - Documentation gaps
 *   - Test coverage suggestions
 */

import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  MessageBroker,
  MessageType,
} from "../messaging/index.js";
import { scopedAgentName } from "./scoped-name.js";
import type {
  ReviewerConfig,
  ReviewerEvents,
  ReviewComment,
  ReviewResult,
} from "./types.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const REVIEWER_SYSTEM_PROMPT = `You are a code review agent for CoCoPilot. Help code get merged safely.

## Philosophy

**Forward progress is forward.** Default to non-blocking suggestions unless there's a genuine concern.

## Process

1. Get the diff with the provided tools
2. Analyze for issues (security, bugs, breaking changes)
3. Post comments - blocking only for real problems
4. Report summary to merge queue
5. Mark review complete

## Comment Format

**Non-blocking (default):**
Post as: "**Suggestion:** Consider extracting this into a helper."

**Blocking (use sparingly):**
Post as: "**[BLOCKING]** SQL injection - use parameterized queries."

## What's Blocking?

- Security vulnerabilities (injection, XSS, auth bypass)
- Obvious bugs (null deref, race conditions, infinite loops)
- Breaking changes without migration path
- Out-of-scope features (check ROADMAP.md if present)

## What's NOT Blocking?

- Style suggestions
- Naming improvements
- Performance optimizations (unless severe)
- Documentation gaps
- Test coverage suggestions
- "I would have done it differently"

## Tools Available

- get_pr_diff: Get the diff for a PR
- post_comment: Post a review comment
- report_to_merge_queue: Send review summary
- mark_complete: Signal review is done
`;

// ---------------------------------------------------------------------------
// ReviewerAgent
// ---------------------------------------------------------------------------

export class ReviewerAgent extends EventEmitter<ReviewerEvents> {
  private readonly config: ReviewerConfig;
  private readonly broker: MessageBroker;
  private _isRunning = false;

  constructor(config: ReviewerConfig, broker: MessageBroker) {
    super();
    this.config = {
      agentName: scopedAgentName("reviewer", config.repoName),
      mergeQueueName: scopedAgentName("temperer", config.repoName),
      autoComplete: true,
      ...config,
    };
    this.broker = broker;
  }

  get name(): string {
    return this.config.agentName ?? "reviewer";
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async start(): Promise<void> {
    await this.broker.subscribe(this.name, (msg) => this.handleMessage(msg));
    this._isRunning = true;
  }

  async stop(): Promise<void> {
    await this.broker.unsubscribe(this.name);
    this._isRunning = false;
  }

  // -----------------------------------------------------------------------
  // Core review functionality
  // -----------------------------------------------------------------------

  /**
   * Review a pull request by number.
   * Gets the diff, analyzes it, and returns the review result.
   */
  async reviewPR(prNumber: number): Promise<ReviewResult> {
    this.emit("reviewStarted", prNumber);

    // Get the PR diff
    const diff = await this.getPRDiff(prNumber);

    // Analyze the diff (this would be enhanced with AI in production)
    const comments = await this.analyzeDiff(diff, prNumber);

    // Post comments
    for (const comment of comments) {
      await this.postComment(prNumber, comment);
      this.emit("commentPosted", comment);
    }

    // Calculate result
    const blockingCount = comments.filter((c) => c.blocking).length;
    const suggestionCount = comments.filter((c) => !c.blocking).length;
    const verdict = this.determineVerdict(blockingCount, suggestionCount);

    const result: ReviewResult = {
      prNumber,
      totalComments: comments.length,
      blockingCount,
      suggestionCount,
      verdict,
      summary: this.buildSummary(prNumber, blockingCount, suggestionCount),
    };

    // Report to merge queue
    await this.reportToMergeQueue(result);

    this.emit("reviewCompleted", result);

    return result;
  }

  /**
   * Get the diff for a pull request using gh CLI.
   */
  async getPRDiff(prNumber: number): Promise<string> {
    const { stdout } = await this.exec(
      "gh",
      ["pr", "diff", String(prNumber)],
      this.config.repoPath,
    );
    return stdout;
  }

  /**
   * Analyze a diff and return review comments.
   * This is a basic implementation - in production would use AI analysis.
   */
  async analyzeDiff(diff: string, _prNumber: number): Promise<ReviewComment[]> {
    const comments: ReviewComment[] = [];

    // Basic security pattern detection
    const securityPatterns = [
      { pattern: /eval\s*\(/gi, message: "Potential code injection via eval()", blocking: true },
      { pattern: /innerHTML\s*=/gi, message: "Potential XSS via innerHTML assignment", blocking: true },
      { pattern: /dangerouslySetInnerHTML/gi, message: "Review dangerouslySetInnerHTML usage for XSS", blocking: false },
      { pattern: /password\s*=\s*["'][^"']+["']/gi, message: "Hardcoded password detected", blocking: true },
      { pattern: /api[_-]?key\s*=\s*["'][^"']+["']/gi, message: "Hardcoded API key detected", blocking: true },
      { pattern: /exec\s*\(\s*[`"'].*\$\{/gi, message: "Potential command injection", blocking: true },
    ];

    // Parse diff to extract file names and content
    const filePattern = /^diff --git a\/(.+?) b\/(.+?)$/gm;
    let match;
    const files: string[] = [];
    while ((match = filePattern.exec(diff)) !== null) {
      files.push(match[2]);
    }

    // Check for security issues
    for (const { pattern, message, blocking } of securityPatterns) {
      if (pattern.test(diff)) {
        comments.push({
          file: files[0] ?? "unknown",
          body: blocking ? `**[BLOCKING]** ${message}` : `**Suggestion:** ${message}`,
          blocking,
        });
      }
    }

    return comments;
  }

  /**
   * Post a comment on a PR using gh CLI.
   */
  async postComment(prNumber: number, comment: ReviewComment): Promise<void> {
    const body = comment.line
      ? `${comment.file}:${comment.line}\n\n${comment.body}`
      : `${comment.file}\n\n${comment.body}`;

    await this.exec(
      "gh",
      ["pr", "comment", String(prNumber), "--body", body],
      this.config.repoPath,
    );
  }

  /**
   * Post a summary comment on a PR.
   */
  async postSummary(prNumber: number, result: ReviewResult): Promise<void> {
    const emoji = result.verdict === "approve" ? "✅" : result.verdict === "request_changes" ? "❌" : "💬";
    const body = `## ${emoji} Code Review Summary\n\n${result.summary}\n\n` +
      `- **Blocking issues:** ${result.blockingCount}\n` +
      `- **Suggestions:** ${result.suggestionCount}\n\n` +
      `*Review by CoCoPilot Reviewer Agent*`;

    await this.exec(
      "gh",
      ["pr", "comment", String(prNumber), "--body", body],
      this.config.repoPath,
    );
  }

  // -----------------------------------------------------------------------
  // Messaging
  // -----------------------------------------------------------------------

  /**
   * Report review result to the merge queue agent.
   */
  private async reportToMergeQueue(result: ReviewResult): Promise<void> {
    const mergeQueue = this.config.mergeQueueName ?? "temperer";
    await this.broker.send({
      type: MessageType.REVIEW_COMPLETE,
      from: this.name,
      to: mergeQueue,
      payload: {
        pr_number: result.prNumber,
        blocking_count: result.blockingCount,
        suggestion_count: result.suggestionCount,
        verdict: result.verdict,
        summary: result.summary,
      },
    });
  }

  /**
   * Handle incoming messages.
   */
  private async handleMessage(message: { type: string; payload?: unknown }): Promise<void> {
    switch (message.type) {
      case MessageType.STATUS_REQUEST: {
        // Could respond with current review status
        break;
      }
      default:
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private determineVerdict(
    blockingCount: number,
    suggestionCount: number,
  ): "approve" | "request_changes" | "comment" {
    if (blockingCount > 0) return "request_changes";
    if (suggestionCount > 0) return "comment";
    return "approve";
  }

  private buildSummary(
    prNumber: number,
    blockingCount: number,
    suggestionCount: number,
  ): string {
    if (blockingCount === 0 && suggestionCount === 0) {
      return `Review complete for PR #${prNumber}. No issues found. Safe to merge.`;
    }
    if (blockingCount === 0) {
      return `Review complete for PR #${prNumber}. ${suggestionCount} suggestion(s). Safe to merge.`;
    }
    return `Review complete for PR #${prNumber}. ${blockingCount} blocking issue(s), ${suggestionCount} suggestion(s). Needs fixes before merge.`;
  }

  /** Run an external command. */
  private async exec(
    command: string,
    args: string[],
    cwd: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(command, args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    });
  }
}
