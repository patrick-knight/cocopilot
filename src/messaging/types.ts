/**
 * CoCoPilot Inter-Agent Messaging Types
 *
 * Defines the message schema and types for communication between
 * CoCoPilot agents via the Ganache Bus (Redis pub/sub + file persistence).
 */

/** All supported message types for inter-agent communication. */
export enum MessageType {
  /** Chocolatier assigns a task to a Truffle worker. */
  TASK_ASSIGNED = "TASK_ASSIGNED",
  /** Truffle signals successful task completion. */
  TASK_COMPLETE = "TASK_COMPLETE",
  /** Truffle reports a task failure with error details. */
  TASK_FAILED = "TASK_FAILED",
  /** Any agent requests status from another agent. */
  STATUS_REQUEST = "STATUS_REQUEST",
  /** Response to a status request. */
  STATUS_RESPONSE = "STATUS_RESPONSE",
  /** Chocolatier sends a helpful hint to a stuck Truffle. */
  NUDGE = "NUDGE",
  /** Truffle notifies Temperer of a new pull request. */
  PR_CREATED = "PR_CREATED",
  /** Temperer notifies Chocolatier of a successful merge. */
  PR_MERGED = "PR_MERGED",
  /** Temperer notifies Chocolatier of a CI failure. */
  CI_FAILED = "CI_FAILED",
  /** Temperer requests Chocolatier to spawn a fixup worker. */
  SPAWN_FIXUP = "SPAWN_FIXUP",
  /** System-wide announcement to all agents. */
  BROADCAST = "BROADCAST",
  /** Reviewer signals completion of a code review. */
  REVIEW_COMPLETE = "REVIEW_COMPLETE",
  /** API requests Chocolatier to spawn a new worker. */
  SPAWN_WORKER = "SPAWN_WORKER",
  /** Truffle/Temperer requests security review from Security Reviewer. */
  SECURITY_REVIEW_REQUEST = "SECURITY_REVIEW_REQUEST",
  /** Security Reviewer approves PR (may include warnings). */
  SECURITY_REVIEW_PASSED = "SECURITY_REVIEW_PASSED",
  /** Security Reviewer blocks PR due to security issues. */
  SECURITY_REVIEW_FAILED = "SECURITY_REVIEW_FAILED",
  /** Worker broadcasts real-time activity (commits, status changes, etc.). */
  WORKER_ACTIVITY = "WORKER_ACTIVITY",
}

/** Message priority levels. */
export type MessagePriority = "low" | "normal" | "high";

// --- Payload types for each message type ---

export interface TaskAssignedPayload {
  task: string;
  branch: string;
  model?: string;
  priority?: MessagePriority;
}

export interface TaskCompletePayload {
  summary: string;
  pr_url?: string;
  files_changed?: number;
  commits?: number;
}

export interface TaskFailedPayload {
  error: string;
  task: string;
  recoverable: boolean;
}

export interface StatusRequestPayload {
  request_id: string;
}

export interface StatusResponsePayload {
  request_id: string;
  status: string;
  current_action?: string;
  progress?: number;
}

export interface NudgePayload {
  hint: string;
  context?: string;
}

export interface PRCreatedPayload {
  pr_number: number;
  pr_url: string;
  title: string;
  branch: string;
}

export interface PRMergedPayload {
  pr_number: number;
  pr_url: string;
  merge_sha: string;
}

export interface CIFailedPayload {
  pr_number: number;
  pr_url: string;
  failure_summary: string;
  workflow_url?: string;
}

export interface SpawnFixupPayload {
  pr_number: number;
  pr_url: string;
  failure_summary: string;
  original_worker: string;
}

export interface BroadcastPayload {
  message: string;
  level?: "info" | "warning" | "error";
}

export interface ReviewCompletePayload {
  pr_number: number;
  blocking_count: number;
  suggestion_count: number;
  verdict: "approve" | "request_changes" | "comment";
  summary: string;
}

export interface SpawnWorkerPayload {
  task: string;
  repoName?: string;
  branch?: string;
  name?: string;
  model?: string;
  priority?: "low" | "normal" | "high";
  pushTo?: string;
}

