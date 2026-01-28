import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { isDaemonRunning } from "../../daemon/pid.js";
import { getCocopilotDir } from "../../daemon/config.js";

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  uptime?: string;
  dashboardUrl?: string;
}

export interface RepoStatus {
  name: string;
  workerCount: number;
  pendingPRs: number;
}

export interface SystemStatus {
  daemon: DaemonStatus;
  repositories: RepoStatus[];
  containers: number;
  memoryUsage: string;
  cpuUsage: string;
}

export function formatStatus(status: SystemStatus): string {
  const lines: string[] = [];

  lines.push("CoCoPilot Status");
  lines.push("-".repeat(37));

  if (status.daemon.running) {
    lines.push(`Daemon:     Running (PID ${status.daemon.pid ?? "?"})`);
    if (status.daemon.dashboardUrl) {
      lines.push(`Dashboard:  ${status.daemon.dashboardUrl}`);
    }
    if (status.daemon.uptime) {
      lines.push(`Uptime:     ${status.daemon.uptime}`);
    }
  } else {
    lines.push("Daemon:     Not running");
  }

  lines.push("");

  if (status.repositories.length > 0) {
    lines.push(`Repositories (${status.repositories.length}):`);
    for (const repo of status.repositories) {
      const workers =
        repo.workerCount === 1
          ? "1 worker"
          : `${repo.workerCount} workers`;
      const prs =
        repo.pendingPRs === 1 ? "1 PR pending" : `${repo.pendingPRs} PRs pending`;
      lines.push(`  ${repo.name.padEnd(14)}${workers}, ${prs}`);
    }
  } else {
    lines.push("Repositories: None tracked");
  }

  lines.push("");
  lines.push("Resources:");
  lines.push(`  Containers:   ${status.containers} running`);
  lines.push(`  Memory:       ${status.memoryUsage}`);
  lines.push(`  CPU:          ${status.cpuUsage}`);

  return lines.join("\n");
}

/**
 * Compute a human-readable uptime string from an ISO 8601 timestamp.
 */
function computeUptime(startedAt: string): string {
  const started = new Date(startedAt).getTime();
  const now = Date.now();
  const diffMs = now - started;

  if (diffMs < 0) return "0s";

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Read the persisted daemon state from ~/.cocopilot/state.json.
 * Returns null if the file doesn't exist or is unreadable.
 */
function readDaemonState(): {
  status?: string;
  startedAt?: string;
  repositories?: Record<string, {
    name: string;
    workers?: Record<string, { status?: string }>;
  }>;
} | null {
  const statePath = path.join(getCocopilotDir(), "state.json");
  try {
    if (!fs.existsSync(statePath)) return null;
    const raw = fs.readFileSync(statePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Read config to determine the web port.
 */
function readConfigPort(): number {
  const configPath = path.join(getCocopilotDir(), "config.json");
  try {
    if (!fs.existsSync(configPath)) return 3000;
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    return typeof config.webPort === "number" ? config.webPort : 3000;
  } catch {
    return 3000;
  }
}

/**
 * Gather real system status from daemon PID file, state.json, and config.
 */
export function gatherStatus(): SystemStatus {
  const { running, pid } = isDaemonRunning();

  const daemon: DaemonStatus = { running };

  if (running && pid !== null) {
    daemon.pid = pid;
    const port = readConfigPort();
    daemon.dashboardUrl = `http://localhost:${port}`;

    const state = readDaemonState();
    if (state?.startedAt) {
      daemon.uptime = computeUptime(state.startedAt);
    }
  }

  const repos: RepoStatus[] = [];
  let containerCount = 0;
  const state = readDaemonState();

  if (state?.repositories) {
    for (const [name, repo] of Object.entries(state.repositories)) {
      const workers = repo.workers ? Object.keys(repo.workers) : [];
      const activeWorkers = repo.workers
        ? Object.values(repo.workers).filter(
            (w) => w.status === "starting" || w.status === "working",
          ).length
        : 0;

      repos.push({
        name: name || repo.name,
        workerCount: activeWorkers,
        pendingPRs: 0, // PR count requires GitHub API; leave at 0 for CLI
      });

      containerCount += workers.length;
    }
  }

  return {
    daemon,
    repositories: repos,
    containers: containerCount,
    memoryUsage: "0 B / 0 B",
    cpuUsage: "0%",
  };
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show overall system status")
    .option("--json", "Output status as JSON")
    .action(async (options: { json: boolean }) => {
      try {
        const status = gatherStatus();

        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          console.log(formatStatus(status));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("ECONNREFUSED")) {
          console.error("Error: Cannot reach the CoCoPilot daemon. Is it running? Start it with `coco start`.");
        } else if (message.includes("docker")) {
          console.error("Error: Docker is not running. Start Docker Desktop and try again.");
        } else {
          console.error(`Error: Failed to retrieve status — ${message}`);
        }
        process.exitCode = 1;
      }
    });
}
