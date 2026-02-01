/**
 * Shared agent interfaces for CoCoPilot.
 *
 * Defines common types used across all agent implementations
 * (Chocolatier, Temperer, Enrober, Truffles).
 */

import type { WorkerState, AgentState, RepoState } from "../state/index.js";
import type { ContainerStatus } from "../docker/index.js";

// ---------------------------------------------------------------------------
// Agent lifecycle
// ---------------------------------------------------------------------------

/** Configuration shared by all agent types. */
export interface AgentConfig {
  /** The repository this agent is managing. */
  repoName: string;
  /** Docker image to use for worker containers. */
  agentImage: string;
  /** Memory limit for worker containers (e.g., "4g"). */
  containerMemoryLimit: string;
  /** CPU limit for worker containers (e.g., "2"). */
  containerCpuLimit: string;
  /** Worker runtime mode: spawn Docker containers or run locally. */
  workerRuntime: "container" | "local";
}

/** Configuration specific to the Chocolatier (supervisor) agent. */
export interface ChocolatierConfig extends AgentConfig {
  /** Health check interval in milliseconds. */
  healthCheckIntervalMs: number;
  /**
   * Duration (ms) after which a worker with no activity is considered stuck.
   * Defaults to 15 minutes.
   */
  stuckThresholdMs: number;
}

