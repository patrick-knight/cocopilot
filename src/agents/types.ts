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
  /** Emitted when the agent starts. */
  started: [];
  /** Emitted when the agent stops. */
  stopped: [];
}
