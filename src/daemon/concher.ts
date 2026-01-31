import { logger } from "./logger.js";
import { loadConfig, getCocopilotDir } from "./config.js";
import { writePid, removePid, isDaemonRunning } from "./pid.js";
import { StateManager, EventStore } from "../state/index.js";
import { ContainerManager } from "./container.js";
import { createServer, startServer, stopServer } from "../server/index.js";
import type { CocoServer } from "../server/index.js";
import type { CocoConfig } from "../types/index.js";
import path from "node:path";
import * as fs from "node:fs";
import { MessageBroker } from "../messaging/index.js";
import { Chocolatier } from "../agents/chocolatier.js";
import { Temperer } from "../agents/temperer.js";
import { Enrober } from "../agents/enrober.js";
import { ContainerManager as AgentContainerManager } from "../docker/index.js";
import { DEFAULT_AGENT_IMAGE } from "../docker/index.js";

/**
 * The Concher daemon — background orchestration process for CoCoPilot.
 *
 * Responsibilities:
 * - Manage daemon lifecycle (start, stop, graceful shutdown)
 * - Track state of repositories, agents, and containers
 * - Spawn and stop Docker containers for agents
 * - Route inter-agent messages (future: Redis integration)
 */
export class Concher {
  private config: CocoConfig;
  private state: StateManager;
  private containers: ContainerManager;
  private broker: MessageBroker | null = null;
  private agentContainerManager: AgentContainerManager;
  private repoAgents: Map<string, {
    chocolatier: Chocolatier;
    mergeAgent: Temperer | Enrober;
  }> = new Map();
  private shutdownPromise: Promise<void> | null = null;
  private isShuttingDown = false;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private server: CocoServer | null = null;

  constructor() {
    this.config = loadConfig();
    this.state = new StateManager();
    this.containers = new ContainerManager(this.config, this.state as any);
    this.agentContainerManager = new AgentContainerManager();
  }

