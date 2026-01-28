import { Command } from "commander";

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

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show overall system status")
    .option("--json", "Output status as JSON")
    .action(async (options: { json: boolean }) => {
      // TODO: Gather real status from daemon, Docker, etc.
      const status: SystemStatus = {
        daemon: { running: false },
        repositories: [],
        containers: 0,
        memoryUsage: "0 B / 0 B",
        cpuUsage: "0%",
      };

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(formatStatus(status));
      }
    });
}
