/**
 * Docker Container Orchestration Types
 *
 * Type definitions for CoCoPilot's Docker container management.
 * Containers are the "Truffle Boxes" that isolate each agent's execution.
 */

/** The types of containers CoCoPilot manages. */
export enum ContainerType {
  /** Supervisor agent - one per repo. */
  CHOCOLATIER = "chocolatier",
  /** Merge queue agent - one per repo (single-player mode). */
  TEMPERER = "temperer",
  /** PR shepherd agent - one per repo (multiplayer mode). */
  ENROBER = "enrober",
  /** Worker agent - N per repo, dynamically spawned. */
  TRUFFLE = "truffle",
  /** Web UI server - one global. */
  COCOA_BOARD = "cocoa-board",
  /** Redis message broker - one global. */
  GANACHE = "ganache",
}

/** Container name prefix used for all CoCoPilot containers. */
export const CONTAINER_NAME_PREFIX = "cocopilot";

/** Build the container name for a given type and optional worker name. */
export function containerName(type: ContainerType, name?: string): string {
  if (type === ContainerType.TRUFFLE && name) {
    return `${CONTAINER_NAME_PREFIX}-${ContainerType.TRUFFLE}-${name}`;
  }
  return `${CONTAINER_NAME_PREFIX}-${type}`;
}

/** Volume mount configuration for a container. */
export interface VolumeMount {
  /** Absolute path on the host machine. */
  hostPath: string;
  /** Path inside the container. */
  containerPath: string;
  /** Whether the mount is read-only. */
  readOnly?: boolean;
}

/** Resource limits for a container. */
export interface ResourceLimits {
  /** Memory limit (e.g., "4g", "512m"). */
  memory?: string;
  /** Number of CPU cores (e.g., "2", "0.5"). */
  cpus?: string;
}

/** Environment variable key-value pair. */
export type EnvVars = Record<string, string>;

/** Configuration for spawning a new container. */
export interface ContainerConfig {
  /** The container type. */
  type: ContainerType;
  /** The Docker image to use. */
  image: string;
  /** Worker name (required for TRUFFLE type). */
  name?: string;
  /** Volume mounts for worktrees and message directories. */
  volumes?: VolumeMount[];
  /** Resource limits. */
  resources?: ResourceLimits;
  /** Environment variables to set in the container. */
  env?: EnvVars;
  /** Command to run (overrides Dockerfile ENTRYPOINT). */
  cmd?: string[];
  /** Network to attach the container to. */
  networkName?: string;
  /** Labels to apply to the container. */
  labels?: Record<string, string>;
  /** Whether to auto-remove the container when it exits. */
  autoRemove?: boolean;
}

/** Runtime status of a container. */
export enum ContainerStatus {
  CREATING = "creating",
  RUNNING = "running",
  PAUSED = "paused",
  RESTARTING = "restarting",
  EXITED = "exited",
  DEAD = "dead",
  REMOVING = "removing",
  UNKNOWN = "unknown",
}

/** Information about a running or stopped container. */
export interface ContainerInfo {
  /** Docker container ID. */
  id: string;
  /** Container name (without leading slash). */
  name: string;
  /** The CoCoPilot container type. */
  type: ContainerType;
  /** Worker name (for TRUFFLE containers). */
  workerName?: string;
  /** Current status. */
  status: ContainerStatus;
  /** Docker image used. */
  image: string;
  /** When the container was created (ISO 8601). */
  createdAt: string;
  /** Labels applied to the container. */
  labels: Record<string, string>;
}

/** Default resource limits matching PRD configuration. */
export const DEFAULT_RESOURCE_LIMITS: Required<ResourceLimits> = {
  memory: "4g",
  cpus: "2",
};

/** Default Docker image for agent containers. */
export const DEFAULT_AGENT_IMAGE = "cocopilot-agent:latest";

/** Default Docker image for the Redis/Ganache container. */
export const DEFAULT_GANACHE_IMAGE = "redis:7.4.6-alpine";

/** Label keys used on CoCoPilot containers. */
export const LABELS = {
  /** Identifies a container as managed by CoCoPilot. */
  MANAGED_BY: "cocopilot.managed",
  /** The container type (chocolatier, temperer, truffle, etc.). */
  CONTAINER_TYPE: "cocopilot.type",
  /** The worker name (for truffle containers). */
  WORKER_NAME: "cocopilot.worker-name",
  /** The repository this container is associated with. */
  REPOSITORY: "cocopilot.repository",
} as const;
