/**
 * The Chocolatier — Supervisor Agent for CoCoPilot.
 *
 * The master chocolatier coordinates all agents. It monitors worker health,
 * spawns new Truffle workers, nudges stuck workers, responds to status
 * queries, and broadcasts system-wide announcements.
 *
 * Integrates with:
 *   - StateManager (src/state/) for persistent worker/agent state
 *   - ContainerManager (src/docker/) for Docker container lifecycle
 *   - MessageBroker (src/messaging/) for inter-agent communication
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import { StateManager } from "../state/index.js";
import type { WorkerState } from "../state/index.js";
import {
  ContainerManager,
  ContainerType,
  ContainerStatus,
  DEFAULT_AGENT_IMAGE,
} from "../docker/index.js";
import type { ContainerConfig, ContainerInfo } from "../docker/index.js";
import { MessageBroker, MessageType } from "../messaging/index.js";
import type { CocoMessage } from "../messaging/index.js";
import { loadMCPConfig, injectServers } from "../mcp/index.js";

import type {
  ChocolatierConfig,
  ChocolatierEvents,
  SpawnWorkerOptions,
  WorkerSummary,
  WorkerHealthStatus,
  HealthCheckReport,
  AgentToolDefinition,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_NAME = "chocolatier";
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_STUCK_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * System prompt defining the Chocolatier's role, as specified in the PRD.
 * This is injected into the Copilot session when the agent runs inside
 * a container with the Copilot SDK.
 */
export const CHOCOLATIER_SYSTEM_PROMPT = `You are the Chocolatier, the supervisor agent for CoCoPilot. You are the master chocolatier coordinating a confectionery factory of AI coding agents.

Your responsibilities:
1. Monitor all Truffle workers for health and progress
2. Nudge stuck workers with helpful context
3. Answer status queries from humans and other agents
4. Spawn new workers when tasks are submitted
5. Coordinate task decomposition for complex requests

You have access to these tools:
- list_workers: Get status of all active workers including their current task, branch, and container health
- spawn_worker: Create a new Truffle worker for a task. Provide a clear task description and optional branch/model overrides
- nudge_worker: Send a helpful hint to a stuck worker. Include relevant context about what might be blocking them

Guidelines:
- Run periodic health checks on all workers (default every 5 minutes)
- If a worker has been inactive for more than 15 minutes, consider it stuck and send a nudge
- If a worker's container has disappeared, mark it as failed and notify the dashboard
- When spawning fixup workers for CI failures, include the failure summary in the task description
- Always respond to STATUS_REQUEST messages promptly
- Broadcast important system events (worker completions, failures, CI issues) to keep the dashboard updated

Remember: "Good code, like good chocolate, requires the right blend of chaos and control."`;

// ---------------------------------------------------------------------------
// Chocolatier class
// ---------------------------------------------------------------------------

