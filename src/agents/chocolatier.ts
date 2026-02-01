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
import { loadMCPConfig } from "../mcp/index.js";
import { getWorktreePath, cleanupWorktree } from "../git/index.js";
import { TruffleAgent } from "./truffle.js";
import { LocalTruffleRuntime } from "./truffle-runtime.js";

import type {
  ChocolatierConfig,
  ChocolatierEvents,
  SpawnWorkerOptions,
  WorkerSummary,
  WorkerHealthStatus,
  HealthCheckReport,
  AgentToolDefinition,
} from "./types.js";
import { scopedAgentName, scopedWorkerName } from "./scoped-name.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Build the unique agent name for a repo-specific Chocolatier.
 * Used both internally and by API routes that address this agent.
 */
export function chocolatierAgentName(repoName: string): string {
  return scopedAgentName("chocolatier", repoName);
}
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
  private readonly localWorkers = new Map<string, LocalTruffleRuntime>();
  private readonly agentName: string;

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
    this.agentName = chocolatierAgentName(config.repoName);
    this.config = {
      ...config,
      healthCheckIntervalMs:
        config.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS,
      stuckThresholdMs:
        config.stuckThresholdMs ?? DEFAULT_STUCK_THRESHOLD_MS,
    };

    this.stateManager.on("workerRemoved", (repoName, workerName) => {
      if (repoName !== this.config.repoName) return;
      this.stopLocalWorker(workerName).catch(() => {});
    });
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
      name: this.agentName,
      type: "supervisor",
      status: "healthy",
    });

    // Subscribe to incoming messages
    await this.broker.subscribe(this.agentName, (msg) => this.handleMessage(msg));

    // Replay any messages that arrived before we started
    await this.broker.replay(this.agentName);

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
    await this.broker.unsubscribe(this.agentName);

    // Stop any local worker runtimes
    for (const [workerName, runtime] of this.localWorkers.entries()) {
      await runtime.stop().catch(() => {});
      this.localWorkers.delete(workerName);
    }

    // Update agent status
    await this.stateManager.updateAgentStatus(
      this.config.repoName,
      this.agentName,
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
    // Use the standard worktree path: ~/.cocopilot/repos/<repoName>/worktrees/<workerName>
    const worktreePath = getWorktreePath(repoName, worker.name);
    const messagesPath = repo
      ? `${this.stateManager.getBaseDir()}/repos/${repoName}/messages`
      : `/messages`;

    // Load MCP server config from per-repo .cocopilot/config.json
    const repoLocalPath = repo?.localPath ?? "";
    const mcpConfigPath = repoLocalPath
      ? `${repoLocalPath}/.cocopilot/config.json`
      : "";
    const mcpServers = mcpConfigPath ? loadMCPConfig(mcpConfigPath) : [];

    if (this.config.workerRuntime === "local") {
      return this.spawnLocalWorker({
        worker,
        options,
        repoName,
        worktreePath,
        mcpServers,
      });
    }

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
        COCOPILOT_AGENT_NAME: scopedWorkerName(worker.name, repoName),
        COCOPILOT_REPO: repoName,
        COCOPILOT_SUPERVISOR: this.agentName,
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
        from: this.agentName,
        to: scopedWorkerName(worker.name, repoName),
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

  private async spawnLocalWorker(params: {
    worker: WorkerState;
    options: SpawnWorkerOptions;
    repoName: string;
    worktreePath: string;
    mcpServers: ReturnType<typeof loadMCPConfig>;
  }): Promise<WorkerState> {
    const { worker, options, repoName, worktreePath, mcpServers } = params;
    const repo = this.stateManager.getRepo(repoName);
    if (!repo) {
      await this.stateManager.updateWorkerStatus(repoName, worker.name, "failed", {
        error: "Repository not found for local worker runtime",
      });
      throw new Error(`Repository "${repoName}" not found`);
    }

    const customPrompt =
      "\n\nAdditional tools available:\n" +
      "- send_message(to, message, level?)\n" +
      "- request_help(message)\n" +
      "- commit_changes(message)\n" +
      "- create_pr(title, body)\n" +
      "- mark_complete(summary, prUrl?)";

    const mergeQueueType = repo.mode === "multiplayer" ? "enrober" : "temperer";

    const truffle = new TruffleAgent(
      {
        name: worker.name,
        task: options.task,
        branch: worker.branch,
        repoPath: repo.localPath,
        repoName,
        worktreePath,
        model: options.model,
        baseBranch: repo.defaultBranch ?? "main",
        prLabels: this.stateManager.getConfig().github?.prLabels ?? ["cocopilot"],
        customPrompt,
        pushTo: options.pushTo,
        supervisorName: this.agentName,
        mergeQueueName: scopedAgentName(mergeQueueType, repoName),
      },
      this.broker,
    );

    const runtime = new LocalTruffleRuntime({
      truffle,
      broker: this.broker,
      model: options.model,
      mcpServers,
    });

    truffle.on("nudged", (hint, context) => {
      runtime.sendNudge(hint, context).catch(() => {});
    });

    truffle.on("prCreated", (pr) => {
      this.stateManager
        .updateWorkerStatus(repoName, worker.name, "working", {
          prNumber: pr.number,
          prUrl: pr.url,
        })
        .catch(() => {});
    });

    truffle.on("done", () => {
      runtime.stop().catch(() => {});
      this.localWorkers.delete(worker.name);
    });

    try {
      await truffle.init();
      await this.stateManager.updateWorkerStatus(repoName, worker.name, "working", {
        containerId: `local:${worker.name}`,
      });

      await runtime.start();
      this.localWorkers.set(worker.name, runtime);
      this.emit("workerSpawned", repoName, worker);
      return worker;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.stateManager.updateWorkerStatus(repoName, worker.name, "failed", {
        error: `Local worker failed to start: ${errorMsg}`,
      });
      await runtime.stop().catch(() => {});
      // Clean up the worktree on failure
      await cleanupWorktree(repo.localPath, worker.name).catch(() => {});
      throw err;
    }
  }

  private async stopLocalWorker(workerName: string): Promise<void> {
    const runtime = this.localWorkers.get(workerName);
    if (!runtime) return;
    await runtime.stop();
    this.localWorkers.delete(workerName);
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
      from: this.agentName,
      to: scopedWorkerName(workerName, this.config.repoName),
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
      from: this.agentName,
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
    try {
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
        case MessageType.PR_MERGED:
          await this.handlePRMerged(message);
          break;
        default:
          // Acknowledge any message we receive but don't handle
          break;
      }
    } catch (err) {
      // Log but don't crash on malformed messages
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emit("error", new Error(`Error handling message ${message.type}: ${errorMsg}`));
    }

    // Acknowledge receipt
    if (message.ack_required) {
      await this.broker.acknowledge(this.agentName, message.id);
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
      from: this.agentName,
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
   * Handle a PR_MERGED notification from the Temperer.
   * Updates worker state to "merged" and broadcasts the success.
   */
  private async handlePRMerged(message: CocoMessage): Promise<void> {
    const payload = message.payload as {
      pr_number: number;
      pr_url: string;
      merge_sha: string;
    };

    // Find the worker that created this PR and update its status
    try {
      const workers = await this.listWorkers();
      const worker = workers.find((w) => w.prUrl === payload.pr_url);

      if (worker) {
        await this.stateManager.updateWorkerStatus(
          this.config.repoName,
          worker.name,
          "merged",
          { prUrl: payload.pr_url },
        );

        this.emit(
          "workerMerged",
          this.config.repoName,
          worker.name,
          payload.pr_url,
        );
      }

      await this.broadcast(
        `PR #${payload.pr_number} merged successfully (${payload.merge_sha.slice(0, 7)})`,
        "info",
      );
    } catch {
      // Worker may have already been removed
    }
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
      repoName?: string;
      branch?: string;
      name?: string;
      model?: string;
      priority?: "low" | "normal" | "high";
      pushTo?: string;
    };

    // Only handle if repoName matches this Chocolatier's repo (or not specified)
    if (payload.repoName && payload.repoName !== this.config.repoName) {
      // Not for this Chocolatier - ignore
      return;
    }

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
        from: this.agentName,
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
        from: this.agentName,
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
      .updateAgentStatus(repoName, this.agentName, "healthy")
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