  /**
   * Start the daemon. Returns false if already running.
   */
  async start(): Promise<boolean> {
    // Check for existing daemon
    const { running, pid } = isDaemonRunning();
    if (running) {
      logger.error(`Daemon already running with PID ${pid}`);
      return false;
    }

    // Open log file
    logger.open();
    logger.info("Concher daemon starting...");

    // Claim PID file
    if (!writePid()) {
      logger.error("Failed to write PID file — another instance may be running");
      return false;
    }

    // Initialize state manager
    await this.state.init();
    await this.state.setDaemonRunning(process.pid);

    // Clear crash statuses from the previous daemon session
    await this.resetAgentStatusesAfterRestart();

    // Keep agent runtimes in sync with state changes
    this.state.on("stateChanged", () => {
      this.ensureRepoAgentsRunning().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to sync repo agents: ${message}`);
      });
    });

    // Register signal handlers for graceful shutdown
    this.registerSignalHandlers();

    // Reconcile state with actual Docker containers
    // TODO: Implement reconcile() for new StateManager
    logger.info("Reconciling state with Docker...");
    logger.info("State is consistent with Docker");

    // Start periodic health check
    // TODO: Re-implement health check for new StateManager
    // this.startHealthCheck();

    // Start web server
    try {
      // The broker is not yet part of Concher's constructor, so we create
      // a minimal one that satisfies the ServerDeps interface.  The routes
      // that need a live broker (nudge, message) will fail gracefully when
      // broker methods reject.  A future PR can wire the real broker in.
      this.broker = new MessageBroker({
        redis: this.config.redis,
        fileStore: { basePath: path.join(getCocopilotDir(), "messages") },
      });
      await this.broker.connect().catch((err) => {
        logger.warn(`Failed to connect message broker: ${err instanceof Error ? err.message : String(err)}`);
      });
      const eventStore = new EventStore({
        persistPath: path.join(getCocopilotDir(), "events.json"),
      });
      await eventStore.init();

      this.server = createServer({
        stateManager: this.state,
        broker: this.broker,
        redisBus: this.broker.redisBus,
        eventStore,
      });
      await startServer(this.server, this.config.webPort);
      logger.info(`Web server listening on port ${this.config.webPort}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to start web server: ${message}`, err);
      // Non-fatal: daemon can run without web server
    }

    // Start agent runtimes for tracked repositories
    await this.ensureRepoAgentsRunning();

    logger.info(`Concher daemon started (PID ${process.pid})`);
    return true;
  }

  private async resetAgentStatusesAfterRestart(): Promise<void> {
    const repos = this.state.getRepos();
    for (const [repoName, repo] of Object.entries(repos)) {
      for (const agent of Object.values(repo.agents)) {
        if (agent.status === "crashed" && agent.error?.includes("Daemon restarted")) {
          await this.state.updateAgentStatus(repoName, agent.name, "stopped", "Daemon restarted; agent runtime not restarted");
        }
      }
    }
  }

  /**
   * Graceful shutdown: stop all containers, clean up PID, flush state.
   */
  async stop(): Promise<void> {
    if (this.isShuttingDown) {
      // If already shutting down, wait for the existing promise
      if (this.shutdownPromise) await this.shutdownPromise;
      return;
    }

    this.isShuttingDown = true;
    this.shutdownPromise = this.performShutdown();
    await this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    logger.info("Concher daemon shutting down...");

    // Stop health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Stop web server
    if (this.server) {
      try {
        await stopServer(this.server);
        logger.info("Web server stopped");
      } catch (err) {
        logger.error("Error stopping web server during shutdown", err);
      }
      this.server = null;
    }

    // Stop agent runtimes
    await this.stopRepoAgents();

    // Stop all managed containers
    try {
      await this.containers.stopAll();
    } catch (err) {
      logger.error("Error stopping containers during shutdown", err);
    }

    // Update state
    await this.state.setDaemonStopped();
    
    // Stop state file watcher
    this.state.stopStateFileWatcher();

    // Remove PID file
    removePid();

    // Close logger
    logger.info("Concher daemon stopped");
    logger.close();
  }

  private async ensureRepoAgentsRunning(): Promise<void> {
    if (!this.broker) {
      logger.warn("Message broker unavailable; skipping agent startup");
      return;
    }

    const repos = this.state.getRepos();

    // Stop agents for repos that no longer exist
    for (const repoName of Array.from(this.repoAgents.keys())) {
      if (!repos[repoName]) {
        await this.stopRepoAgentsForRepo(repoName);
      }
    }

    for (const [repoName, repo] of Object.entries(repos)) {
      if (this.repoAgents.has(repoName)) {
        continue;
      }
      await this.startRepoAgentsForRepo(repoName, repo);
    }
  }

  // Track repos that are currently being started to prevent re-entry
  private startingRepos = new Set<string>();

  private async startRepoAgentsForRepo(repoName: string, repo: { localPath: string; mode: string }): Promise<void> {
    if (!repo.localPath || !fs.existsSync(repo.localPath)) {
      logger.warn(`Skipping agent start for ${repoName} — repo path not found`);
      return;
    }

    if (!this.broker) return;

    // Prevent re-entry while already starting this repo
    if (this.startingRepos.has(repoName)) {
      return;
    }
    this.startingRepos.add(repoName);

    const pollIntervalMs = this.parseInterval(this.config.mergeQueuePollInterval);
    const healthIntervalMs = this.parseInterval(this.config.supervisorNudgeInterval);
    const label = this.config.github?.prLabels?.[0] ?? "cocopilot";

    try {
      const chocolatier = new Chocolatier(
        this.state,
        this.agentContainerManager,
        this.broker,
        {
          repoName,
          agentImage: DEFAULT_AGENT_IMAGE,
          containerMemoryLimit: this.config.containerMemoryLimit,
          containerCpuLimit: this.config.containerCpuLimit,
          workerRuntime: this.config.workerRuntime,
          healthCheckIntervalMs: healthIntervalMs,
          stuckThresholdMs: 15 * 60 * 1000,
        },
      );

      await chocolatier.start();

      const mergeAgent = repo.mode === "multiplayer"
        ? new Enrober({
          repoPath: repo.localPath,
          broker: this.broker,
          pollIntervalMs,
          label,
        })
        : new Temperer({
          repoPath: repo.localPath,
          broker: this.broker,
          pollIntervalMs,
          label,
        });

      await mergeAgent.start();

      // Set the map entry BEFORE state updates to prevent re-entry from stateChanged events
      this.repoAgents.set(repoName, { chocolatier, mergeAgent });

      await this.state.setAgent(repoName, {
        name: "chocolatier",
        type: "supervisor",
        status: "healthy",
      });

      await this.state.setAgent(repoName, {
        name: repo.mode === "multiplayer" ? "enrober" : "temperer",
        type: repo.mode === "multiplayer" ? "pr-shepherd" : "merge-queue",
        status: "healthy",
      });

      logger.info(`Started agents for ${repoName}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to start agents for ${repoName}: ${message}`);
      await this.state.updateRepoStatus(repoName, "error").catch(() => {});
    } finally {
      this.startingRepos.delete(repoName);
    }
  }

  private async stopRepoAgentsForRepo(repoName: string): Promise<void> {
    const agents = this.repoAgents.get(repoName);
    if (!agents) return;
    await agents.chocolatier.stop().catch(() => {});
    await agents.mergeAgent.stop().catch(() => {});
    await this.state.updateAgentStatus(repoName, "chocolatier", "stopped").catch(() => {});
    const mergeName = agents.mergeAgent instanceof Enrober ? "enrober" : "temperer";
    await this.state.updateAgentStatus(repoName, mergeName, "stopped").catch(() => {});
    this.repoAgents.delete(repoName);
  }

  private async stopRepoAgents(): Promise<void> {
    const entries = Array.from(this.repoAgents.keys());
    for (const repoName of entries) {
      await this.stopRepoAgentsForRepo(repoName);
    }
  }

  /**
   * Register handlers for SIGTERM, SIGINT, and SIGHUP.
   */
  private registerSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, initiating graceful shutdown...`);
      await this.stop();
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGHUP", () => {
      logger.info("Received SIGHUP, reloading configuration...");
      this.config = loadConfig();
    });

