/**
 * Types for the Truffle Inspector (worker detail) page.
 *
 * These types define data shapes specific to the worker detail view,
 * including worker metadata, container resources, Socket.IO events,
 * and git log entries.
 */

import type { WorkerStatus } from "../../state/index.js";

// ---------------------------------------------------------------------------
// Worker detail (API response shape)
// ---------------------------------------------------------------------------

/** Detailed worker information returned by the worker detail API endpoint. */
export interface WorkerDetail {
  id: string;
  name: string;
  task: string;
  branch: string;
  status: WorkerStatus;
  model?: string;
  containerId?: string;
  containerStatus?: string;
  prNumber?: number;
  prUrl?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  resources?: ContainerResources;
}

/** Container resource usage stats. */
export interface ContainerResources {
  memoryUsageMb: number;
  memoryLimitMb: number;
  cpuPercent: number;
}

// ---------------------------------------------------------------------------
// Socket.IO events (worker-specific)
// ---------------------------------------------------------------------------

/** Output event from a worker via Socket.IO. */
export interface WorkerOutputEvent {
  workerName: string;
  type: "output" | "tool_call" | "tool_result" | "error";
  content: string;
  timestamp: number;
}

/** Worker status change event via Socket.IO. */
export interface WorkerStatusEvent {
  workerName: string;
  status: string;
  timestamp: number;
  error?: string;
}

/** Worker completion event via Socket.IO. */
export interface WorkerCompletionEvent {
  workerName: string;
  summary: string;
  prUrl?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/** Minimal inter-agent message shape for the inspector. */
export interface AgentMessage {
  id: string;
  type: string;
  from: string;
  to: string;
  payload: unknown;
  priority: "low" | "normal" | "high";
  timestamp: number;
  ack_required: boolean;
  ack_received?: number;
}

// ---------------------------------------------------------------------------
// Git log
// ---------------------------------------------------------------------------

/** A single git commit entry. */
export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}
