// Agent types in the CoCoPilot system
export type AgentType = "chocolatier" | "temperer" | "enrober" | "truffle";

// Agent health status
export type AgentStatus = "starting" | "healthy" | "stuck" | "stopped" | "failed";

// Worker status
export type WorkerStatus = "starting" | "working" | "complete" | "failed" | "stopped";

// Repository tracking mode
export type RepoMode = "single-player" | "multiplayer";

// Message priority levels
export type MessagePriority = "low" | "normal" | "high";

// Message types for inter-agent communication
export type MessageType =
  | "TASK_ASSIGNED"
  | "TASK_COMPLETE"
  | "TASK_FAILED"
  | "STATUS_REQUEST"
  | "STATUS_RESPONSE"
  | "NUDGE"
  | "PR_CREATED"
  | "PR_MERGED"
  | "CI_FAILED"
  | "SPAWN_FIXUP"
  | "BROADCAST";

// Inter-agent message
export interface CocoMessage {
  id: string;
  type: MessageType;
  from: string;
  to: string; // Agent name or "*" for broadcast
  payload: unknown;
  priority: MessagePriority;
  timestamp: number;
  ack_required: boolean;
  ack_received?: number;
}

// Container information tracked by the daemon
export interface ContainerInfo {
  id: string;
  name: string;
  agentType: AgentType;
  status: "running" | "stopped" | "failed";
  pid?: number;
  startedAt: string;
  stoppedAt?: string;
  repoName: string;
}

// Agent state tracked per repository
export interface AgentState {
  name: string;
  type: AgentType;
  status: AgentStatus;
  containerId?: string;
  lastActivity: string;
}

// Worker state (a specialized agent)
export interface WorkerState {
  id: string;
  name: string; // Candy name (Snickers, KitKat, etc.)
  task: string;
  branch: string;
  status: WorkerStatus;
  containerId?: string;
  prNumber?: number;
  prUrl?: string;
  createdAt: string;
  completedAt?: string;
}

// Per-repository state
export interface RepoState {
  id: string;
  name: string;
  url: string;
  localPath: string;
  mode: RepoMode;
  status: "initializing" | "active" | "error" | "stopped";
  agents: AgentState[];
  workers: WorkerState[];
  createdAt: string;
}

// Top-level daemon state persisted to state.json
export interface DaemonState {
  version: string;
  pid: number | null;
  startedAt: string | null;
  repositories: RepoState[];
  containers: ContainerInfo[];
}

// GitHub-related config
export interface GitHubConfig {
  defaultBranch: string;
  prLabels: string[];
  requireCI: boolean;
}

// Redis config
export interface RedisConfig {
  host: string;
  port: number;
}

// Global configuration from ~/.cocopilot/config.json
export interface CocoConfig {
  model: string;
  webPort: number;
  maxWorkersPerRepo: number;
  workerTimeout: string;
  supervisorNudgeInterval: string;
  mergeQueuePollInterval: string;
  containerMemoryLimit: string;
  containerCpuLimit: string;
  autoMerge: boolean;
  theme: string;
  github: GitHubConfig;
  redis: RedisConfig;
}

// Log levels
export type LogLevel = "debug" | "info" | "warn" | "error";
