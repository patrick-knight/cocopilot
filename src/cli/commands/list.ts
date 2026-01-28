import { Command } from "commander";

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

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List tracked repositories")
    .option("--json", "Output as JSON")
    .action(async (options: { json: boolean }) => {
      try {
        // TODO: Read tracked repos from daemon/config
        const repos: TrackedRepo[] = [];

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