export class Chocolatier extends EventEmitter {
  private readonly stateManager: StateManager;
  private readonly containerManager: ContainerManager;
  private readonly broker: MessageBroker;
  private readonly config: ChocolatierConfig;

  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    stateManager: StateManager,
    containerManager: ContainerManager,
    broker: MessageBroker,
    config: ChocolatierConfig,
  ) {
    super();
    this.stateManager = stateManager;
    this.containerManager = containerManager;
    this.broker = broker;
    this.config = {
      ...config,
      healthCheckIntervalMs:
        config.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS,
      stuckThresholdMs:
        config.stuckThresholdMs ?? DEFAULT_STUCK_THRESHOLD_MS,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the Chocolatier: subscribe to messages and begin health checks.
   * Registers itself in state as the supervisor agent.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Register agent in state
    await this.stateManager.setAgent(this.config.repoName, {
      name: AGENT_NAME,
      type: "supervisor",
      status: "healthy",
    });

    // Subscribe to incoming messages
    await this.broker.subscribe(AGENT_NAME, (msg) => this.handleMessage(msg));

    // Replay any messages that arrived before we started
    await this.broker.replay(AGENT_NAME);

    // Start periodic health checks
    this.startHealthCheckLoop();

    this.emit("started");
  }

  /**
   * Stop the Chocolatier: unsubscribe from messages, stop health checks,
   * and update agent status in state.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    // Stop health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Unsubscribe from messages
    await this.broker.unsubscribe(AGENT_NAME);

    // Update agent status
    await this.stateManager.updateAgentStatus(
      this.config.repoName,
      AGENT_NAME,
      "stopped",
    );

    this.emit("stopped");
  }

  /** Whether the Chocolatier is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  // -----------------------------------------------------------------------
  // Tool: list_workers
  // -----------------------------------------------------------------------

  /**
   * List all workers for the configured repository, enriched with
   * container status from Docker.
   */
  async listWorkers(): Promise<WorkerSummary[]> {
    const repo = this.stateManager.getRepo(this.config.repoName);
    if (!repo) return [];

    const workers = Object.values(repo.workers);
    if (workers.length === 0) return [];

    // Fetch live container statuses
    let containers: ContainerInfo[];
    try {
      containers = await this.containerManager.list({
        type: ContainerType.TRUFFLE,
      });
    } catch {
      containers = [];
    }

    const containerMap = new Map<string, ContainerInfo>();
    for (const c of containers) {
      if (c.workerName) {
        containerMap.set(c.workerName, c);
      }
    }

    return workers.map((w) => {
      const container = containerMap.get(w.name);
      return {
        name: w.name,
        task: w.task,
        branch: w.branch,
        status: w.status,
        containerId: w.containerId ?? container?.id,
        containerStatus: container?.status,
        prNumber: w.prNumber,
        prUrl: w.prUrl,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      };
    });
  }

  // -----------------------------------------------------------------------
  // Tool: spawn_worker
  // -----------------------------------------------------------------------

  /**
   * Spawn a new Truffle worker for the given task.
   * Creates state, spawns Docker container, and sends TASK_ASSIGNED message.
   */
  async spawnWorker(options: SpawnWorkerOptions): Promise<WorkerState> {
    const repoName = this.config.repoName;

    // Register the worker in state (assigns candy name if not provided)
    const worker = await this.stateManager.addWorker(repoName, {
      task: options.task,
      branch: options.branch,
      name: options.name,
      model: options.model,
    });

    // Build container config
    const repo = this.stateManager.getRepo(repoName);
    const worktreePath = repo
      ? `${repo.localPath}/worktrees/${worker.name}`
      : `/workspace`;
    const messagesPath = repo
      ? `${this.stateManager.getBaseDir()}/repos/${repoName}/messages`
      : `/messages`;

    // Load MCP server config from per-repo .cocopilot/config.json
    const repoLocalPath = repo?.localPath ?? "";
    const mcpConfigPath = repoLocalPath
      ? `${repoLocalPath}/.cocopilot/config.json`
      : "";
    const mcpServers = mcpConfigPath ? loadMCPConfig(mcpConfigPath) : [];

    const containerConfig: ContainerConfig = {
      type: ContainerType.TRUFFLE,
      image: this.config.agentImage,
      name: worker.name,
      volumes: [
        { hostPath: worktreePath, containerPath: "/workspace" },
        { hostPath: messagesPath, containerPath: "/messages" },
      ],
      resources: {
        memory: this.config.containerMemoryLimit,
        cpus: this.config.containerCpuLimit,
      },
      env: {
        COCOPILOT_AGENT_NAME: worker.name,
        COCOPILOT_REPO: repoName,
        COCOPILOT_TASK: options.task,
        COCOPILOT_BRANCH: worker.branch,
        ...(options.model ? { COCOPILOT_MODEL: options.model } : {}),
        ...(mcpServers.length > 0
          ? { COCOPILOT_MCP_SERVERS: JSON.stringify(mcpServers) }
          : {}),
      },
      labels: {
        "cocopilot.repository": repoName,
      },
    };

    // Spawn the container
    try {
      const containerInfo = await this.containerManager.spawn(containerConfig);

      // Update worker state with container ID
      await this.stateManager.updateWorkerStatus(
        repoName,
        worker.name,
        "working",
        { containerId: containerInfo.id },
      );

      // Send TASK_ASSIGNED message to the worker
      await this.broker.send({
        type: MessageType.TASK_ASSIGNED,
        from: AGENT_NAME,
        to: worker.name,
        payload: {
          task: options.task,
          branch: worker.branch,
          model: options.model,
          priority: options.priority,
          ...(mcpServers.length > 0 ? { mcpServers } : {}),
        },
      });

      this.emit("workerSpawned", repoName, worker);
      return worker;
    } catch (err) {
      // Mark worker as failed if container spawn fails
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.stateManager.updateWorkerStatus(
        repoName,
        worker.name,
        "failed",
        { error: `Container spawn failed: ${errorMsg}` },
      );
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Tool: nudge_worker
  // -----------------------------------------------------------------------

  /**
   * Send a nudge (helpful hint) to a worker via the message broker.
   */
  async nudgeWorker(
    workerName: string,
    hint: string,
    context?: string,
  ): Promise<void> {
    await this.broker.send({
      type: MessageType.NUDGE,
      from: AGENT_NAME,
      to: workerName,
      payload: { hint, context },
      priority: "high",
    });
  }

  // -----------------------------------------------------------------------
  // Broadcast
  // -----------------------------------------------------------------------

  /**
   * Broadcast a system-wide announcement to all agents.
   */
  async broadcast(
    message: string,
    level: "info" | "warning" | "error" = "info",
  ): Promise<void> {
    await this.broker.send({
      type: MessageType.BROADCAST,
      from: AGENT_NAME,
      to: "*",
      payload: { message, level },
    });
  }

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  /**
   * Dispatch incoming messages to the appropriate handler.
   */
  async handleMessage(message: CocoMessage): Promise<void> {
    switch (message.type) {
      case MessageType.STATUS_REQUEST:
        await this.handleStatusRequest(message);
        break;
      case MessageType.TASK_COMPLETE:
        await this.handleTaskComplete(message);
        break;
      case MessageType.TASK_FAILED:
        await this.handleTaskFailed(message);
        break;
      case MessageType.CI_FAILED:
        await this.handleCIFailed(message);
        break;
      case MessageType.SPAWN_FIXUP:
        await this.handleSpawnFixup(message);
        break;
      case MessageType.SPAWN_WORKER:
        await this.handleSpawnWorker(message);
        break;
      default:
        // Acknowledge any message we receive but don't handle
        break;
    }

    // Acknowledge receipt
    if (message.ack_required) {
      await this.broker.acknowledge(AGENT_NAME, message.id);
    }
  }

  /**
   * Respond to a STATUS_REQUEST with current agent and worker status.
   */
  private async handleStatusRequest(message: CocoMessage): Promise<void> {
    const payload = message.payload as { request_id: string };
    const workers = await this.listWorkers();

    const activeCount = workers.filter(
      (w) => w.status === "working" || w.status === "starting",
    ).length;
    const stuckCount = workers.filter((w) => w.status === "stuck").length;

    await this.broker.send({
      type: MessageType.STATUS_RESPONSE,
      from: AGENT_NAME,
      to: message.from,
      payload: {
        request_id: payload.request_id,
        status: this.running ? "healthy" : "stopped",
        current_action: `Monitoring ${activeCount} active worker(s)`,
        progress: stuckCount > 0 ? 0 : undefined,
      },
    });
  }

  /**
   * Handle a TASK_COMPLETE message from a worker.
   * Updates worker state and broadcasts the completion.
   */
  private async handleTaskComplete(message: CocoMessage): Promise<void> {
    const payload = message.payload as {
      summary: string;
      pr_url?: string;
      files_changed?: number;
      commits?: number;
    };

    try {
      await this.stateManager.updateWorkerStatus(
        this.config.repoName,
        message.from,
        "completed",
        {
          prUrl: payload.pr_url,
        },
      );

      this.emit(
        "workerCompleted",
        this.config.repoName,
        message.from,
        payload.summary,
      );

      // Broadcast the completion event
      await this.broadcast(
        `Worker ${message.from} completed: ${payload.summary}`,
      );
    } catch {
      // Worker may have already been removed
    }
  }

  /**
   * Handle a TASK_FAILED message from a worker.
   * Updates worker state and broadcasts the failure.
   */
  private async handleTaskFailed(message: CocoMessage): Promise<void> {
    const payload = message.payload as {
      error: string;
      task: string;
      recoverable: boolean;
    };

    try {
      await this.stateManager.updateWorkerStatus(
        this.config.repoName,
        message.from,
        "failed",
        { error: payload.error },
      );

      this.emit(
        "workerFailed",
        this.config.repoName,
        message.from,
        payload.error,
      );

      await this.broadcast(
        `Worker ${message.from} failed: ${payload.error}`,
        "error",
      );
    } catch {
      // Worker may have already been removed
    }
  }

  /**
   * Handle a CI_FAILED notification from the Temperer.
   * Broadcasts the failure for dashboard visibility.
   */
  private async handleCIFailed(message: CocoMessage): Promise<void> {
    const payload = message.payload as {
      pr_number: number;
      pr_url: string;
      failure_summary: string;
    };

    await this.broadcast(
      `CI failed on PR #${payload.pr_number}: ${payload.failure_summary}`,
      "warning",
    );
  }

  /**
   * Handle a SPAWN_FIXUP request from the Temperer.
   * Spawns a new worker to fix CI failures.
   */
  private async handleSpawnFixup(message: CocoMessage): Promise<void> {
    const payload = message.payload as {
      pr_number: number;
      pr_url: string;
      failure_summary: string;
      original_worker: string;
    };

    const fixupTask =
      `Fix CI failure on PR #${payload.pr_number} (${payload.pr_url}). ` +
      `Original worker: ${payload.original_worker}. ` +
      `Failure: ${payload.failure_summary}`;

    try {
      await this.spawnWorker({
        task: fixupTask,
        priority: "high",
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.broadcast(
        `Failed to spawn fixup worker for PR #${payload.pr_number}: ${errorMsg}`,
        "error",
      );
    }
  }

  /**
   * Handle a SPAWN_WORKER message from the API or other agents.
   * This allows external systems to request worker spawns via messaging.
   */
  private async handleSpawnWorker(message: CocoMessage): Promise<void> {
    const payload = message.payload as {
      task: string;
      branch?: string;
      name?: string;
      model?: string;
      priority?: "low" | "normal" | "high";
      pushTo?: string;
    };

    try {
      const worker = await this.spawnWorker({
        task: payload.task,
        branch: payload.branch,
        name: payload.name,
        model: payload.model,
        priority: payload.priority,
        pushTo: payload.pushTo,
      });

      // Send confirmation back to requester
      await this.broker.send({
        type: MessageType.STATUS_RESPONSE,
        from: AGENT_NAME,
        to: message.from,
        payload: {
          request_id: message.id,
          status: "spawned",
          current_action: `Worker ${worker.name} spawned`,
          progress: 100,
        },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.broker.send({
        type: MessageType.TASK_FAILED,
        from: AGENT_NAME,
        to: message.from,
        payload: {
          task: payload.task,
          error: `Failed to spawn worker: ${errorMsg}`,
          recoverable: false,
        },
      });
    }
  }

  // -----------------------------------------------------------------------
  // Health check loop
  // -----------------------------------------------------------------------

  /**
   * Start the periodic health check loop.
   */
  private startHealthCheckLoop(): void {
    // Run an initial check immediately
    this.runHealthCheck().catch(() => {});

    this.healthCheckTimer = setInterval(() => {
      if (!this.running) return;
      this.runHealthCheck().catch(() => {});
    }, this.config.healthCheckIntervalMs);

    // Don't prevent process exit
    this.healthCheckTimer.unref();
  }

  /**
   * Run a single health check across all workers.
   * Detects stuck workers and missing containers.
   */
  async runHealthCheck(): Promise<HealthCheckReport> {
    const repoName = this.config.repoName;
    const repo = this.stateManager.getRepo(repoName);

    const report: HealthCheckReport = {
      repoName,
      timestamp: new Date().toISOString(),
      workers: [],
      issues: [],
    };

    if (!repo) return report;

    const workers = Object.values(repo.workers);
    if (workers.length === 0) return report;

    // Get live container statuses
    let containers: ContainerInfo[];
    try {
      containers = await this.containerManager.list({
        type: ContainerType.TRUFFLE,
      });
    } catch {
      containers = [];
    }

    const containerMap = new Map<string, ContainerInfo>();
    for (const c of containers) {
      if (c.workerName) {
        containerMap.set(c.workerName, c);
      }
    }

    const now = Date.now();

    for (const worker of workers) {
      // Skip completed/failed/terminated workers
      if (
        worker.status === "completed" ||
        worker.status === "failed" ||
        worker.status === "terminated"
      ) {
        continue;
      }

      const container = containerMap.get(worker.name);
      const updatedAt = new Date(worker.updatedAt).getTime();
      const inactivityMs = now - updatedAt;

      const isActiveStatus =
        worker.status === "working" || worker.status === "starting";
      const containerMissing =
        isActiveStatus &&
        worker.containerId != null &&
        (!container || container.status !== ContainerStatus.RUNNING);
      const isStuck =
        isActiveStatus && inactivityMs > this.config.stuckThresholdMs;

      const healthStatus: WorkerHealthStatus = {
        name: worker.name,
        stateStatus: worker.status,
        containerStatus: container?.status ?? null,
        isStuck,
        containerMissing,
        inactivityMs,
      };

      report.workers.push(healthStatus);

      if (isStuck || containerMissing) {
        report.issues.push(healthStatus);
      }
    }

    // Handle issues
    for (const issue of report.issues) {
      if (issue.containerMissing) {
        // Container disappeared — mark worker as failed
        try {
          await this.stateManager.updateWorkerStatus(
            repoName,
            issue.name,
            "failed",
            { error: "Container disappeared unexpectedly" },
          );
        } catch {
          // Worker may already be updated
        }
        this.emit("workerContainerMissing", repoName, issue.name);

        await this.broadcast(
          `Worker ${issue.name} container disappeared unexpectedly`,
          "error",
        ).catch(() => {});
      } else if (issue.isStuck) {
        // Worker appears stuck — update status and send nudge
        try {
          await this.stateManager.updateWorkerStatus(
            repoName,
            issue.name,
            "stuck",
          );
        } catch {
          // Worker may already be updated
        }
        this.emit("workerStuck", repoName, issue.name);

        const minutes = Math.round(issue.inactivityMs / 60_000);
        await this.nudgeWorker(
          issue.name,
          `You appear to be stuck (no activity for ${minutes} minutes). ` +
            `Are you blocked on something? Try breaking the problem into smaller steps.`,
        ).catch(() => {});
      }
    }

    // Update agent last activity
    await this.stateManager
      .updateAgentStatus(repoName, AGENT_NAME, "healthy")
      .catch(() => {});

    this.emit("healthCheck", report);
    return report;
  }

  // -----------------------------------------------------------------------
  // Tool definitions (for Copilot SDK integration)
  // -----------------------------------------------------------------------

  /**
   * Returns the custom tool definitions for the Copilot SDK session.
   * These are used when the Chocolatier runs inside a container
   * with `@github/copilot-sdk`.
   */
  getToolDefinitions(): AgentToolDefinition[] {
    return [
      {
        name: "list_workers",
        description:
          "Get status of all active Truffle workers including their current task, branch, and container health.",
        parameters: {
          type: "object",
          properties: {},
        },
        handler: async () => {
          const workers = await this.listWorkers();
          return { workers, count: workers.length };
        },
      },
      {
        name: "spawn_worker",
        description:
          "Create a new Truffle worker for a task. The worker runs in an isolated Docker container with its own git worktree.",
        parameters: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description: "Clear description of the task for the worker",
            },
            branch: {
              type: "string",
              description:
                "Git branch to start from (optional, auto-generated if omitted)",
            },
            model: {
              type: "string",
              description: "Model override (e.g., 'claude-sonnet-4-5')",
            },
            priority: {
              type: "string",
              enum: ["low", "normal", "high"],
              description: "Task priority level",
            },
          },
          required: ["task"],
        },
        handler: async (params) => {
          const worker = await this.spawnWorker({
            task: params.task as string,
            branch: params.branch as string | undefined,
            model: params.model as string | undefined,
            priority: params.priority as "low" | "normal" | "high" | undefined,
          });
          return {
            spawned: true,
            name: worker.name,
            branch: worker.branch,
            task: worker.task,
          };
        },
      },
      {
        name: "nudge_worker",
        description:
          "Send a helpful hint to a stuck Truffle worker. Include relevant context about what might be blocking them.",
        parameters: {
          type: "object",
          properties: {
            worker_name: {
              type: "string",
              description: "Name of the worker to nudge (e.g., 'Snickers')",
            },
            hint: {
              type: "string",
              description: "Helpful hint or suggestion for the worker",
            },
            context: {
              type: "string",
              description:
                "Additional context about the worker's situation",
            },
          },
          required: ["worker_name", "hint"],
        },
        handler: async (params) => {
          await this.nudgeWorker(
            params.worker_name as string,
            params.hint as string,
            params.context as string | undefined,
          );
          return { nudged: true, worker: params.worker_name };
        },
      },
    ];
  }

  /**
   * Returns the system prompt for the Copilot SDK session.
   */
  getSystemPrompt(): string {
    return CHOCOLATIER_SYSTEM_PROMPT;
  }
}
