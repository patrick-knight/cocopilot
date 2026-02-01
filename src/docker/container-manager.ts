/**
 * Docker Container Manager
 *
 * Manages the lifecycle of CoCoPilot Docker containers using dockerode.
 * The Concher daemon uses this module to spawn, stop, and monitor
 * agent containers (Truffles, Chocolatier, Temperer, etc.).
 */

import Docker from "dockerode";
import {
  ContainerConfig,
  ContainerInfo,
  ContainerStats,
  ContainerStatus,
  ContainerType,
  DEFAULT_RESOURCE_LIMITS,
  LABELS,
  VolumeMount,
  containerName,
} from "./types.js";

/** Options for retrieving container logs. */
export interface LogOptions {
  /** Return logs from stdout. Defaults to true. */
  stdout?: boolean;
  /** Return logs from stderr. Defaults to true. */
  stderr?: boolean;
  /** Number of lines from the end to return. */
  tail?: number;
  /** Return logs since this timestamp (Unix epoch seconds). */
  since?: number;
  /** Include timestamps in log output. */
  timestamps?: boolean;
}

/** Parsed memory string to bytes. Supports 'g', 'm', 'k' suffixes. */
function parseMemory(mem: string): number {
  const match = mem.match(/^(\d+(?:\.\d+)?)\s*(g|m|k)?b?$/i);
  if (!match) {
    throw new Error(`Invalid memory format: "${mem}". Use e.g. "4g", "512m".`);
  }
  const value = parseFloat(match[1]);
  const unit = (match[2] || "b").toLowerCase();
  switch (unit) {
    case "g":
      return value * 1024 * 1024 * 1024;
    case "m":
      return value * 1024 * 1024;
    case "k":
      return value * 1024;
    default:
      return value;
  }
}

/** Parse CPU string to Docker's NanoCpus value. */
function parseCpus(cpus: string): number {
  const value = parseFloat(cpus);
  if (isNaN(value) || value <= 0) {
    throw new Error(`Invalid CPU value: "${cpus}". Use e.g. "2", "0.5".`);
  }
  return value * 1e9;
}

/** Map Docker's state string to our ContainerStatus enum. */
function mapDockerStatus(state: string): ContainerStatus {
  const lower = state.toLowerCase();
  switch (lower) {
    case "created":
      return ContainerStatus.CREATING;
    case "running":
      return ContainerStatus.RUNNING;
    case "paused":
      return ContainerStatus.PAUSED;
    case "restarting":
      return ContainerStatus.RESTARTING;
    case "exited":
    case "stopped":
      return ContainerStatus.EXITED;
    case "dead":
      return ContainerStatus.DEAD;
    case "removing":
      return ContainerStatus.REMOVING;
    default:
      return ContainerStatus.UNKNOWN;
  }
}

/** Extract the CoCoPilot container type from labels. */
function typeFromLabels(labels: Record<string, string>): ContainerType | null {
  const typeLabel = labels[LABELS.CONTAINER_TYPE];
  if (!typeLabel) return null;
  const values = Object.values(ContainerType) as string[];
  return values.includes(typeLabel) ? (typeLabel as ContainerType) : null;
}

/**
 * ContainerManager orchestrates Docker container lifecycle for CoCoPilot.
 *
 * Usage:
 * ```ts
 * const manager = new ContainerManager();
 * const info = await manager.spawn({
 *   type: ContainerType.TRUFFLE,
 *   image: "cocopilot-agent:latest",
 *   name: "Snickers",
 *   volumes: [
 *     { hostPath: "/path/to/worktree", containerPath: "/workspace" },
 *     { hostPath: "/path/to/messages", containerPath: "/messages" },
 *   ],
 * });
 * ```
 */
export class ContainerManager {
  private readonly docker: Docker;

  constructor(dockerOptions?: Docker.DockerOptions) {
    this.docker = new Docker(dockerOptions);
  }

