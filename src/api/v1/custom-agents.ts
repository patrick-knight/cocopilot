/**
 * Custom Agents API routes.
 *
 * Provides endpoints for managing user-defined custom agents:
 *   GET  /repositories/:repoName/custom-agents        — List custom agents
 *   POST /repositories/:repoName/custom-agents/:name/start  — Start agent
 *   POST /repositories/:repoName/custom-agents/:name/stop   — Stop agent
 *   GET  /repositories/:repoName/custom-agents/:name/status — Get agent status
 */

import { Router } from "express";
import * as path from "node:path";
import type { StateManager } from "../../state/index.js";
import { loadAllAgents, parseAgentDefinition } from "../../agents/custom-loader.js";
import { CustomAgent } from "../../agents/custom-agent.js";

// In-memory registry of running custom agents (keyed by `${repoName}:${agentName}`)
const runningAgents = new Map<string, CustomAgent>();

export interface CustomAgentsDeps {
  stateManager: StateManager;
}

interface RepoParams {
  repoName: string;
}

interface AgentParams extends RepoParams {
  name: string;
}

/**
 * Create routes for custom agent management.
 */
export function customAgentsRoutes(deps: CustomAgentsDeps): Router {
  const { stateManager } = deps;
  const router = Router({ mergeParams: true });

  // GET /repositories/:repoName/custom-agents — List all custom agents
  router.get("/", async (req, res) => {
    const { repoName } = req.params as unknown as RepoParams;
    const repos = stateManager.getRepos();
    const repo = repos[repoName];

    if (!repo) {
      res.status(404).json({ error: `Repository "${repoName}" not found.` });
      return;
    }

    const agentsDir = path.join(repo.localPath, ".cocopilot", "agents");

    try {
      const definitions = await loadAllAgents(agentsDir);
      const agents = definitions.map((def) => {
        const key = `${repoName}:${def.name}`;
        const running = runningAgents.get(key);
        return {
          name: def.name,
          class: def.class,
          tools: def.tools,
          status: running?.getStatus().status ?? "stopped",
          filePath: def.filePath,
        };
      });

      res.json({ agents });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to load agents: ${message}` });
    }
  });

  // POST /repositories/:repoName/custom-agents/:name/start — Start agent
  router.post("/:name/start", async (req, res) => {
    const { repoName, name } = req.params as unknown as AgentParams;
    const { model } = req.body as { model?: string };

    const repos = stateManager.getRepos();
    const repo = repos[repoName];

    if (!repo) {
      res.status(404).json({ error: `Repository "${repoName}" not found.` });
      return;
    }

    const key = `${repoName}:${name}`;

    // Check if already running
    const existing = runningAgents.get(key);
    if (existing && existing.getStatus().status === "running") {
      res.status(409).json({ error: `Agent "${name}" is already running.`, status: "running" });
      return;
    }

    // Load the agent definition
    const agentFile = path.join(repo.localPath, ".cocopilot", "agents", `${name}.md`);

    try {
      const def = await parseAgentDefinition(agentFile);
      const agent = new CustomAgent(def, { model });

      await agent.start();
      runningAgents.set(key, agent);

      res.status(200).json({
        name: agent.name,
        status: agent.getStatus().status,
        message: `Agent "${name}" started successfully.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to start agent: ${message}` });
    }
  });

  // POST /repositories/:repoName/custom-agents/:name/stop — Stop agent
  router.post("/:name/stop", async (req, res) => {
    const { repoName, name } = req.params as unknown as AgentParams;
    const key = `${repoName}:${name}`;

    const agent = runningAgents.get(key);
    if (!agent) {
      res.status(404).json({ error: `Agent "${name}" is not running.` });
      return;
    }

    try {
      await agent.stop();
      runningAgents.delete(key);

      res.status(200).json({
        name,
        status: "stopped",
        message: `Agent "${name}" stopped successfully.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to stop agent: ${message}` });
    }
  });

  // GET /repositories/:repoName/custom-agents/:name/status — Get agent status
  router.get("/:name/status", async (req, res) => {
    const { repoName, name } = req.params as unknown as AgentParams;
    const key = `${repoName}:${name}`;

    const agent = runningAgents.get(key);
    if (agent) {
      res.json(agent.getStatus());
      return;
    }

    // Check if definition exists
    const repos = stateManager.getRepos();
    const repo = repos[repoName];
    if (!repo) {
      res.status(404).json({ error: `Repository "${repoName}" not found.` });
      return;
    }

    const agentFile = path.join(repo.localPath, ".cocopilot", "agents", `${name}.md`);
    try {
      const def = await parseAgentDefinition(agentFile);
      res.json({
        name: def.name,
        class: def.class,
        tools: def.tools,
        status: "stopped",
        filePath: def.filePath,
        startedAt: null,
        uptimeMs: null,
        error: null,
      });
    } catch {
      res.status(404).json({ error: `Agent "${name}" not found.` });
    }
  });

  return router;
}
