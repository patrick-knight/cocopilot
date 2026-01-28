import { Command } from "commander";

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

      console.log(`Initializing repository: ${name}`);
      console.log(`URL: ${repoUrl}`);

      // TODO: Clone/register repository, set up worktrees, configure tracking
      console.log(`Repository "${name}" initialized successfully.`);
    });
}