  /**
   * Spawn a new container with the given configuration.
   * Returns info about the created and started container.
   */
  async spawn(config: ContainerConfig): Promise<ContainerInfo> {
    if (config.type === ContainerType.TRUFFLE && !config.name) {
      throw new Error("Truffle containers require a worker name.");
    }

    const name = containerName(config.type, config.name);
    const labels = this.buildLabels(config);
    const binds = this.buildBinds(config.volumes);
    const env = this.buildEnv(config.env);
    const hostConfig = this.buildHostConfig(config, binds);

    const createOptions: Docker.ContainerCreateOptions = {
      Image: config.image,
      name,
      Labels: labels,
      Env: env,
      HostConfig: hostConfig,
    };

    if (config.cmd) {
      createOptions.Cmd = config.cmd;
    }

    if (config.networkName) {
      createOptions.NetworkingConfig = {
        EndpointsConfig: {
          [config.networkName]: {},
        },
      };
    }

    const container = await this.docker.createContainer(createOptions);
    await container.start();

    return this.inspect(container.id);
  }

  /** Stop a container by ID or name. */
  async stop(idOrName: string, timeoutSeconds: number = 10): Promise<void> {
    const container = this.docker.getContainer(idOrName);
    await container.stop({ t: timeoutSeconds });
  }

  /** Remove a container by ID or name. Force-removes if running. */
  async remove(idOrName: string, force: boolean = false): Promise<void> {
    const container = this.docker.getContainer(idOrName);
    await container.remove({ force });
  }

  /** Stop and remove a container. */
  async destroy(
    idOrName: string,
    timeoutSeconds: number = 10,
  ): Promise<void> {
    const container = this.docker.getContainer(idOrName);
    try {
      await container.stop({ t: timeoutSeconds });
    } catch (err: unknown) {
      const isNotRunning =
        err instanceof Error && err.message.includes("is not running");
      if (!isNotRunning) throw err;
    }
    await container.remove({ force: true });
  }

  /** List all CoCoPilot-managed containers. */
  async list(
    filters?: { type?: ContainerType; status?: ContainerStatus[] },
  ): Promise<ContainerInfo[]> {
    const labelFilters = [`${LABELS.MANAGED_BY}=true`];

    if (filters?.type) {
      labelFilters.push(`${LABELS.CONTAINER_TYPE}=${filters.type}`);
    }

    const statusMap: Record<string, string> = {
      [ContainerStatus.CREATING]: "created",
      [ContainerStatus.RUNNING]: "running",
      [ContainerStatus.PAUSED]: "paused",
      [ContainerStatus.RESTARTING]: "restarting",
      [ContainerStatus.EXITED]: "exited",
      [ContainerStatus.DEAD]: "dead",
      [ContainerStatus.REMOVING]: "removing",
    };

    const statusFilters: string[] = [];
    if (filters?.status) {
      for (const s of filters.status) {
        const mapped = statusMap[s];
        if (mapped) statusFilters.push(mapped);
      }
    }

    const listFilters: Record<string, string[]> = {
      label: labelFilters,
    };

    if (statusFilters.length > 0) {
      listFilters.status = statusFilters;
    }

    const containers = await this.docker.listContainers({
      all: true,
      filters: listFilters,
    });

    return containers.map((c) => this.containerInfoFromList(c));
  }

