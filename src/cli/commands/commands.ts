import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

const execFileAsync = promisify(execFile);

interface LogTarget {
  container: string;
  repo?: string;
  type?: string;
  worker?: string;
  label: string;
  window: string;
  cmd: string[];
}

function sanitizeTmuxName(value: string): string {
  return value.replace(/[\s:./\\]+/g, "-").replace(/[^\w-]/g, "-").slice(0, 40);
}

async function ensureTmuxAvailable(): Promise<void> {
  try {
    await execFileAsync("tmux", ["-V"]);
  } catch {
    throw new Error("tmux is not installed. Rebuild the container after installing tmux.");
  }
}

async function listLogTargets(repoName?: string): Promise<LogTarget[]> {
  const args = [
    "ps",
    "--filter",
    "label=cocopilot.managed=true",
  ];
  if (repoName) {
    args.push("--filter", `label=cocopilot.repository=${repoName}`);
  }
  args.push(
    "--format",
    "{{.Names}}|{{.Label \"cocopilot.type\"}}|{{.Label \"cocopilot.worker-name\"}}|{{.Label \"cocopilot.repository\"}}",
  );

  const { stdout } = await execFileAsync("docker", args);
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  const targets: LogTarget[] = [];

  for (const line of lines) {
    const [container, type, worker, repo] = line.split("|");
    const label = worker || type || container;
    targets.push({
      container,
      type,
      worker,
      repo,
      label,
      window: "",
      cmd: ["docker", "logs", "-f", container],
    });
  }

  return targets;
}

function assignWindowNames(targets: LogTarget[], includeRepoPrefix: boolean): LogTarget[] {
  const used = new Set<string>();
  for (const target of targets) {
    const base = includeRepoPrefix && target.repo
      ? `${target.repo}-${target.label}`
      : target.label;
    const sanitizedBase = sanitizeTmuxName(base);
    let window = sanitizedBase || sanitizeTmuxName(target.container);
    let suffix = 2;
    while (used.has(window)) {
      window = `${sanitizedBase}-${suffix}`;
      suffix += 1;
    }
    used.add(window);
    target.window = window;
  }
  return targets;
}

function buildBaseTargets(repoName?: string): LogTarget[] {
  const daemonLog = path.join(getCocopilotDir(), "daemon.log");
  const containerFilter = repoName
    ? `--filter label=cocopilot.repository=${repoName}`
    : "";
  const listCmd = containerFilter
    ? `docker ps --filter label=cocopilot.managed=true ${containerFilter} --format 'table {{.Names}}\t{{.Status}}\t{{.Label "cocopilot.type"}}\t{{.Label "cocopilot.worker-name"}}'`
    : `docker ps --filter label=cocopilot.managed=true --format 'table {{.Names}}\t{{.Status}}\t{{.Label "cocopilot.type"}}\t{{.Label "cocopilot.worker-name"}}'`;

  return [
    {
      container: "",
      label: "daemon-log",
      window: "daemon-log",
      cmd: ["sh", "-lc", `tail -f ${daemonLog}`],
    },
    {
      container: "",
      label: "containers",
      window: "containers",
      cmd: ["sh", "-lc", `while true; do date; ${listCmd}; sleep 2; done`],
    },
  ];
}

