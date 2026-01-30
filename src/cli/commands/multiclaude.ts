import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { getCocopilotDir } from "../../daemon/config.js";
import { FileMessageStore, MessageType } from "../../messaging/index.js";
import type { ActivityEvent } from "../../state/index.js";
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

function readStateFile(): {
  repositories?: Record<string, {
    name?: string;
    agents?: Record<string, unknown>;
    workers?: Record<string, unknown>;
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

function listTrackedRepos(): string[] {
  const state = readStateFile();
  if (!state?.repositories) return [];
  return Object.keys(state.repositories);
}

function resolveRepoName(repoArg?: string): string {
  if (repoArg) return repoArg;
  const repos = listTrackedRepos();
  if (repos.length === 1) return repos[0];
  if (repos.length === 0) {
    throw new Error("No repositories are tracked. Run `coco init <repo-url>` first.");
  }
  throw new Error("Multiple repositories tracked. Use --repo to select one.");
}

function getRepoState(repoName: string): {
  agents?: Record<string, unknown>;
  workers?: Record<string, unknown>;
} | null {
  const state = readStateFile();
  return state?.repositories?.[repoName] ?? null;
}

function formatWorkers(rows: Array<{ name: string; repoName: string; status?: string; task?: string }>): string {
  if (rows.length === 0) return "No workers found.";
  const nameWidth = Math.max("NAME".length, ...rows.map((r) => r.name.length));
  const repoWidth = Math.max("REPO".length, ...rows.map((r) => r.repoName.length));
  const statusWidth = Math.max("STATUS".length, ...rows.map((r) => (r.status ?? "").length));

  const header = [
    "NAME".padEnd(nameWidth),
    "REPO".padEnd(repoWidth),
    "STATUS".padEnd(statusWidth),
    "TASK",
  ].join("  ");

  const lines = [header, "-".repeat(header.length)];
  for (const row of rows) {
    lines.push([
      row.name.padEnd(nameWidth),
      row.repoName.padEnd(repoWidth),
      (row.status ?? "").padEnd(statusWidth),
      row.task ?? "",
    ].join("  "));
  }
  return lines.join("\n");
}

function formatHistory(events: ActivityEvent[]): string {
  if (events.length === 0) return "No history found.";

  const lines: string[] = [];
  for (const event of events) {
    const ts = new Date(event.timestamp).toISOString();
    const agent = event.agent ?? "-";
    lines.push(`${ts}  ${event.repository}  ${event.type}  ${agent}  ${event.description}`);
  }
  return lines.join("\n");
}

function filterEvents(events: ActivityEvent[], filters: {
  repository?: string;
  type?: string;
  agent?: string;
  from?: string;
  to?: string;
  limit?: number;
}): ActivityEvent[] {
  let filtered = events.filter((e) => {
    if (filters.repository && e.repository !== filters.repository) return false;
    if (filters.type && e.type !== filters.type) return false;
    if (filters.agent && e.agent !== filters.agent) return false;
    if (filters.from) {
      const from = new Date(filters.from);
      if (new Date(e.timestamp) < from) return false;
    }
    if (filters.to) {
      const to = new Date(filters.to);
      if (filters.to.length === 10) {
        to.setDate(to.getDate() + 1);
      }
      if (new Date(e.timestamp) >= to) return false;
    }
    return true;
  });

  if (filters.limit && filters.limit > 0) {
    filtered = filtered.slice(0, filters.limit);
  }
  return filtered;
}

async function loadEventsFromFile(): Promise<ActivityEvent[]> {
  const eventsPath = path.join(getCocopilotDir(), "events.json");
  try {
    if (!fs.existsSync(eventsPath)) return [];
    const raw = await fs.promises.readFile(eventsPath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ActivityEvent[]) : [];
  } catch {
    return [];
  }
}

async function fetchEventsFromApi(params: URLSearchParams): Promise<ActivityEvent[] | null> {
  try {
    const url = `http://localhost:3000/api/v1/events?${params.toString()}`;
    const response = await fetch(url, { headers: { "Content-Type": "application/json" } });
    if (!response.ok) return null;
    return (await response.json()) as ActivityEvent[];
  } catch {
    return null;
  }
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

  // worker/work
  const registerWorkerCommands = (root: Command, cmdName: string, description: string): void => {
    const worker = root.command(cmdName).description(description);

    worker
      .command("create")
      .description("Spawn a worker")
      .argument("<task>", "Task description")
      .option("--repo <name>", "Repository name")
      .option("--branch <name>", "Start from a specific branch")
      .option("--name <name>", "Custom worker name")
      .option("--model <model>", "Override model")
      .action(async (task: string, options: { repo?: string; branch?: string; name?: string; model?: string }) => {
        try {
          const repoName = resolveRepoName(options.repo);
          const response = await fetch("http://localhost:3000/api/v1/workers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              task,
              repoName,
              branch: options.branch,
              name: options.name,
              model: options.model,
            }),
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
          }

          const worker = await response.json();
          console.log(`Worker "${worker.name}" spawned in ${repoName}.`);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Error: Failed to spawn worker — ${message}`);
          process.exitCode = 1;
        }
      });

    worker
      .command("list")
      .description("List workers")
      .option("--repo <name>", "Repository name")
      .option("--json", "Output as JSON")
      .action(async (options: { repo?: string; json?: boolean }) => {
        try {
          const response = await fetch("http://localhost:3000/api/v1/workers", {
            headers: { "Content-Type": "application/json" },
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
          }

          const workers = (await response.json()) as Array<{
            name: string;
            repoName: string;
            status?: string;
            task?: string;
          }>;

          const filtered = options.repo
            ? workers.filter((w) => w.repoName === options.repo)
            : workers;

          if (options.json) {
            console.log(JSON.stringify(filtered, null, 2));
          } else {
            console.log(formatWorkers(filtered));
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Error: Failed to list workers — ${message}`);
          process.exitCode = 1;
        }
      });

    worker
      .command("rm")
      .description("Remove a worker")
      .argument("<name>", "Worker name")
      .action(async (name: string) => {
        try {
          const response = await fetch(
            `http://localhost:3000/api/v1/workers/${encodeURIComponent(name)}`,
            { method: "DELETE" },
          );

          if (response.status === 204 || response.ok) {
            console.log(`Worker "${name}" removed.`);
            return;
          }

          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Error: Failed to remove worker — ${message}`);
          process.exitCode = 1;
        }
      });

    if (cmdName === "work") {
      worker
        .argument("[task]", "Task description")
        .option("--repo <name>", "Repository name")
        .option("--branch <name>", "Start from a specific branch")
        .option("--name <name>", "Custom worker name")
        .option("--model <model>", "Override model")
        .action(async (task: string | undefined, options: { repo?: string; branch?: string; name?: string; model?: string }) => {
          if (!task) {
            worker.outputHelp();
            return;
          }

          try {
            const repoName = resolveRepoName(options.repo);
            const response = await fetch("http://localhost:3000/api/v1/workers", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                task,
                repoName,
                branch: options.branch,
                name: options.name,
                model: options.model,
              }),
            });

            if (!response.ok) {
              const text = await response.text();
              throw new Error(text || `HTTP ${response.status}`);
            }

            const worker = await response.json();
            console.log(`Worker "${worker.name}" spawned in ${repoName}.`);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Error: Failed to spawn worker — ${message}`);
            process.exitCode = 1;
          }
        });
    }
  };

  registerWorkerCommands(program, "worker", "Manage worker agents");
  registerWorkerCommands(program, "work", "Manage worker agents");

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

  // history
  program
    .command("history")
    .description("Show task history for a repository")
    .option("--repo <name>", "Repository name")
    .option("--type <type>", "Filter by event type")
    .option("--agent <name>", "Filter by agent name")
    .option("--from <date>", "Filter from date (YYYY-MM-DD or ISO)")
    .option("--to <date>", "Filter to date (YYYY-MM-DD or ISO)")
    .option("--limit <n>", "Limit number of events", "200")
    .option("--json", "Output as JSON")
    .action(async (options: { repo?: string; type?: string; agent?: string; from?: string; to?: string; limit?: string; json?: boolean }) => {
      try {
        const repoName = options.repo ? resolveRepoName(options.repo) : undefined;
        const params = new URLSearchParams();
        if (repoName) params.set("repository", repoName);
        if (options.type) params.set("type", options.type);
        if (options.agent) params.set("agent", options.agent);
        if (options.from) params.set("from", options.from);
        if (options.to) params.set("to", options.to);

        const limit = Math.max(1, Number(options.limit) || 200);

        const apiEvents = await fetchEventsFromApi(params);
        const events = apiEvents ?? await loadEventsFromFile();
        const filtered = filterEvents(events, {
          repository: repoName,
          type: options.type,
          agent: options.agent,
          from: options.from,
          to: options.to,
          limit,
        });

        if (options.json) {
          console.log(JSON.stringify(filtered, null, 2));
        } else {
          console.log(formatHistory(filtered));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to read history — ${message}`);
        process.exitCode = 1;
      }
    });

  // message
  const messageCmd = program
    .command("message")
    .description("Manage inter-agent messages");

  messageCmd
    .command("send")
    .description("Send a message to an agent or worker")
    .argument("<to>", "Agent or worker name")
    .argument("<msg>", "Message text")
    .option("--repo <name>", "Repository name")
    .option("--from <name>", "Sender name", "cli")
    .option("--priority <level>", "Priority (low|normal|high)", "normal")
    .action(async (to: string, msg: string, options: { repo?: string; from?: string; priority?: string }) => {
      try {
        const repoName = resolveRepoName(options.repo);
        const repo = getRepoState(repoName);
        if (!repo) throw new Error(`Repository "${repoName}" not found.`);

        if (repo.workers && repo.workers[to]) {
          const response = await fetch(
            `http://localhost:3000/api/v1/repositories/${encodeURIComponent(repoName)}/workers/${encodeURIComponent(to)}/nudge`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ hint: msg }),
            },
          );

          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
          }

          console.log(`Message sent to worker "${to}".`);
          return;
        }

        if (repo.agents && repo.agents[to]) {
          const response = await fetch(
            `http://localhost:3000/api/v1/repositories/${encodeURIComponent(repoName)}/agents/${encodeURIComponent(to)}/message`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: MessageType.NUDGE,
                payload: { hint: msg },
                from: options.from ?? "cli",
                priority: options.priority ?? "normal",
              }),
            },
          );

          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
          }

          console.log(`Message sent to agent "${to}".`);
          return;
        }

        throw new Error(`Agent or worker "${to}" not found in "${repoName}".`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to send message — ${message}`);
        process.exitCode = 1;
      }
    });

  messageCmd
    .command("list")
    .description("List messages for an agent")
    .requiredOption("--agent <name>", "Agent name")
    .option("--all", "Include acknowledged messages")
    .option("--json", "Output as JSON")
    .action(async (options: { agent: string; all?: boolean; json?: boolean }) => {
      try {
        const store = new FileMessageStore({
          basePath: path.join(getCocopilotDir(), "messages"),
        });
        const messages = options.all
          ? await store.getAll(options.agent)
          : await store.getPending(options.agent);

        if (options.json) {
          console.log(JSON.stringify(messages, null, 2));
          return;
        }

        if (messages.length === 0) {
          console.log("No messages found.");
          return;
        }

        for (const msg of messages) {
          const ts = new Date(msg.timestamp).toISOString();
          const ack = msg.ack_received ? "ack" : "pending";
          console.log(`${msg.id}  ${msg.type}  ${msg.from} -> ${msg.to}  ${ack}  ${ts}`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to list messages — ${message}`);
        process.exitCode = 1;
      }
    });

  messageCmd
    .command("read")
    .description("Read a specific message")
    .argument("<id>", "Message ID")
    .requiredOption("--agent <name>", "Agent name")
    .action(async (id: string, options: { agent: string }) => {
      try {
        const store = new FileMessageStore({
          basePath: path.join(getCocopilotDir(), "messages"),
        });
        const messages = await store.getAll(options.agent);
        const msg = messages.find((m) => m.id === id);
        if (!msg) {
          console.error(`Message "${id}" not found for agent "${options.agent}".`);
          process.exitCode = 1;
          return;
        }
        console.log(JSON.stringify(msg, null, 2));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to read message — ${message}`);
        process.exitCode = 1;
      }
    });

  messageCmd
    .command("ack")
    .description("Acknowledge a message")
    .argument("<id>", "Message ID")
    .requiredOption("--agent <name>", "Agent name")
    .action(async (id: string, options: { agent: string }) => {
      try {
        const store = new FileMessageStore({
          basePath: path.join(getCocopilotDir(), "messages"),
        });
        const ok = await store.acknowledge(options.agent, id);
        if (!ok) {
          console.error(`Message "${id}" not found for agent "${options.agent}".`);
          process.exitCode = 1;
          return;
        }
        console.log(`Message "${id}" acknowledged.`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to acknowledge message — ${message}`);
        process.exitCode = 1;
      }
    });

  // cleanup
  program
    .command("cleanup")
    .description("Clean up orphaned resources (messages only)")
    .option("--hours <n>", "Remove acknowledged messages older than N hours", "24")
    .action(async (options: { hours?: string }) => {
      try {
        const hours = Math.max(1, Number(options.hours) || 24);
        const store = new FileMessageStore({
          basePath: path.join(getCocopilotDir(), "messages"),
        });
        const deleted = await store.cleanup(hours * 60 * 60 * 1000);
        console.log(`Cleaned up ${deleted} acknowledged message(s).`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Cleanup failed — ${message}`);
        process.exitCode = 1;
      }
    });

  // repair
  program
    .command("repair")
    .description("Repair state after a crash")
    .action(async () => {
      await signalDaemonReload();
    });

  // multiclaude-style placeholders
  registerStub(program, "workspace", "Manage workspaces", "Workspace management is not implemented yet.");
  registerStub(program, "attach", "Attach to an agent session", "Attach is not implemented yet.");
  registerStub(program, "bug", "Generate a diagnostic bug report", "Bug report generation is not implemented yet.");
  registerStub(program, "claude", "Restart Claude in the current agent context", "Claude restart is not implemented yet.");
  registerStub(program, "agent", "Agent communication commands", "Agent messaging is not implemented yet.");
  registerStub(program, "review", "Spawn a review agent for a PR", "Review agent is not implemented yet.");
}