  /** Get detailed info about a specific container. */
  async inspect(idOrName: string): Promise<ContainerInfo> {
    const container = this.docker.getContainer(idOrName);
    const data = await container.inspect();

    const labels = data.Config?.Labels ?? {};
    const type = typeFromLabels(labels);

    return {
      id: data.Id,
      name: (data.Name ?? "").replace(/^\//, ""),
      type: type ?? ContainerType.TRUFFLE,
      workerName: labels[LABELS.WORKER_NAME],
      status: mapDockerStatus(data.State?.Status ?? "unknown"),
      image: data.Config?.Image ?? "",
      createdAt: data.Created ?? new Date().toISOString(),
      labels,
    };
  }

  /**
   * Get logs from a container.
   * Returns the log output as a string.
   */
  async logs(idOrName: string, options?: LogOptions): Promise<string> {
    const container = this.docker.getContainer(idOrName);

    const logStream = await container.logs({
      stdout: options?.stdout ?? true,
      stderr: options?.stderr ?? true,
      tail: options?.tail,
      since: options?.since,
      timestamps: options?.timestamps ?? false,
      follow: false,
    });

    // dockerode returns a Buffer or string depending on the TTY setting
    if (typeof logStream === "string") {
      return logStream;
    }
    return (logStream as Buffer).toString("utf-8");
  }

  /** Check if Docker daemon is reachable. */
  async ping(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get resource usage statistics for a container.
   * Returns CPU and memory usage.
   */
  async stats(idOrName: string): Promise<ContainerStats> {
    const container = this.docker.getContainer(idOrName);
    const statsData = await container.stats({ stream: false });

    // Calculate memory usage
    const memoryUsage = statsData.memory_stats?.usage ?? 0;
    const memoryLimit = statsData.memory_stats?.limit ?? 1;

    // Calculate CPU percentage
    // Docker stats provides cumulative CPU usage, so we need to compute the delta
    const cpuDelta =
      (statsData.cpu_stats?.cpu_usage?.total_usage ?? 0) -
      (statsData.precpu_stats?.cpu_usage?.total_usage ?? 0);
    const systemDelta =
      (statsData.cpu_stats?.system_cpu_usage ?? 0) -
      (statsData.precpu_stats?.system_cpu_usage ?? 0);
    const numCpus = statsData.cpu_stats?.online_cpus ?? 1;

    let cpuPercent = 0;
    if (systemDelta > 0 && cpuDelta > 0) {
      cpuPercent = (cpuDelta / systemDelta) * numCpus * 100;
    }

    return {
      memoryUsage,
      memoryLimit,
      cpuPercent,
    };
  }

  /** Get Docker daemon info. */
  async info(): Promise<object> {
    return this.docker.info();
  }

  // --- Private helpers ---

  private buildLabels(config: ContainerConfig): Record<string, string> {
    const labels: Record<string, string> = {
      [LABELS.MANAGED_BY]: "true",
      [LABELS.CONTAINER_TYPE]: config.type,
      ...config.labels,
    };

    if (config.name) {
      labels[LABELS.WORKER_NAME] = config.name;
    }

    return labels;
  }

  private buildBinds(volumes?: VolumeMount[]): string[] {
    if (!volumes || volumes.length === 0) return [];
    return volumes.map((v) => {
      const mode = v.readOnly ? "ro" : "rw";
      return `${v.hostPath}:${v.containerPath}:${mode}`;
    });
  }

  private buildEnv(env?: Record<string, string>): string[] {
    if (!env) return [];
    return Object.entries(env).map(([k, v]) => `${k}=${v}`);
  }

  private buildHostConfig(
    config: ContainerConfig,
    binds: string[],
  ): Docker.HostConfig {
    const memory = config.resources?.memory ?? DEFAULT_RESOURCE_LIMITS.memory;
    const cpus = config.resources?.cpus ?? DEFAULT_RESOURCE_LIMITS.cpus;

    const hostConfig: Docker.HostConfig = {
      Binds: binds.length > 0 ? binds : undefined,
      Memory: parseMemory(memory),
      NanoCpus: parseCpus(cpus),
      AutoRemove: config.autoRemove ?? false,
    };

    return hostConfig;
  }

  private containerInfoFromList(
    c: Docker.ContainerInfo,
  ): ContainerInfo {
    const labels = c.Labels ?? {};
    const type = typeFromLabels(labels);
    const names = c.Names ?? [];
    const name = names.length > 0 ? names[0].replace(/^\//, "") : "";

    return {
      id: c.Id,
      name,
      type: type ?? ContainerType.TRUFFLE,
      workerName: labels[LABELS.WORKER_NAME],
      status: mapDockerStatus(c.State ?? "unknown"),
      image: c.Image ?? "",
      createdAt: c.Created
        ? new Date(c.Created * 1000).toISOString()
        : new Date().toISOString(),
      labels,
    };
  }
}
