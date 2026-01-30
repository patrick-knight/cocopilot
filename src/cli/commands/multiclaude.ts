import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { getCocopilotDir } from "../../daemon/config.js";
import { stopDaemon } from "../daemon.js";
import { registerInitCommand } from "./init.js";
import { registerListCommand } from "./list.js";
import { registerRemoveCommand } from "./remove.js";
import { registerStartCommand } from "./start.js";
import { registerStatusCommand } from "./status.js";
import { registerStopCommand } from "./stop.js";

const CLI_VERSION = "0.1.0";

function registerStub(
  program: Command,
  name: string,
  description: string,
  message?: string,
): void {
  program
    .command(name)
    .description(description)
    .action(() => {
      console.error(
        message ??
          `Command "${name}" is not implemented in CoCoPilot yet.`
      );
      process.exitCode = 1;
    });
}

function tailLines(filePath: string, lines: number): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const all = content.split("\n");
  return all.slice(Math.max(0, all.length - lines));
}

async function signalDaemonReload(): Promise<void> {
  try {
    const response = await fetch("http://localhost:3000/api/v1/system/reload-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (response.ok) {
      console.log("Daemon state reloaded.");
    } else {
      const text = await response.text();
      console.error(text || `Error: HTTP ${response.status}`);
      process.exitCode = 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: Failed to reach daemon — ${message}`);
    process.exitCode = 1;
  }
}

export function registerMulticlaudeCompatCommands(program: Command): void {
  // daemon
  const daemon = program
    .command("daemon")
    .description("Manage the CoCoPilot daemon");
  registerStartCommand(daemon);
  registerStopCommand(daemon);
  registerStatusCommand(daemon);

  // repo
  const repo = program
    .command("repo")
    .description("Manage repositories");
  registerInitCommand(repo);
  registerListCommand(repo);
  registerRemoveCommand(repo);

  // version
  program
    .command("version")
    .description("Show version information")
    .action(() => {
      console.log(`coco ${CLI_VERSION}`);
    });

  // docs
  program
    .command("docs")
    .description("Show CLI documentation")
    .action(() => {
      program.outputHelp();
    });

  // stop-all
  program
    .command("stop-all")
    .description("Stop daemon and all managed services")
    .action(async () => {
      try {
        await stopDaemon();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to stop services — ${message}`);
        process.exitCode = 1;
      }
    });

  // logs
  program
    .command("logs")
    .description("View daemon logs")
    .option("-n, --lines <n>", "Number of lines to show", "200")
    .action((options: { lines: string }) => {
      const count = Math.max(1, Number(options.lines) || 200);
      const logPath = path.join(getCocopilotDir(), "daemon.log");
      const lines = tailLines(logPath, count);
      if (lines.length === 0) {
        console.log("No daemon logs found.");
        return;
      }
      console.log(lines.join("\n"));
    });

  // repair
  program
    .command("repair")
    .description("Repair state after a crash")
    .action(async () => {
      await signalDaemonReload();
    });

  // multiclaude-style placeholders
  registerStub(program, "worker", "Manage worker agents", "Worker management CLI is not implemented yet. Use the REST API: POST /api/v1/workers.");
  registerStub(program, "work", "Manage worker agents", "Worker management CLI is not implemented yet. Use the REST API: POST /api/v1/workers.");
  registerStub(program, "workspace", "Manage workspaces", "Workspace management is not implemented yet.");
  registerStub(program, "cleanup", "Clean up orphaned resources", "Cleanup is not implemented yet.");
  registerStub(program, "attach", "Attach to an agent session", "Attach is not implemented yet.");
  registerStub(program, "bug", "Generate a diagnostic bug report", "Bug report generation is not implemented yet.");
  registerStub(program, "history", "Show task history for a repository", "History is not implemented yet.");
  registerStub(program, "claude", "Restart Claude in the current agent context", "Claude restart is not implemented yet.");
  registerStub(program, "agent", "Agent communication commands", "Agent messaging is not implemented yet.");
  registerStub(program, "message", "Manage inter-agent messages", "Agent messaging is not implemented yet.");
  registerStub(program, "review", "Spawn a review agent for a PR", "Review agent is not implemented yet.");
}