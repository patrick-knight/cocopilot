import { logger } from "./logger.js";
import { loadConfig } from "./config.js";
import { writePid, removePid, isDaemonRunning } from "./pid.js";
import { StateManager } from "./state.js";
import { ContainerManager } from "./container.js";
import { createServer, startServer, stopServer } from "../server/index.js";
import type { CocoServer } from "../server/index.js";
import type { CocoConfig } from "../types/index.js";

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
  private shutdownPromise: Promise<void> | null = null;
  private isShuttingDown = false;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private server: CocoServer | null = null;

  constructor() {
    this.config = loadConfig();
    this.state = new StateManager();
    this.containers = new ContainerManager(this.config, this.state);
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

    // Load persisted state
    this.state.load();
    this.state.setDaemonInfo(process.pid);

    // Register signal handlers for graceful shutdown
    this.registerSignalHandlers();

    // Reconcile state with actual Docker containers
    await this.reconcile();

    // Start periodic health check
    this.startHealthCheck();

    // Start web server
    try {
      // The broker is not yet part of Concher's constructor, so we create
      // a minimal one that satisfies the ServerDeps interface.  The routes
      // that need a live broker (nudge, message) will fail gracefully when
      // broker methods reject.  A future PR can wire the real broker in.
      const { MessageBroker } = await import("../messaging/index.js");
      const { getCocopilotDir } = await import("./config.js");
      const path = await import("node:path");
      const broker = new MessageBroker({
        redis: this.config.redis,
        fileStore: { basePath: path.default.join(getCocopilotDir(), "messages") },
      });
      this.server = createServer({
        stateManager: this.state,
        broker,
      });
      await startServer(this.server, this.config.webPort);
      logger.info(`Web server listening on port ${this.config.webPort}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to start web server: ${message}`, err);
      // Non-fatal: daemon can run without web server
    }

    logger.info(`Concher daemon started (PID ${process.pid})`);
    return true;
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

    // Stop all managed containers
    try {
      await this.containers.stopAll();
    } catch (err) {
      logger.error("Error stopping containers during shutdown", err);
    }

    // Update state
    this.state.clearDaemonInfo();

    // Remove PID file
    removePid();

    // Close logger
    logger.info("Concher daemon stopped");
    logger.close();
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
   */
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

  /**
   * Periodic health check for running containers.
   */
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
