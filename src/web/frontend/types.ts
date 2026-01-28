/**
 * Frontend types for the CoCoPilot Cocoa Board (Web Dashboard).
 *
 * These types define the data shapes used by React components,
 * Socket.IO event payloads, and API responses.
 */

// ---------------------------------------------------------------------------
// Repository summary (displayed on Factory Floor)
// ---------------------------------------------------------------------------

/** Health status for a repository (determines indicator color). */
export type RepoHealth = "healthy" | "warning" | "error";

/** Summary of a repository displayed on the Factory Floor. */
export interface RepositorySummary {
  id: string;
  name: string;
  url: string;
  health: RepoHealth;
  status: "initializing" | "active" | "paused" | "error";
  activeWorkerCount: number;
  stuckWorkerCount: number;
  pendingPRs: number;
  lastMerge: string | null; // ISO 8601 or null
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

/** Event types shown in the activity feed. */
export type ActivityEventType =
  | "worker_spawned"
  | "worker_completed"
  | "worker_failed"
  | "pr_created"
  | "pr_merged"
  | "ci_failed"
  | "repo_initialized"
  | "nudge_sent";

/** A single event in the activity feed. */
export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  repository: string;
  description: string;
  timestamp: string; // ISO 8601
  agent?: string;
  prNumber?: number;
  workerName?: string;
}

// ---------------------------------------------------------------------------
// Socket.IO event contracts
// ---------------------------------------------------------------------------

/** Socket.IO events emitted by the server to the dashboard. */
export interface ServerToClientEvents {
  "repo:updated": (repo: RepositorySummary) => void;
  "repo:added": (repo: RepositorySummary) => void;
  "repo:removed": (repoId: string) => void;
  "activity:new": (event: ActivityEvent) => void;
  "system:status": (status: SystemStatus) => void;
}

/** Socket.IO events emitted by the dashboard to the server. */
export interface ClientToServerEvents {
  "repo:init": (
    data: { url: string; name?: string },
    callback: (result: {
      success: boolean;
      error?: string;
      repo?: RepositorySummary;
    }) => void,
  ) => void;
  "worker:spawn": (
    data: { repoId: string; task: string; branch?: string },
    callback: (result: {
      success: boolean;
      error?: string;
      workerName?: string;
    }) => void,
  ) => void;
}

// ---------------------------------------------------------------------------
// System status
// ---------------------------------------------------------------------------

/** Overall system status displayed in the dashboard header. */
export interface SystemStatus {
  daemonRunning: boolean;
  uptime: number | null; // seconds
  totalContainers: number;
  memoryUsage?: string;
  cpuUsage?: string;
}
