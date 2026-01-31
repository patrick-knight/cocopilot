/**
 * External integration API — repository management.
 *
 * Allows listing, creating (onboarding), and managing tracked repositories.
 *
 * GET  /api/v1/repositories       — List all tracked repositories
 * POST /api/v1/repositories       — Onboard a new repository (runs coco init)
 */

import { Router } from "express";
import { spawn } from "child_process";
import type { StateManager } from "../../state/index.js";

export interface RepositoriesDeps {
  stateManager: StateManager;
}

export function extRepositoriesRoutes(deps: RepositoriesDeps): Router {
  const { stateManager } = deps;
  const router = Router();

  // GET / — List all tracked repositories
  router.get("/", (_req, res) => {
    const repos = stateManager.getRepos();
    const repoList = Object.values(repos).map((repo) => ({
      name: repo.name,
      url: repo.url,
      defaultBranch: repo.defaultBranch,
      localPath: repo.localPath,
      mode: repo.mode,
      status: repo.status,
      workers: repo.workers,
      agents: repo.agents,
      createdAt: repo.createdAt,
      updatedAt: repo.updatedAt,
    }));
    res.json({ repositories: repoList });
  });

  // POST / — Onboard a new repository
  router.post("/", async (req, res) => {
    let { url } = req.body;

    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Missing required field: url" });
      return;
    }

    // Normalize URL: remove trailing slash and .git suffix for validation
    url = url.trim().replace(/\/$/, "");

    // Validate URL format
    const urlPattern = /^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+(\.git)?$/i;
    if (!urlPattern.test(url)) {
      res.status(400).json({ 
        error: "Invalid repository URL. Please provide a valid GitHub, GitLab, or Bitbucket URL." 
      });
      return;
    }

    try {
      // Run coco init command
      const result = await runCocoInit(url);
      
      // Reload state to pick up the new repository
      await stateManager.reloadState();
      
      // Get the newly added repo
      const repos = stateManager.getRepos();
      const repoName = extractRepoName(url);
      const newRepo = repos[repoName];

      if (newRepo) {
        res.status(201).json({
          message: "Repository onboarded successfully",
          repository: {
            name: newRepo.name,
            url: newRepo.url,
            defaultBranch: newRepo.defaultBranch,
            mode: newRepo.mode,
            status: newRepo.status,
          },
        });
      } else {
        res.status(201).json({
          message: "Repository onboarded successfully",
          output: result,
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      res.status(500).json({ 
        error: "Failed to onboard repository",
        message: errorMessage,
      });
    }
  });

  return router;
}

/**
 * Run `coco init <url>` command and return the output
 */
function runCocoInit(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("coco", ["init", url], {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to run coco init: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout || "Repository initialized successfully");
      } else {
        reject(new Error(stderr || stdout || `coco init exited with code ${code}`));
      }
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      child.kill();
      reject(new Error("coco init timed out after 60 seconds"));
    }, 60000);
  });
}

/**
 * Extract repository name from URL
 */
function extractRepoName(url: string): string {
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match ? match[1] : url;
}
