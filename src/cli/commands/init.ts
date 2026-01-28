import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

import { Command } from "commander";
import { detectFork, configureMultiplayer } from "../../github/fork-detection.js";
import { StateManager } from "../../state/state-manager.js";
import type { RepoConfig, RepoMode } from "../../state/schemas.js";
import type { ForkInfo } from "../../github/types.js";

const execFileAsync = promisify(execFile);

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

// ---------------------------------------------------------------------------
// Core initialization logic (extracted for testability)
// ---------------------------------------------------------------------------

/** Dependencies that can be injected for testing. */
export interface InitDeps {
  stateManager: StateManager;
  execFn: (
    file: string,
    args: string[],
    options?: { cwd?: string },
  ) => Promise<{ stdout: string; stderr: string }>;
  detectForkFn: (repoUrl: string) => Promise<ForkInfo>;
  mkdirFn: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  writeFileFn: (path: string, data: string) => Promise<void>;
}

/** Result of a successful repository initialization. */
export interface InitResult {
  name: string;
  url: string;
  localPath: string;
  mode: RepoMode;
  defaultBranch: string;
  forkInfo?: ForkInfo;
  /** True if fork detection was attempted but failed. */
  forkDetectionFailed: boolean;
  config: RepoConfig;
}

/**
 * Initialize a repository for CoCoPilot tracking.
 *
 * 1. Clone the repository to ~/.cocopilot/repos/<name>/clone/
 * 2. Detect fork status via GitHub API
 * 3. Configure multiplayer mode for forks (disable auto-merge, enable Enrober)
 * 4. Register the repo in StateManager
 * 5. Register initial agents (Chocolatier + Temperer or Enrober)
 * 6. Write .cocopilot/config.json inside the clone for fork configuration
 * 7. Add upstream remote for forks
 */
export async function initializeRepository(
  repoUrl: string,
  name: string,
  deps: InitDeps,
): Promise<InitResult> {
  const { stateManager, execFn, detectForkFn, mkdirFn, writeFileFn } = deps;

  // Check if already tracked
  if (stateManager.getRepo(name)) {
    throw new Error(`Repository "${name}" is already tracked`);
  }

  // Determine paths
  const baseDir = stateManager.getBaseDir();
  const repoDir = path.join(baseDir, "repos", name);
  const clonePath = path.join(repoDir, "clone");

  // Create directory structure
  await mkdirFn(repoDir, { recursive: true });

  // Clone the repository
  await execFn("git", ["clone", repoUrl, clonePath]);

  // Detect fork status
  let config: RepoConfig = {};
  let mode: RepoMode = "single-player";
  let defaultBranch = "main";
  let forkInfo: ForkInfo | undefined;
  let forkDetectionFailed = false;

  try {
    forkInfo = await detectForkFn(repoUrl);
    defaultBranch = forkInfo.defaultBranch;

    if (forkInfo.isFork) {
      config = configureMultiplayer(config, forkInfo);
      mode = "multiplayer";

      // Add upstream remote pointing to the parent repository
      const parentUrl = `https://github.com/${forkInfo.parentOwner}/${forkInfo.parentRepo}.git`;
      await execFn("git", ["remote", "add", "upstream", parentUrl], {
        cwd: clonePath,
      });
    }
  } catch {
    // Fork detection failed — continue with single-player defaults.
    // This is non-fatal: the user can manually configure mode later.
    forkDetectionFailed = true;
  }

  // Register the repository in persistent state
  await stateManager.addRepo({
    name,
    url: repoUrl,
    localPath: clonePath,
    mode,
    defaultBranch,
  });

  // Register the Chocolatier (supervisor) — always present
  await stateManager.setAgent(name, {
    name: "chocolatier",
    type: "supervisor",
    status: "starting",
  });

  // Register the mode-appropriate merge agent
  if (mode === "multiplayer") {
    await stateManager.setAgent(name, {
      name: "enrober",
      type: "pr-shepherd",
      status: "starting",
    });
  } else {
    await stateManager.setAgent(name, {
      name: "temperer",
      type: "merge-queue",
      status: "starting",
    });
  }

  // Write .cocopilot/config.json inside the clone when fork config was applied
  if (Object.keys(config).length > 0) {
    const cocopilotDir = path.join(clonePath, ".cocopilot");
    await mkdirFn(cocopilotDir, { recursive: true });
    await writeFileFn(
      path.join(cocopilotDir, "config.json"),
      JSON.stringify(config, null, 2) + "\n",
    );
  }

  // Mark the repo as active (initialization complete)
  await stateManager.updateRepoStatus(name, "active");

  return {
    name,
    url: repoUrl,
    localPath: clonePath,
    mode,
    defaultBranch,
    forkInfo: forkInfo?.isFork ? forkInfo : undefined,
    forkDetectionFailed,
    config,
  };
}

// ---------------------------------------------------------------------------
// CLI command registration
// ---------------------------------------------------------------------------

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

        // Set up real dependencies
        const stateManager = new StateManager();
        await stateManager.init();

        const deps: InitDeps = {
          stateManager,
          execFn: execFileAsync,
          detectForkFn: detectFork,
          mkdirFn: fs.promises.mkdir as InitDeps["mkdirFn"],
          writeFileFn: fs.promises.writeFile as InitDeps["writeFileFn"],
        };

        const result = await initializeRepository(repoUrl, name, deps);

        if (result.forkDetectionFailed) {
          console.warn(
            "Warning: Could not detect fork status. Continuing with default configuration.",
          );
        }

        if (result.forkInfo) {
          console.log(
            `Detected fork of ${result.forkInfo.parentOwner}/${result.forkInfo.parentRepo}`,
          );
          console.log("Configured for multiplayer mode (fork detected).");
          console.log("  - autoMerge: disabled");
          console.log("  - activeAgent: enrober");
          console.log(
            `  - upstream: ${result.forkInfo.parentOwner}/${result.forkInfo.parentRepo}`,
          );
        }

        console.log(`Repository "${name}" initialized successfully.`);
        if (result.mode === "multiplayer") {
          console.log("Mode: multiplayer (Chocolatier + Enrober)");
        } else {
          console.log("Mode: single-player (Chocolatier + Temperer)");
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("already tracked")) {
          console.error(`Error: Repository "${name}" is already tracked.`);
        } else if (message.includes("ENOENT") && message.includes("git")) {
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
