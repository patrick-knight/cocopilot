import { spawn, execSync, type ChildProcess } from "node:child_process";
import * as crypto from "node:crypto";
import type { AgentType, ContainerInfo, CocoConfig } from "../types/index.js";
import { logger } from "./logger.js";
import type { StateManager } from "./state.js";

// Container name prefix
const CONTAINER_PREFIX = "cocopilot";

interface SpawnContainerOpts {
  agentType: AgentType;
  repoName: string;
  workerName?: string; // For truffles
  workspacePath: string; // Host path to the worktree
  messagesPath: string; // Host path to the messages directory
  env?: Record<string, string>;
}

export class ContainerManager {
  private config: CocoConfig;
  private stateManager: StateManager;
  private processes: Map<string, ChildProcess> = new Map();

  constructor(config: CocoConfig, stateManager: StateManager) {
    this.config = config;
    this.stateManager = stateManager;
  }

  /**
   * Build the container name from agent type and optional worker name.
   */
  private containerName(agentType: AgentType, workerName?: string): string {
    if (agentType === "truffle" && workerName) {
      return `${CONTAINER_PREFIX}-truffle-${workerName.toLowerCase()}`;
    }
    return `${CONTAINER_PREFIX}-${agentType}`;
  }

  /**
   * Spawn a Docker container for an agent using child_process.
   */
  async spawnContainer(opts: SpawnContainerOpts): Promise<ContainerInfo> {
    const name = this.containerName(opts.agentType, opts.workerName);
    const containerId = crypto.randomUUID();

    const args = [
      "run",
      "--detach",
      "--name", name,
      "--memory", this.config.containerMemoryLimit,
      "--cpus", this.config.containerCpuLimit,
      "--restart", "unless-stopped",
      "-v", `${opts.workspacePath}:/workspace`,
      "-v", `${opts.messagesPath}:/messages`,
      "--label", `cocopilot.agent-type=${opts.agentType}`,
      "--label", `cocopilot.repo=${opts.repoName}`,
    ];

    // Add environment variables
    const env: Record<string, string> = {
      COCOPILOT_AGENT_TYPE: opts.agentType,
      COCOPILOT_REPO: opts.repoName,
      COCOPILOT_MODEL: this.config.model,
      ...opts.env,
    };

    if (opts.workerName) {
      env.COCOPILOT_WORKER_NAME = opts.workerName;
    }

    for (const [key, val] of Object.entries(env)) {
      args.push("-e", `${key}=${val}`);
    }

    // Use the agent image
    const image = `${CONTAINER_PREFIX}-agent:latest`;
    args.push(image);

    logger.info(`Spawning container: ${name}`, { agentType: opts.agentType, repoName: opts.repoName });

    return new Promise<ContainerInfo>((resolve, reject) => {
      const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", (err) => {
        logger.error(`Failed to spawn container ${name}`, err);
        reject(new Error(`Failed to spawn container: ${err.message}`));
      });

      child.on("close", (code) => {
        if (code !== 0) {
          logger.error(`Docker run failed for ${name}`, { code, stderr });
          reject(new Error(`docker run exited with code ${code}: ${stderr}`));
          return;
        }

        const dockerId = stdout.trim().substring(0, 12);
        const container: ContainerInfo = {
          id: containerId,
          name,
          agentType: opts.agentType,
          status: "running",
          startedAt: new Date().toISOString(),
          repoName: opts.repoName,
        };

        this.stateManager.addContainer(container);
        logger.info(`Container started: ${name} (${dockerId})`);
        resolve(container);
      });
    });
  }

  /**
   * Stop a running container.
   */
  async stopContainer(name: string): Promise<void> {
    logger.info(`Stopping container: ${name}`);

    return new Promise<void>((resolve, reject) => {
      const child = spawn("docker", ["stop", "--time", "30", name], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.on("error", (err) => {
        logger.warn(`Error stopping container ${name}`, err);
        resolve(); // Don't reject - container may already be stopped
      });

      child.on("close", (code) => {
        if (code !== 0) {
          logger.warn(`docker stop exited with code ${code} for ${name}`);
        } else {
          logger.info(`Container stopped: ${name}`);
        }

        // Update state
        const containers = this.stateManager.getRunningContainers();
        const container = containers.find((c) => c.name === name);
        if (container) {
          this.stateManager.updateContainer(container.id, {
            status: "stopped",
            stoppedAt: new Date().toISOString(),
          });
        }
        resolve();
      });
    });
  }

  /**
   * Remove a stopped container.
   */
  async removeContainer(name: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const child = spawn("docker", ["rm", "-f", name], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.on("close", () => {
        const containers = this.stateManager.getState().containers;
        const container = containers.find((c) => c.name === name);
        if (container) {
          this.stateManager.removeContainer(container.id);
        }
        resolve();
      });

      child.on("error", () => resolve());
    });
  }

  /**
   * Stop all running containers for a given repository.
   */
  async stopAllForRepo(repoName: string): Promise<void> {
    const containers = this.stateManager
      .getRunningContainers()
      .filter((c) => c.repoName === repoName);

    await Promise.all(containers.map((c) => this.stopContainer(c.name)));
  }

  /**
   * Stop all running CoCoPilot containers.
   */
  async stopAll(): Promise<void> {
    const running = this.stateManager.getRunningContainers();
    logger.info(`Stopping ${running.length} container(s)...`);
    await Promise.all(running.map((c) => this.stopContainer(c.name)));
  }

  /**
   * List running containers via docker ps. Used for reconciliation.
   */
  listDockerContainers(): string[] {
    try {
      const output = execSync(
        `docker ps --filter "label=cocopilot.agent-type" --format "{{.Names}}"`,
        { encoding: "utf-8", timeout: 10000 }
      );
      return output
        .trim()
        .split("\n")
        .filter((n) => n.length > 0);
    } catch {
      logger.warn("Failed to list Docker containers");
      return [];
    }
  }
}