export interface SecurityReviewRequestPayload {
  prNumber: number;
  prUrl: string;
  branch: string;
  workerName: string;
}

export interface SecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  file: string;
  line?: number;
  description: string;
  cwe?: string;
}

export interface SecurityReviewPassedPayload {
  prNumber: number;
  warnings: string[];
}

export interface SecurityReviewFailedPayload {
  prNumber: number;
  issues: SecurityIssue[];
}

/** Worker activity types for real-time updates. */
export type WorkerActivityType = "commit" | "status_change" | "pr_created" | "push" | "started" | "completed";

export interface WorkerActivityPayload {
  activityType: WorkerActivityType;
  workerName: string;
  repoName: string;
  branch: string;
  /** For commit activity */
  commitHash?: string;
  commitMessage?: string;
  filesChanged?: number;
  /** For status_change activity */
  status?: string;
  previousStatus?: string;
  progress?: number;
  /** For pr_created activity */
  prNumber?: number;
  prUrl?: string;
  prTitle?: string;
  /** Human-readable description */
  description: string;
}

/** Maps each MessageType to its corresponding payload type. */
export interface MessagePayloadMap {
  [MessageType.TASK_ASSIGNED]: TaskAssignedPayload;
  [MessageType.TASK_COMPLETE]: TaskCompletePayload;
  [MessageType.TASK_FAILED]: TaskFailedPayload;
  [MessageType.STATUS_REQUEST]: StatusRequestPayload;
  [MessageType.STATUS_RESPONSE]: StatusResponsePayload;
  [MessageType.NUDGE]: NudgePayload;
  [MessageType.PR_CREATED]: PRCreatedPayload;
  [MessageType.PR_MERGED]: PRMergedPayload;
  [MessageType.CI_FAILED]: CIFailedPayload;
  [MessageType.SPAWN_FIXUP]: SpawnFixupPayload;
  [MessageType.BROADCAST]: BroadcastPayload;
  [MessageType.REVIEW_COMPLETE]: ReviewCompletePayload;
  [MessageType.SPAWN_WORKER]: SpawnWorkerPayload;
  [MessageType.SECURITY_REVIEW_REQUEST]: SecurityReviewRequestPayload;
  [MessageType.SECURITY_REVIEW_PASSED]: SecurityReviewPassedPayload;
  [MessageType.SECURITY_REVIEW_FAILED]: SecurityReviewFailedPayload;
  [MessageType.WORKER_ACTIVITY]: WorkerActivityPayload;
}

/** The core message structure for all inter-agent communication. */
export interface CocoMessage<T extends MessageType = MessageType> {
  id: string;
  type: T;
  from: string;
  to: string; // Agent name or "*" for broadcast
  payload: MessagePayloadMap[T];
  priority: MessagePriority;
  timestamp: number; // Unix epoch ms
  ack_required: boolean;
  ack_received?: number; // Unix epoch ms when acknowledged
}

/** Options for creating a new message. */
export interface CreateMessageOptions<T extends MessageType> {
  type: T;
  from: string;
  to: string;
  payload: MessagePayloadMap[T];
  priority?: MessagePriority;
  ack_required?: boolean;
}

/** Callback for message subscription handlers. */
export type MessageHandler = (message: CocoMessage) => void | Promise<void>;

/** Redis channel naming convention for CoCoPilot. */
export const CHANNEL_PREFIX = "cocopilot:messages";

/** Build the Redis channel name for a specific agent. */
export function agentChannel(agentName: string): string {
  return `${CHANNEL_PREFIX}:${agentName}`;
}

/** The broadcast channel for system-wide messages. */
export const BROADCAST_CHANNEL = `${CHANNEL_PREFIX}:*`;

/** Redis channel for completion notifications. */
export const COMPLETIONS_CHANNEL = "cocopilot:completions";

/** Redis channel prefix for streaming agent output to the dashboard. */
export const STREAM_CHANNEL_PREFIX = "cocopilot:stream";

/** Build the Redis stream channel for a specific agent. */
export function streamChannel(agentName: string): string {
  return `${STREAM_CHANNEL_PREFIX}:${agentName}`;
}
