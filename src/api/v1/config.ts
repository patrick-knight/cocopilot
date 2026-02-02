/**
 * Config API — system configuration management.
 *
 * GET  /api/v1/config     — Get current configuration
 * PUT  /api/v1/config     — Update configuration
 */

import { Router } from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { getCocopilotDir } from "../../daemon/config.js";

export interface McpServer {
  name: string;
  command: string;
  args?: string[];
  enabled: boolean;
}

export interface Config {
  theme: "light" | "dark" | "system";
  workers: {
    maxConcurrent: number;
    idleTimeout: number;
    defaultModel: string;
  };
  mcpServers: McpServer[];
  daemon: {
    port: number;
    logLevel: string;
  };
}

const DEFAULT_CONFIG: Config = {
  theme: "system",
  workers: {
    maxConcurrent: 3,
    idleTimeout: 15,
    defaultModel: "",
  },
  mcpServers: [],
  daemon: {
    port: 3000,
    logLevel: "info",
  },
};

function getConfigPath(): string {
  return path.join(getCocopilotDir(), "config.json");
}

function loadConfig(): Config {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(data);
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {
    // Ignore errors, return default
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export function configRoutes(): Router {
  const router = Router();

  // GET / — Get current configuration
  router.get("/", (_req, res) => {
    const config = loadConfig();
    res.json(config);
  });

  // PUT / — Update configuration
  router.put("/", (req, res) => {
    try {
      const newConfig: Config = {
        ...DEFAULT_CONFIG,
        ...req.body,
        workers: {
          ...DEFAULT_CONFIG.workers,
          ...(req.body.workers || {}),
        },
        daemon: {
          ...DEFAULT_CONFIG.daemon,
          ...(req.body.daemon || {}),
        },
        mcpServers: req.body.mcpServers || [],
      };

      // Validate
      if (typeof newConfig.workers.maxConcurrent !== "number" || newConfig.workers.maxConcurrent < 1) {
        res.status(400).json({ error: "workers.maxConcurrent must be >= 1" });
        return;
      }
      if (typeof newConfig.workers.idleTimeout !== "number" || newConfig.workers.idleTimeout < 1) {
        res.status(400).json({ error: "workers.idleTimeout must be >= 1" });
        return;
      }
      if (!["light", "dark", "system"].includes(newConfig.theme)) {
        res.status(400).json({ error: "theme must be light, dark, or system" });
        return;
      }

      saveConfig(newConfig);
      res.json({ success: true, config: newConfig });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