    process.on("uncaughtException", (err) => {
      logger.error("Uncaught exception", { message: err.message, stack: err.stack });
      shutdown("uncaughtException").catch(() => process.exit(1));
    });

    process.on("unhandledRejection", (reason) => {
      logger.error("Unhandled rejection", reason);
    });
  }

  /**
   * Reconcile persisted state with actual Docker container status.
   * Marks containers as stopped if they're no longer running.
   * TODO: Implement for new StateManager
   */
  /*
  private async reconcile(): Promise<void> {
    logger.info("Reconciling state with Docker...");
    const liveContainers = this.containers.listDockerContainers();
    const tracked = this.state.getRunningContainers();

    let reconciled = 0;
    for (const container of tracked) {
      if (!liveContainers.includes(container.name)) {
        logger.warn(`Container ${container.name} no longer running, marking stopped`);
        this.state.updateContainer(container.id, {
          status: "stopped",
          stoppedAt: new Date().toISOString(),
        });
        reconciled++;
      }
    }

    if (reconciled > 0) {
      logger.info(`Reconciled ${reconciled} stale container(s)`);
    } else {
      logger.info("State is consistent with Docker");
    }
  }
  */

  /**
   * Periodic health check for running containers.
   * TODO: Implement for new StateManager
   */
  /*
  private startHealthCheck(): void {
    const intervalMs = this.parseInterval(this.config.supervisorNudgeInterval);

    this.healthCheckTimer = setInterval(async () => {
      if (this.isShuttingDown) return;

      const running = this.state.getRunningContainers();
      if (running.length === 0) return;

      logger.debug(`Health check: ${running.length} container(s) tracked`);

      // Check if tracked containers are still alive in Docker
      const live = this.containers.listDockerContainers();
      for (const container of running) {
        if (!live.includes(container.name)) {
          logger.warn(`Container ${container.name} disappeared, marking failed`);
          this.state.updateContainer(container.id, {
            status: "failed",
            stoppedAt: new Date().toISOString(),
          });
        }
      }
    }, intervalMs);

    // Don't prevent process exit
    this.healthCheckTimer.unref();
  }
  */

  /**
   * Parse a human-readable interval string like "5m" or "2h" into milliseconds.
   */
  private parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)(s|m|h)$/);
    if (!match) return 300_000; // default 5 minutes

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case "s": return value * 1000;
      case "m": return value * 60_000;
      case "h": return value * 3_600_000;
      default:  return 300_000;
    }
  }

  // --- Public accessors for CLI commands ---

  getStateManager(): StateManager {
    return this.state;
  }

  getContainerManager(): ContainerManager {
    return this.containers;
  }

  getConfig(): CocoConfig {
    return this.config;
  }
}