/** Options for spawning a new Truffle worker. */
export interface SpawnWorkerOptions {
  /** Task description for the worker. */
  task: string;
  /** Git branch to start from (optional, auto-generated if omitted). */
  branch?: string;
  /** Explicit worker name (optional, auto-assigned candy name if omitted). */
  name?: string;
  /** Model override for this worker. */
  model?: string;
  /** Priority level for the task. */
  priority?: "low" | "normal" | "high";
  /**
   * Push to an existing branch instead of creating a new one.
   * Useful for iterating on existing PRs.
   * When set, the worker will checkout this branch and push changes to it.
   */
  pushTo?: string;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/** Result of a single worker health check. */
export interface WorkerHealthStatus {
  /** Worker name (candy name). */
  name: string;
  /** Worker status from state. */
  stateStatus: WorkerState["status"];
  /** Container status from Docker (null if no container found). */
  containerStatus: ContainerStatus | null;
  /** Whether the worker appears to be stuck. */
  isStuck: boolean;
  /** Whether the container is missing (state says running, Docker disagrees). */
  containerMissing: boolean;
  /** Time since last activity update (ms). */
  inactivityMs: number;
}

/** Aggregate result of a health check across all workers for a repo. */
export interface HealthCheckReport {
  /** Repository name. */
  repoName: string;
  /** Timestamp of the check. */
  timestamp: string;
  /** Per-worker health status. */
  workers: WorkerHealthStatus[];
  /** Workers that need attention (stuck or container missing). */
  issues: WorkerHealthStatus[];
}

// ---------------------------------------------------------------------------
// Worker listing
// ---------------------------------------------------------------------------

/** Summary of a worker's current state, combining state + container info. */
export interface WorkerSummary {
  /** Worker name (candy name). */
  name: string;
  /** The assigned task. */
  task: string;
  /** Git branch. */
  branch: string;
  /** Current status. */
  status: WorkerState["status"];
  /** Docker container ID, if any. */
  containerId?: string;
  /** Docker container status, if known. */
  containerStatus?: ContainerStatus;
  /** PR number, if a PR has been created. */
  prNumber?: number;
  /** PR URL, if a PR has been created. */
  prUrl?: string;
  /** When the worker was created. */
  createdAt: string;
  /** When the worker was last updated. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Tool definitions (Copilot SDK compatible)
// ---------------------------------------------------------------------------

/** Schema for a tool parameter (JSON Schema subset). */
export interface ToolParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
}

/**
 * Definition of a custom tool that agents expose via the Copilot SDK.
 * Follows the `defineTool` pattern from `@github/copilot-sdk`.
 */
export interface AgentToolDefinition {
  /** Unique tool name. */
  name: string;
  /** Description shown to the model. */
  description: string;
  /** JSON Schema for the tool's parameters. */
  parameters: ToolParameterSchema;
  /** The handler function invoked when the tool is called. */
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Enrober (PR Shepherd) types
// ---------------------------------------------------------------------------

/** Configuration for the Enrober (PR shepherd) agent. */
export interface EnroberConfig {
  /** Path to the git repository to monitor. */
  repoPath: string;
  /** The repository name (used for scoped agent naming). */
  repoName: string;
  /** Polling interval in milliseconds. Defaults to 120000 (2 min). */
  pollIntervalMs?: number;
  /** Agent name for messaging. Defaults to "enrober". */
  agentName?: string;
  /** Chocolatier agent name. Defaults to "chocolatier". */
  chocolatierName?: string;
  /** PR label used to identify CoCoPilot PRs. Defaults to "cocopilot". */
  label?: string;
}

/** Review status of an individual reviewer on a PR. */
export interface ReviewerStatus {
  /** GitHub login of the reviewer. */
  login: string;
  /** Current review state. */
  state: "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
  /** When the review was last submitted (ISO string), or null if pending. */
  submittedAt: string | null;
}

/** Aggregated approval state for a PR. */
export interface ApprovalState {
  /** Whether the PR has met approval requirements. */
  approved: boolean;
  /** Number of approvals received. */
  approvalCount: number;
  /** Number of approvals required (from branch protection). */
  requiredApprovals: number;
  /** Whether any reviewer has requested changes. */
  changesRequested: boolean;
  /** Per-reviewer status. */
  reviewers: ReviewerStatus[];
}

// ---------------------------------------------------------------------------
// Agent events
// ---------------------------------------------------------------------------

/** Events emitted by the Chocolatier agent. */
export interface ChocolatierEvents {
  /** Emitted when a health check completes. */
  healthCheck: [report: HealthCheckReport];
  /** Emitted when a worker is detected as stuck. */
  workerStuck: [repoName: string, workerName: string];
  /** Emitted when a worker's container goes missing. */
  workerContainerMissing: [repoName: string, workerName: string];
  /** Emitted when a new worker is spawned. */
  workerSpawned: [repoName: string, worker: WorkerState];
  /** Emitted when a worker signals completion. */
  workerCompleted: [repoName: string, workerName: string, summary: string];
  /** Emitted when a worker signals failure. */
  workerFailed: [repoName: string, workerName: string, error: string];
  /** Emitted when a worker's PR is merged. */
  workerMerged: [repoName: string, workerName: string, prUrl: string];
  /** Emitted when the agent starts. */
  started: [];
  /** Emitted when the agent stops. */
  stopped: [];
  /** Emitted when an error occurs. */
  error: [error: Error];
}

/** Events emitted by the Enrober agent. */
export interface EnroberEvents {
  /** Emitted when a PR is found needing review. */
  prNeedsReview: [prNumber: number, prUrl: string];
  /** Emitted when a PR is approved. */
  prApproved: [prNumber: number, prUrl: string];
  /** Emitted when a PR has changes requested. */
  prChangesRequested: [prNumber: number, prUrl: string];
  /** Emitted when a PR is blocked (stale review, no reviewers, etc.). */
  prBlocked: [prNumber: number, prUrl: string, reason: string];
  /** Emitted when the agent starts. */
  started: [];
  /** Emitted when the agent stops. */
  stopped: [];
}

// ---------------------------------------------------------------------------
// Reviewer types
// ---------------------------------------------------------------------------

/** Configuration for the Reviewer agent. */
export interface ReviewerConfig {
  /** Path to the git repository to review. */
  repoPath: string;
  /** The repository name (used for scoped agent naming). */
  repoName: string;
  /** Agent name for messaging. Derived from repoName if not set. */
  agentName?: string;
  /** Merge queue agent name to notify. Defaults to "temperer". */
  mergeQueueName?: string;
  /** Whether to auto-complete after review. Defaults to true. */
  autoComplete?: boolean;
}

/** A review comment posted by the Reviewer agent. */
export interface ReviewComment {
  /** File path the comment applies to. */
  file: string;
  /** Line number (optional). */
  line?: number;
  /** Comment body. */
  body: string;
  /** Whether this is a blocking issue. */
  blocking: boolean;
}

/** Result of a code review. */
export interface ReviewResult {
  /** PR number that was reviewed. */
  prNumber: number;
  /** Total number of comments posted. */
  totalComments: number;
  /** Number of blocking issues. */
  blockingCount: number;
  /** Number of non-blocking suggestions. */
  suggestionCount: number;
  /** Overall verdict. */
  verdict: "approve" | "request_changes" | "comment";
  /** Summary message. */
  summary: string;
}

/** Events emitted by the Reviewer agent. */
export interface ReviewerEvents {
  /** Emitted when a review starts. */
  reviewStarted: [prNumber: number];
  /** Emitted when a comment is posted. */
  commentPosted: [comment: ReviewComment];
  /** Emitted when a review completes. */
  reviewCompleted: [result: ReviewResult];
  /** Emitted when the agent encounters an error. */
  error: [error: Error];
}

// ---------------------------------------------------------------------------
// Workspace types
// ---------------------------------------------------------------------------

/** Configuration for a Workspace. */
export interface WorkspaceConfig {
  /** Unique name for the workspace. */
  name: string;
  /** Repository name this workspace is for. */
  repoName: string;
  /** Path to the git repository. */
  repoPath: string;
  /** Git branch for the workspace. Defaults to "workspace/<name>". */
  branch?: string;
  /** Path where the worktree will be created. */
  worktreePath: string;
  /** AI model to use. */
  model?: string;
}

/** State of a workspace. */
export interface WorkspaceState {
  /** Workspace name. */
  name: string;
  /** Repository name. */
  repoName: string;
  /** Current status. */
  status: "active" | "inactive" | "error";
  /** Git branch. */
  branch: string;
  /** Worktree path. */
  worktreePath: string;
  /** When the workspace was created. */
  createdAt: string;
  /** When the workspace was last accessed. */
  lastAccessedAt: string;
  /** Whether there are uncommitted changes. */
  hasUncommittedChanges?: boolean;
}
