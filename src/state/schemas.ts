/**
 * State schemas for CoCoPilot.
 *
 * Defines TypeScript interfaces for all persistent state:
 * - GlobalConfig: user-level settings (~/.cocopilot/config.json)
 * - DaemonState: runtime state (~/.cocopilot/state.json)
 * - RepoState: per-repository tracking
 * - WorkerState: per-worker tracking
 * - RepoConfig: in-repo .cocopilot/config.json
 */

import { DEFAULT_MODEL } from "../models.js";

// ---------------------------------------------------------------------------
// Enums / union types
// ---------------------------------------------------------------------------

export type AgentType = "supervisor" | "merge-queue" | "pr-shepherd" | "worker" | "reviewer" | "security";

export type AgentStatus =
  | "starting"
  | "healthy"
  | "working"
  | "stuck"
  | "stopped"
  | "crashed";

export type WorkerStatus =
  | "starting"
  | "working"
  | "paused"
  | "stuck"
  | "completed"
  | "failed"
  | "terminated"
  | "merged";

export type RepoMode = "single-player" | "multiplayer";

export type RepoStatus = "initializing" | "active" | "paused" | "error";

export type DaemonStatus = "running" | "stopping" | "stopped";

export type MessagePriority = "low" | "normal" | "high";

// ---------------------------------------------------------------------------
// Global configuration (~/.cocopilot/config.json)
// ---------------------------------------------------------------------------

export interface GitHubConfig {
  defaultBranch: string;
  prLabels: string[];
  requireCI: boolean;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
}

/**
 * BYOK (Bring Your Own Key) configuration for enterprise deployments.
 * Allows users to provide their own API keys for various AI providers.
 */
export interface ApiKeysConfig {
  /** OpenAI API key for GPT models. */
  openaiKey?: string;
  /** Anthropic API key for Claude models. */
  anthropicKey?: string;
  /** Azure OpenAI endpoint URL. */
  azureEndpoint?: string;
  /** Azure OpenAI API key. */
  azureKey?: string;
  /** Azure OpenAI deployment name. */
  azureDeployment?: string;
  /** Custom base URL for OpenAI-compatible APIs. */
  customBaseUrl?: string;
  /** Custom API key for customBaseUrl. */
  customApiKey?: string;
}

/**
 * Container resource limits configuration.
 */
export interface ContainerLimitsConfig {
  /** Memory limit (e.g., "4g", "512m"). */
  memory: string;
  /** CPU limit (e.g., "2", "0.5"). */
  cpu: string;
  /** Maximum PIDs in container. */
  pidsLimit?: number;
  /** Enable/disable network access. */
  networkEnabled?: boolean;
}

export interface GlobalConfig {
  model: string;
  webPort: number;
  maxWorkersPerRepo: number;
  workerTimeout: string;
  supervisorNudgeInterval: string;
  mergeQueuePollInterval: string;
  containerMemoryLimit: string;
  containerCpuLimit: string;
  workerRuntime: "container" | "local";
  autoMerge: boolean;
  theme: string;
  github: GitHubConfig;
  redis: RedisConfig;
  /** BYOK API keys for enterprise deployments. */
  apiKeys?: ApiKeysConfig;
  /** Container resource limits. */
  containerLimits?: ContainerLimitsConfig;
}

// ---------------------------------------------------------------------------
// Agent state (embedded in repo state)
// ---------------------------------------------------------------------------

export interface AgentState {
  name: string;
  type: AgentType;
  status: AgentStatus;
  containerId?: string;
  lastActivity: string; // ISO 8601
  startedAt: string; // ISO 8601
  error?: string;
}

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

export interface WorkerState {
  id: string; // UUID
  name: string; // Candy name (e.g. "Snickers")
  task: string;
  branch: string;
  status: WorkerStatus;
  containerId?: string;
  model?: string;
  prNumber?: number;
  prUrl?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  completedAt?: string; // ISO 8601
  error?: string;
}

// ---------------------------------------------------------------------------
// Repository state (tracked in daemon state)
// ---------------------------------------------------------------------------

export interface RepoState {
  id: string; // UUID
  name: string;
  url: string;
  localPath: string;
  mode: RepoMode;
  status: RepoStatus;
  defaultBranch: string;
  agents: Record<string, AgentState>;
  workers: Record<string, WorkerState>;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  lastMerge?: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Daemon state (~/.cocopilot/state.json)
// ---------------------------------------------------------------------------

export interface DaemonState {
  version: number; // Schema version for migrations
  status: DaemonStatus;
  pid?: number;
  startedAt?: string; // ISO 8601
  repositories: Record<string, RepoState>; // keyed by repo name
}

// ---------------------------------------------------------------------------
// In-repo configuration (.cocopilot/config.json)
// ---------------------------------------------------------------------------

export interface CustomAgentDef {
  name: string;
  prompt: string;
  triggers?: string[];
}

export interface McpServerConfig {
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
}

export interface UpstreamConfig {
  owner: string;
  repo: string;
  defaultBranch: string;
}

export interface RepoConfig {
  mode?: RepoMode;
  model?: string;
  maxWorkers?: number;
  autoMerge?: boolean;
  activeAgent?: string;
  upstream?: UpstreamConfig;
  customAgents?: CustomAgentDef[];
  mcpServers?: Record<string, McpServerConfig>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  model: DEFAULT_MODEL,
  webPort: 3000,
  maxWorkersPerRepo: 10,
  workerTimeout: "4h",
  supervisorNudgeInterval: "5m",
  mergeQueuePollInterval: "2m",
  containerMemoryLimit: "4g",
  containerCpuLimit: "2",
  workerRuntime: "local",
  autoMerge: true,
  theme: "dark-chocolate",
  github: {
    defaultBranch: "main",
    prLabels: ["cocopilot"],
    requireCI: true,
  },
  redis: {
    host: "localhost",
    port: 6379,
  },
};

export const CURRENT_STATE_VERSION = 1;

export const DEFAULT_DAEMON_STATE: DaemonState = {
  version: CURRENT_STATE_VERSION,
  status: "stopped",
  repositories: {},
};
