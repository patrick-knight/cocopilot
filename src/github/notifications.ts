/**
 * GitHub Issues-based Notification Service
 *
 * Creates GitHub issues for significant CoCoPilot events (worker failures,
 * CI failures, merge conflicts, timeouts). Notifications are fire-and-forget
 * and default to disabled (opt-in per repo).
 *
 * Uses the `gh` CLI via the same execFileAsync pattern as helpers.ts.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import type { ExecFn } from "./types.js";
import type { GitHubHelperContext } from "./helpers.js";

const execFileDefault = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationConfig {
  enabled: boolean;
  events: string[];
  labels?: string[];
}

export interface NotificationEvent {
  type: string;
  summary: string;
  details: Record<string, unknown>;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_NOTIFICATION_EVENTS = [
  "worker.failed",
  "worker.timeout",
  "ci.failed",
  "merge.conflict",
];

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  enabled: false,
  events: DEFAULT_NOTIFICATION_EVENTS,
  labels: ["cocopilot-notification"],
};

const EVENT_LABELS: Record<string, string> = {
  "worker.failed": "worker-failure",
  "worker.timeout": "worker-timeout",
  "ci.failed": "ci-failure",
  "merge.conflict": "merge-conflict",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function exec(ctx: GitHubHelperContext): ExecFn {
  return ctx.execFn ?? execFileDefault;
}

/**
 * Check if a notification should be sent for the given event type.
 */
export function shouldNotify(config: NotificationConfig, eventType: string): boolean {
  return config.enabled && config.events.includes(eventType);
}

/**
 * Build the issue title for a notification event.
 */
function buildTitle(event: NotificationEvent): string {
  return `[CoCoPilot] ${event.type}: ${event.summary}`;
}

/**
 * Build the issue body with event details in Markdown.
 */
function buildBody(event: NotificationEvent): string {
  const timestamp = event.timestamp ?? new Date().toISOString();
  const { type, summary, details } = event;

  const sections: string[] = [
    `## 🍫 CoCoPilot Notification`,
    "",
    `**Event:** \`${type}\``,
    `**Time:** ${timestamp}`,
    `**Summary:** ${summary}`,
    "",
  ];

  // Event-specific details
  switch (type) {
    case "worker.failed":
      sections.push(
        `### Worker Failure`,
        "",
        `Worker **${details.workerName ?? "unknown"}** failed on task: ${details.task ?? "unknown"}.`,
        "",
        `**Error:** ${details.error ?? "No error details"}`,
        "",
        `> **Suggested action:** Consider re-running the task or checking worker logs.`,
      );
      break;
    case "worker.timeout":
      sections.push(
        `### Worker Timeout`,
        "",
        `Worker **${details.workerName ?? "unknown"}** exceeded timeout (${details.timeout ?? "unknown"}).`,
        "",
        `**Task:** ${details.task ?? "unknown"}`,
        "",
        `> **Suggested action:** The worker has been terminated. Consider breaking the task into smaller pieces or increasing the timeout.`,
      );
      break;
    case "ci.failed":
      sections.push(
        `### CI Failure`,
        "",
        `CI failed on PR #${details.prNumber ?? "?"} by worker **${details.workerName ?? "unknown"}**.`,
        "",
        `**Failures:** ${details.failureSummary ?? "Unknown failures"}`,
        details.workflowUrl ? `**Workflow:** ${details.workflowUrl}` : "",
        "",
        `> **Suggested action:** A fixup worker has been spawned to address the failures.`,
      );
      break;
    case "merge.conflict":
      sections.push(
        `### Merge Conflict`,
        "",
        `PR #${details.prNumber ?? "?"} has merge conflicts with **${details.baseBranch ?? "main"}**.`,
        "",
        `> **Suggested action:** Manual resolution or a fixup worker is needed.`,
      );
      break;
    default:
      sections.push(
        `### Details`,
        "",
        "```json",
        JSON.stringify(details, null, 2),
        "```",
      );
  }

  sections.push(
    "",
    "---",
    "*This issue was created automatically by CoCoPilot.*",
  );

  return sections.filter((s) => s !== undefined).join("\n");
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Check if an open issue with the given title already exists.
 * Returns true if a duplicate exists.
 */
async function hasDuplicateIssue(
  ctx: GitHubHelperContext,
  title: string,
): Promise<boolean> {
  try {
    const { stdout } = await exec(ctx)(
      "gh",
      [
        "issue",
        "list",
        "--search",
        title,
        "--state",
        "open",
        "--json",
        "number",
        "--limit",
        "5",
      ],
      { cwd: ctx.repoPath },
    );

    const issues = JSON.parse(stdout) as Array<{ number: number }>;
    return issues.length > 0;
  } catch {
    // If search fails, proceed with creation (better to duplicate than to miss)
    return false;
  }
}

/**
 * Create a GitHub issue for a notification event.
 *
 * Fire-and-forget: failures are logged but never block agent operations.
 */
export async function createNotificationIssue(
  ctx: GitHubHelperContext,
  event: NotificationEvent,
): Promise<void> {
  const title = buildTitle(event);
  const body = buildBody(event);

  // Duplicate detection
  const duplicate = await hasDuplicateIssue(ctx, title);
  if (duplicate) {
    return;
  }

  const labels = ["cocopilot-notification"];
  const eventLabel = EVENT_LABELS[event.type];
  if (eventLabel) {
    labels.push(eventLabel);
  }

  try {
    await exec(ctx)(
      "gh",
      [
        "issue",
        "create",
        "--title",
        title,
        "--body",
        body,
        "--label",
        labels.join(","),
      ],
      { cwd: ctx.repoPath },
    );
  } catch (err) {
    // Fire-and-forget: log but never throw
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Notifications] Failed to create issue for ${event.type}: ${msg}`);
  }
}