async function ensureTmuxSession(
  sessionName: string,
  targets: LogTarget[],
  refresh: boolean,
): Promise<void> {
  const hasSession = async (): Promise<boolean> => {
    try {
      await execFileAsync("tmux", ["has-session", "-t", sessionName]);
      return true;
    } catch {
      return false;
    }
  };

  if (refresh) {
    await execFileAsync("tmux", ["kill-session", "-t", sessionName]).catch(() => {});
  }

  const exists = await hasSession();
  if (exists) return;

  if (targets.length === 0) {
    throw new Error("No attachable targets found.");
  }

  const [first, ...rest] = targets;
  await execFileAsync("tmux", [
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-n",
    first.window,
    ...first.cmd,
  ]);

  for (const target of rest) {
    await execFileAsync("tmux", [
      "new-window",
      "-t",
      sessionName,
      "-n",
      target.window,
      ...target.cmd,
    ]);
  }
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
      const toStr = filters.to.length === 10 ? `${filters.to}T23:59:59.999` : filters.to;
      const to = new Date(toStr);
      if (new Date(e.timestamp) > to) return false;
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

export function registerCommands(program: Command): void {
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
      .option("--push-to <branch>", "Push to existing branch (iterate on existing PR)")
      .action(async (task: string, options: { repo?: string; branch?: string; name?: string; model?: string; pushTo?: string }) => {
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
              pushTo: options.pushTo,
            }),
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
          }

          const result = await response.json();
          // API returns 202 Accepted with status and message
          if (result.status === "accepted") {
            console.log(`Worker spawn requested for "${task}" in ${repoName}.`);
            if (options.pushTo) {
              console.log(`  Will iterate on branch: ${options.pushTo}`);
            }
          } else if (result.name) {
            // Legacy response with worker name
            if (options.pushTo) {
              console.log(`Worker "${result.name}" spawned in ${repoName} (iterating on ${options.pushTo}).`);
            } else {
              console.log(`Worker "${result.name}" spawned in ${repoName}.`);
            }
          }
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

  // -------------------------------------------------------------------------
  // workspace - Manage workspaces
  // -------------------------------------------------------------------------
  const workspaceCmd = program
    .command("workspace")
    .description("Manage workspaces");

  workspaceCmd
    .command("list")
    .description("List workspaces")
    .option("--repo <name>", "Repository name")
    .option("--json", "Output as JSON")
    .action(async (options: { repo?: string; json?: boolean }) => {
      try {
        const repoName = resolveRepoName(options.repo);
        const response = await fetch(`http://localhost:3000/api/v1/repositories/${encodeURIComponent(repoName)}/workers`, {
          headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }

        const workers = (await response.json()) as Array<{
          name: string;
          type?: string;
          status?: string;
          branch?: string;
        }>;

        // Filter to only workspaces
        const workspaces = workers.filter((w) => w.type === "workspace");

        if (options.json) {
          console.log(JSON.stringify(workspaces, null, 2));
          return;
        }

        if (workspaces.length === 0) {
          console.log(`No workspaces in repository '${repoName}'`);
          console.log("\nCreate a workspace with: coco workspace add <name>");
          return;
        }

        console.log(`Workspaces in '${repoName}' (${workspaces.length}):\n`);
        const nameWidth = Math.max("NAME".length, ...workspaces.map((w) => w.name.length));
        const branchWidth = Math.max("BRANCH".length, ...workspaces.map((w) => (w.branch ?? "-").length));
        const statusWidth = Math.max("STATUS".length, ...workspaces.map((w) => (w.status ?? "-").length));

        const header = [
          "NAME".padEnd(nameWidth),
          "BRANCH".padEnd(branchWidth),
          "STATUS".padEnd(statusWidth),
        ].join("  ");
        console.log(header);
        console.log("-".repeat(header.length));

        for (const ws of workspaces) {
          console.log([
            ws.name.padEnd(nameWidth),
            (ws.branch ?? "-").padEnd(branchWidth),
            (ws.status ?? "-").padEnd(statusWidth),
          ].join("  "));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to list workspaces — ${message}`);
        process.exitCode = 1;
      }
    });

  workspaceCmd
    .command("add")
    .description("Add a new workspace")
    .argument("<name>", "Workspace name")
    .option("--repo <name>", "Repository name")
    .option("--branch <name>", "Start from a specific branch")
    .action(async (name: string, options: { repo?: string; branch?: string }) => {
      try {
        const repoName = resolveRepoName(options.repo);
        const response = await fetch(`http://localhost:3000/api/v1/repositories/${encodeURIComponent(repoName)}/workspaces`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            branch: options.branch,
            type: "workspace",
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }

        const workspace = await response.json();
        console.log(`Workspace "${workspace.name}" created in ${repoName}.`);
        console.log(`\nConnect to workspace: coco workspace connect ${name}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to add workspace — ${message}`);
        process.exitCode = 1;
      }
    });

  workspaceCmd
    .command("rm")
    .description("Remove a workspace")
    .argument("<name>", "Workspace name")
    .option("--repo <name>", "Repository name")
    .action(async (name: string, options: { repo?: string }) => {
      try {
        const repoName = resolveRepoName(options.repo);
        const response = await fetch(
          `http://localhost:3000/api/v1/repositories/${encodeURIComponent(repoName)}/workspaces/${encodeURIComponent(name)}`,
          { method: "DELETE" },
        );

        if (response.status === 204 || response.ok) {
          console.log(`Workspace "${name}" removed.`);
          return;
        }

        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to remove workspace — ${message}`);
        process.exitCode = 1;
      }
    });

  workspaceCmd
    .command("connect")
    .description("Connect to a workspace (attach to tmux)")
    .argument("<name>", "Workspace name")
    .option("--repo <name>", "Repository name")
    .option("--read-only", "Attach in read-only mode")
    .action(async (name: string, options: { repo?: string; readOnly?: boolean }) => {
      try {
        const repoName = resolveRepoName(options.repo);
        const { spawn } = await import("node:child_process");

        // Construct tmux session name (mc-<reponame>)
        const tmuxSession = `mc-${repoName.replace(/[.:/ ]/g, "-")}`;
        const target = `${tmuxSession}:${name}`;

        const tmuxArgs = ["attach", "-t", target];
        if (options.readOnly) {
          tmuxArgs.push("-r");
        }

        const proc = spawn("tmux", tmuxArgs, {
          stdio: "inherit",
        });

        proc.on("error", (err) => {
          console.error(`Error: Failed to attach to tmux — ${err.message}`);
          process.exitCode = 1;
        });

        proc.on("close", (code) => {
          if (code !== 0) {
            process.exitCode = code ?? 1;
          }
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to connect to workspace — ${message}`);
        process.exitCode = 1;
      }
    });

  // -------------------------------------------------------------------------
  // attach - Attach to an agent session
  // -------------------------------------------------------------------------
  program
    .command("attach")
    .description("Attach to an agent's tmux window")
    .argument("[agent-name]", "Agent or worker name")
    .option("--repo <name>", "Repository name (optional; defaults to all)")
    .option("--read-only", "Attach in read-only mode")
    .option("--refresh", "Rebuild the tmux session before attaching")
    .action(async (agentName: string | undefined, options: { repo?: string; readOnly?: boolean; refresh?: boolean }) => {
      try {
        await ensureTmuxAvailable();

        const repoName = options.repo;
        const includeRepoPrefix = !repoName;
        const sessionName = repoName
          ? `mc-${sanitizeTmuxName(repoName)}`
          : "mc-all";

        const baseTargets = buildBaseTargets(repoName);
        let targets = await listLogTargets(repoName);
        targets = assignWindowNames([...baseTargets, ...targets], includeRepoPrefix);

        await ensureTmuxSession(sessionName, targets, options.refresh ?? false);

        let targetWindow: string | undefined;
        if (agentName) {
          const normalized = agentName.toLowerCase();
          const matches = targets.filter((t) =>
            t.label.toLowerCase() === normalized ||
            t.window.toLowerCase() === sanitizeTmuxName(agentName).toLowerCase(),
          );
          if (matches.length === 1) {
            targetWindow = matches[0].window;
          } else if (matches.length > 1) {
            throw new Error("Multiple agents match that name. Use --repo to disambiguate.");
          } else {
            throw new Error(`No agent container found for "${agentName}".`);
          }
        }

        const { spawn } = await import("node:child_process");
        const tmuxArgs = ["attach", "-t", targetWindow ? `${sessionName}:${targetWindow}` : sessionName];
        if (options.readOnly) {
          tmuxArgs.push("-r");
        }

        const proc = spawn("tmux", tmuxArgs, { stdio: "inherit" });
        proc.on("error", (err) => {
          console.error(`Error: Failed to attach — ${err.message}`);
          process.exitCode = 1;
        });
        proc.on("close", (code) => {
          if (code !== 0) {
            process.exitCode = code ?? 1;
          }
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to attach — ${message}`);
        process.exitCode = 1;
      }
    });

  // -------------------------------------------------------------------------
  // bug - Generate diagnostic bug report
  // -------------------------------------------------------------------------
  program
    .command("bug")
    .description("Generate a diagnostic bug report")
    .option("--output <file>", "Output file path")
    .option("--verbose", "Include detailed per-repo statistics")
    .argument("[description]", "Brief description of the issue")
    .action(async (description: string | undefined, options: { output?: string; verbose?: boolean }) => {
      try {
        const { execSync } = await import("node:child_process");
        const os = await import("node:os");

        const report: string[] = [];
        report.push("# CoCoPilot Bug Report");
        report.push(`Generated: ${new Date().toISOString()}`);
        report.push("");

        if (description) {
          report.push("## Description");
          report.push(description);
          report.push("");
        }

        // Environment info
        report.push("## Environment");
        report.push(`- CoCoPilot Version: ${CLI_VERSION}`);
        report.push(`- Node.js: ${process.version}`);
        report.push(`- OS: ${os.platform()} ${os.release()}`);
        report.push(`- Arch: ${os.arch()}`);
        report.push("");

        // Tool versions
        report.push("## Tool Versions");
        try {
          const gitVersion = execSync("git --version", { encoding: "utf-8" }).trim();
          report.push(`- ${gitVersion}`);
        } catch {
          report.push("- git: not installed");
        }

        try {
          const tmuxVersion = execSync("tmux -V", { encoding: "utf-8" }).trim();
          report.push(`- ${tmuxVersion}`);
        } catch {
          report.push("- tmux: not installed");
        }

        report.push("");

        // Daemon status
        report.push("## Daemon Status");
        const pidPath = path.join(getCocopilotDir(), "daemon.pid");
        if (fs.existsSync(pidPath)) {
          const pid = fs.readFileSync(pidPath, "utf-8").trim();
          report.push(`- PID file exists: ${pid}`);
          try {
            process.kill(parseInt(pid, 10), 0);
            report.push("- Daemon: running");
          } catch {
            report.push("- Daemon: not running (stale PID)");
          }
        } else {
          report.push("- Daemon: not running (no PID file)");
        }
        report.push("");

        // Statistics
        report.push("## Statistics");
        const state = readStateFile();
        const repos = Object.keys(state?.repositories ?? {});
        report.push(`- Repositories: ${repos.length}`);

        let totalWorkers = 0;
        let totalAgents = 0;
        for (const repoName of repos) {
          const repo = state?.repositories?.[repoName];
          const workers = Object.keys(repo?.workers ?? {}).length;
          const agents = Object.keys(repo?.agents ?? {}).length;
          totalWorkers += workers;
          totalAgents += agents;

          if (options.verbose) {
            report.push(`  - ${repoName}: ${workers} workers, ${agents} agents`);
          }
        }
        report.push(`- Total Workers: ${totalWorkers}`);
        report.push(`- Total Agents: ${totalAgents}`);
        report.push("");

        // Daemon log tail
        report.push("## Recent Daemon Logs");
        report.push("```");
        const logPath = path.join(getCocopilotDir(), "daemon.log");
        const logLines = tailLines(logPath, 50);
        if (logLines.length > 0) {
          report.push(...logLines);
        } else {
          report.push("(no log file found)");
        }
        report.push("```");

        const output = report.join("\n");

        if (options.output) {
          fs.writeFileSync(options.output, output);
          console.log(`Bug report written to: ${options.output}`);
        } else {
          console.log(output);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to generate bug report — ${message}`);
        process.exitCode = 1;
      }
    });

  // -------------------------------------------------------------------------
  // copilot - Restart Copilot in current agent context
  // -------------------------------------------------------------------------
  program
    .command("copilot")
    .description("Restart Copilot in the current agent context")
    .option("--repo <name>", "Repository name")
    .option("--agent <name>", "Agent name")
    .action(async (options: { repo?: string; agent?: string }) => {
      try {
        // Infer agent context from current directory
        const cwd = process.cwd();
        const cocopilotDir = getCocopilotDir();
        let repoName = options.repo;
        let agentName = options.agent;

        // Try to infer from cwd if in worktree: ~/.cocopilot/wts/<repo>/<agent>
        const wtsDir = path.join(cocopilotDir, "wts");
        if (!repoName && cwd.startsWith(wtsDir)) {
          const rel = path.relative(wtsDir, cwd);
          const parts = rel.split(path.sep);
          if (parts.length >= 2) {
            repoName = parts[0];
            agentName = agentName ?? parts[1];
          }
        }

        // Try repos dir: ~/.cocopilot/repos/<repo>
        const reposDir = path.join(cocopilotDir, "repos");
        if (!repoName && cwd.startsWith(reposDir)) {
          const rel = path.relative(reposDir, cwd);
          const parts = rel.split(path.sep);
          if (parts.length >= 1) {
            repoName = parts[0];
          }
        }

        if (!repoName) {
          throw new Error("Could not determine repository. Use --repo to specify.");
        }
        if (!agentName) {
          throw new Error("Could not determine agent. Use --agent to specify.");
        }

        console.log(`Restarting Copilot for agent "${agentName}" in repo "${repoName}"...`);

        const response = await fetch(
          `http://localhost:3000/api/v1/repositories/${encodeURIComponent(repoName)}/workers/${encodeURIComponent(agentName)}/restart`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }

        console.log(`Copilot restarted for agent "${agentName}".`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to restart Copilot — ${message}`);
        process.exitCode = 1;
      }
    });

  // -------------------------------------------------------------------------
  // agent - Agent communication commands
  // -------------------------------------------------------------------------
  const agentCmd = program
    .command("agent")
    .description("Agent communication commands");

  agentCmd
    .command("complete")
    .description("Signal worker completion")
    .option("--summary <text>", "Completion summary")
    .option("--failure <reason>", "Mark as failed with reason")
    .option("--repo <name>", "Repository name")
    .option("--agent <name>", "Agent name")
    .action(async (options: { summary?: string; failure?: string; repo?: string; agent?: string }) => {
      try {
        // Infer agent context
        const cwd = process.cwd();
        const cocopilotDir = getCocopilotDir();
        let repoName = options.repo;
        let agentName = options.agent;

        const wtsDir = path.join(cocopilotDir, "wts");
        if (!repoName && cwd.startsWith(wtsDir)) {
          const rel = path.relative(wtsDir, cwd);
          const parts = rel.split(path.sep);
          if (parts.length >= 2) {
            repoName = parts[0];
            agentName = agentName ?? parts[1];
          }
        }

        if (!repoName) {
          throw new Error("Could not determine repository. Use --repo to specify.");
        }
        if (!agentName) {
          throw new Error("Could not determine agent. Use --agent to specify.");
        }

        const response = await fetch(
          `http://localhost:3000/api/v1/repositories/${encodeURIComponent(repoName)}/workers/${encodeURIComponent(agentName)}/complete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              summary: options.summary,
              failure: options.failure,
              status: options.failure ? "failed" : "completed",
            }),
          },
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }

        if (options.failure) {
          console.log(`Agent "${agentName}" marked as failed: ${options.failure}`);
        } else {
          console.log(`Agent "${agentName}" marked as complete.`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to signal completion — ${message}`);
        process.exitCode = 1;
      }
    });

  agentCmd
    .command("restart")
    .description("Restart a crashed or exited agent")
    .argument("<name>", "Agent name")
    .option("--repo <name>", "Repository name")
    .option("--force", "Force restart even if running")
    .action(async (name: string, options: { repo?: string; force?: boolean }) => {
      try {
        const repoName = resolveRepoName(options.repo);
        const response = await fetch(
          `http://localhost:3000/api/v1/repositories/${encodeURIComponent(repoName)}/workers/${encodeURIComponent(name)}/restart`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ force: options.force }),
          },
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }

        console.log(`Agent "${name}" restarted.`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to restart agent — ${message}`);
        process.exitCode = 1;
      }
    });

  agentCmd
    .command("attach")
    .description("Attach to an agent's tmux window")
    .argument("<name>", "Agent name")
    .option("--repo <name>", "Repository name")
    .option("--read-only", "Attach in read-only mode")
    .action(async (name: string, options: { repo?: string; readOnly?: boolean }) => {
      try {
        const repoName = resolveRepoName(options.repo);
        const { spawn } = await import("node:child_process");

        const tmuxSession = `mc-${repoName.replace(/[.:/ ]/g, "-")}`;
        const target = `${tmuxSession}:${name}`;

        const tmuxArgs = ["attach", "-t", target];
        if (options.readOnly) {
          tmuxArgs.push("-r");
        }

        const proc = spawn("tmux", tmuxArgs, {
          stdio: "inherit",
        });

        proc.on("error", (err) => {
          console.error(`Error: Failed to attach — ${err.message}`);
          process.exitCode = 1;
        });

        proc.on("close", (code) => {
          if (code !== 0) {
            process.exitCode = code ?? 1;
          }
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to attach — ${message}`);
        process.exitCode = 1;
      }
    });

  // -------------------------------------------------------------------------
  // review - Spawn a review agent for a PR
  // -------------------------------------------------------------------------
  program
    .command("review")
    .description("Spawn a review agent for a PR")
    .argument("<pr-url>", "GitHub PR URL")
    .option("--repo <name>", "Repository name")
    .option("--name <name>", "Custom reviewer name")
    .action(async (prUrl: string, options: { repo?: string; name?: string }) => {
      try {
        const repoName = resolveRepoName(options.repo);

        // Parse PR URL to extract PR number
        const prMatch = prUrl.match(/\/pull\/(\d+)/);
        if (!prMatch) {
          throw new Error("Invalid PR URL. Expected format: https://github.com/owner/repo/pull/123");
        }
        const prNumber = prMatch[1];
        const reviewerName = options.name ?? `review-pr-${prNumber}`;

        const response = await fetch(
          `http://localhost:3000/api/v1/repositories/${encodeURIComponent(repoName)}/review`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prUrl,
              prNumber: parseInt(prNumber, 10),
              name: reviewerName,
            }),
          },
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }

        const result = await response.json();
        console.log(`Review agent "${result.name}" spawned for PR #${prNumber}.`);
        console.log(`\nAttach to reviewer: coco attach ${result.name}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to spawn review agent — ${message}`);
        process.exitCode = 1;
      }
    });

  // -------------------------------------------------------------------------
  // tui - Terminal User Interface
  // -------------------------------------------------------------------------
  program
    .command("tui")
    .description("Launch the Terminal User Interface dashboard")
    .option("--port <port>", "Connect to daemon on specified port", "3000")
    .option("--repo <name>", "Jump directly to repository detail")
    .option("--status", "Start on status screen")
    .option("--metrics", "Start on metrics screen")
    .option("--no-color", "Disable colors")
    .action(async (options: { port?: string; repo?: string; status?: boolean; metrics?: boolean; color?: boolean }) => {
      // Build args for the TUI process
      const args: string[] = [];
      if (options.port) {
        args.push("--port", options.port);
      }
      if (options.repo) {
        args.push("--repo", options.repo);
      }
      if (options.status) {
        args.push("--status");
      }
      if (options.metrics) {
        args.push("--metrics");
      }
      if (options.color === false) {
        args.push("--no-color");
      }

      // Dynamically import and start the TUI with the constructed args
      try {
        const { startTui } = await import("../../tui/index.js");
        if (typeof startTui === "function") {
          startTui(args);
        } else {
          console.error("Error: TUI module failed to load properly. This may indicate a build or import error.");
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to launch TUI — ${message}`);
        process.exitCode = 1;
      }
    });
}