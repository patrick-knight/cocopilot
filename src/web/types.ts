/**
 * Frontend types for the CoCoPilot Cocoa Board (Web UI).
 *
 * These types mirror backend state schemas and define Socket.IO event payloads
 * used by React components for real-time dashboard updates.
 */

import type {
  AgentState,
  AgentStatus,
  AgentType,
  WorkerState,
  WorkerStatus,
  RepoState,
  RepoStatus,
} from "../state/schemas.js";

// Re-export backend types used directly in components
export type {
  AgentState,
  AgentStatus,
  AgentType,
  WorkerState,
  WorkerStatus,
  RepoState,
  RepoStatus,
};

// ---------------------------------------------------------------------------
// PR Pipeline
// ---------------------------------------------------------------------------

/** Stages a PR progresses through in the merge pipeline. */
export type PRStage = "draft" | "ready" | "ci_running" | "ci_passed" | "ci_failed" | "merged";

/** A pull request tracked in the pipeline visualization. */
export interface PRPipelineEntry {
  number: number;
  title: string;
  url: string;
  branch: string;
  author: string;
  stage: PRStage;
  /** Worker name that created this PR (candy name). */
  workerName?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Agent output streaming
// ---------------------------------------------------------------------------

/** A single line of streaming output from an agent. */
export interface AgentOutputLine {
  /** Agent name (source). */
  agent: string;
  /** The text content. */
  text: string;
  /** Unix epoch ms. */
  timestamp: number;
  /** Stream type (stdout / stderr). */
  stream: "stdout" | "stderr";
}

// ---------------------------------------------------------------------------
// Message queue (for inspector)
// ---------------------------------------------------------------------------

/** Minimal message representation for the queue inspector. */
export interface MessageEntry {
  id: string;
  type: string;
  from: string;
  to: string;
  priority: "low" | "normal" | "high";
  timestamp: number;
  acked: boolean;
  payloadPreview: string;
}

// ---------------------------------------------------------------------------
// Socket.IO events
// ---------------------------------------------------------------------------

/** Events emitted from server → client. */
export interface ServerToClientEvents {
  /** Full repo state snapshot (sent on connection and periodically). */
  "repo:state": (state: RepoState) => void;
  /** Repo error (e.g., repo not found). */
  "repo:error": (data: { repoName: string; message: string }) => void;
  /** Individual agent state update. */
  "agent:update": (agent: AgentState) => void;
  /** Individual worker state update. */
  "worker:update": (worker: WorkerState) => void;
  /** Worker removed. */
  "worker:removed": (workerName: string) => void;
  /** Streaming output line from an agent. */
  "agent:output": (line: AgentOutputLine) => void;
  /** PR pipeline update. */
  "pr:update": (pr: PRPipelineEntry) => void;
  /** New message in the queue. */
  "message:new": (message: MessageEntry) => void;
  /** Message acknowledged. */
  "message:ack": (messageId: string) => void;
}

/** Events emitted from client → server. */
export interface ClientToServerEvents {
  /** Subscribe to a repository's updates. */
  "repo:subscribe": (repoName: string) => void;
  /** Unsubscribe from a repository's updates. */
  "repo:unsubscribe": (repoName: string) => void;
  /** Subscribe to an agent's output stream. */
  "agent:stream:subscribe": (agentName: string) => void;
  /** Unsubscribe from an agent's output stream. */
  "agent:stream:unsubscribe": (agentName: string) => void;
  /** Spawn a new worker. */
  "worker:spawn": (options: SpawnWorkerRequest) => void;
  /** Stop a worker. */
  "worker:stop": (workerName: string) => void;
}

/** Request payload for spawning a new worker from the UI. */
export interface SpawnWorkerRequest {
  repoName: string;
  task: string;
  branch?: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// Component prop helpers
// ---------------------------------------------------------------------------

/** Display metadata for agent types. */
export interface AgentDisplayInfo {
  label: string;
  icon: string;
  description: string;
  color: string;
}

/** Map agent types to their display info (cocoa theme). */
export const AGENT_DISPLAY: Record<AgentType, AgentDisplayInfo> = {
  supervisor: {
    label: "Chocolatier",
    icon: "🍫",
    description: "Supervisor — coordinates all agents",
    color: "text-amber-800",
  },
  "merge-queue": {
    label: "Temperer",
    icon: "⚙️",
    description: "Merge queue — monitors and merges PRs",
    color: "text-orange-700",
  },
  "pr-shepherd": {
    label: "Enrober",
    icon: "🧤",
    description: "PR shepherd — coordinates reviews",
    color: "text-yellow-700",
  },
  worker: {
    label: "Truffle",
    icon: "🫘",
    description: "Worker — executes a single task",
    color: "text-stone-700",
  },
  security: {
    label: "Security Reviewer",
    icon: "🔒",
    description: "Security — reviews PRs for vulnerabilities",
    color: "text-red-700",
  },
};

/** Map agent/worker status to a status indicator color. */
export const STATUS_COLORS: Record<string, string> = {
  starting: "bg-blue-400",
  healthy: "bg-green-500",
  working: "bg-green-500",
  stuck: "bg-yellow-500",
  stopped: "bg-gray-400",
  crashed: "bg-red-500",
  completed: "bg-green-600",
  failed: "bg-red-500",
  terminated: "bg-gray-500",
};

/** Map PR stages to display properties. */
export const PR_STAGE_DISPLAY: Record<PRStage, { label: string; color: string; progress: number }> = {
  draft: { label: "Draft", color: "bg-gray-400", progress: 15 },
  ready: { label: "Ready", color: "bg-blue-500", progress: 35 },
  ci_running: { label: "CI Running", color: "bg-yellow-500", progress: 60 },
  ci_passed: { label: "CI Passed", color: "bg-green-500", progress: 85 },
  ci_failed: { label: "CI Failed", color: "bg-red-500", progress: 60 },
  merged: { label: "Merged", color: "bg-green-600", progress: 100 },
};
