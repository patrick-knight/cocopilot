import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { getCocopilotDir } from "../../daemon/config.js";

export interface TrackedRepo {
  name: string;
  url: string;
  workerCount: number;
  pendingPRs: number;
}

export function formatRepoList(repos: TrackedRepo[]): string {
  if (repos.length === 0) {
    return "No repositories tracked.\nRun `coco init <repo-url>` to start tracking a repository.";
  }

  const lines: string[] = [];

  const nameWidth = Math.max(
    "NAME".length,
    ...repos.map((r) => r.name.length),
  );
  const urlWidth = Math.max("URL".length, ...repos.map((r) => r.url.length));

  const header = [
    "NAME".padEnd(nameWidth),
    "URL".padEnd(urlWidth),
    "WORKERS",
    "PRS",
  ].join("  ");

  lines.push(header);
  lines.push("-".repeat(header.length));

  for (const repo of repos) {
    lines.push(
      [
        repo.name.padEnd(nameWidth),
        repo.url.padEnd(urlWidth),
        String(repo.workerCount).padStart("WORKERS".length),
        String(repo.pendingPRs).padStart("PRS".length),
      ].join("  "),
    );
  }

  return lines.join("\n");
}

/**
 * Read tracked repositories from ~/.cocopilot/state.json.
 */
export function readTrackedRepos(): TrackedRepo[] {
  const statePath = path.join(getCocopilotDir(), "state.json");
  try {
    if (!fs.existsSync(statePath)) return [];
    const raw = fs.readFileSync(statePath, "utf-8");
    const state = JSON.parse(raw);
    const repositories = state.repositories;

    if (!repositories || typeof repositories !== "object") return [];

    const repos: TrackedRepo[] = [];
    for (const [key, repo] of Object.entries(repositories)) {
      const r = repo as {
        name?: string;
        url?: string;
        workers?: Record<string, { status?: string }>;
      };

      const workers = r.workers ? Object.values(r.workers) : [];
      const activeWorkers = workers.filter(
        (w) => w.status === "starting" || w.status === "working",
      ).length;

      repos.push({
        name: r.name ?? key,
        url: r.url ?? "",
        workerCount: activeWorkers,
        pendingPRs: 0, // PR count requires GitHub API
      });
    }

    return repos;
  } catch {
    return [];
  }
}

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List tracked repositories")
    .option("--json", "Output as JSON")
    .action(async (options: { json: boolean }) => {
      try {
        const repos = readTrackedRepos();

        if (options.json) {
          console.log(JSON.stringify(repos, null, 2));
        } else {
          console.log(formatRepoList(repos));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("ECONNREFUSED")) {
          console.error("Error: Cannot reach the CoCoPilot daemon. Is it running? Start it with `coco start`.");
        } else if (message.includes("ENOENT")) {
          console.error("Error: Configuration file not found. Run `coco init <repo-url>` first.");
        } else {
          console.error(`Error: Failed to list repositories — ${message}`);
        }
        process.exitCode = 1;
      }
    });
}
