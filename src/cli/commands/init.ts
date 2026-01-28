import { Command } from "commander";
import { detectFork, configureMultiplayer } from "../../github/fork-detection.js";
import type { RepoConfig } from "../../state/schemas.js";

const GITHUB_URL_PATTERN =
  /^https?:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;

export function isValidGitHubUrl(url: string): boolean {
  return GITHUB_URL_PATTERN.test(url);
}

export function repoNameFromUrl(url: string): string {
  const cleaned = url.replace(/\.git$/, "");
  const parts = cleaned.split("/");
  return parts[parts.length - 1];
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize repository tracking")
    .argument("<repo-url>", "GitHub repository URL to track")
    .option("--name <name>", "Custom name for the repository")
    .action(async (repoUrl: string, options: { name?: string }) => {
      if (!isValidGitHubUrl(repoUrl)) {
        console.error(
          `Error: "${repoUrl}" is not a valid GitHub repository URL.`,
        );
        console.error(
          "Expected format: https://github.com/<owner>/<repo>",
        );
        process.exitCode = 1;
        return;
      }

      const name = options.name ?? repoNameFromUrl(repoUrl);

      try {
        console.log(`Initializing repository: ${name}`);
        console.log(`URL: ${repoUrl}`);

        // Detect if this repository is a fork
        let config: RepoConfig = {};
        try {
          const forkInfo = await detectFork(repoUrl);

          if (forkInfo.isFork) {
            console.log(
              `Detected fork of ${forkInfo.parentOwner}/${forkInfo.parentRepo}`,
            );
            config = configureMultiplayer(config, forkInfo);
            console.log("Configured for multiplayer mode (fork detected).");
            console.log(
              `  - autoMerge: disabled`,
            );
            console.log(
              `  - activeAgent: enrober`,
            );
            console.log(
              `  - upstream: ${forkInfo.parentOwner}/${forkInfo.parentRepo}`,
            );
          }
        } catch {
          console.warn(
            "Warning: Could not detect fork status. Continuing with default configuration.",
          );
        }

        // TODO: Clone/register repository, set up worktrees, configure tracking
        console.log(`Repository "${name}" initialized successfully.`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("ENOENT") && message.includes("git")) {
          console.error("Error: Git is not installed or not in PATH. Install Git and try again.");
        } else if (message.includes("docker")) {
          console.error("Error: Docker is not running. Start Docker Desktop and try again.");
        } else if (message.includes("EACCES") || message.includes("EPERM")) {
          console.error("Error: Permission denied. Check file permissions and try again.");
        } else {
          console.error(`Error: Failed to initialize repository — ${message}`);
        }
        process.exitCode = 1;
      }
    });
}
