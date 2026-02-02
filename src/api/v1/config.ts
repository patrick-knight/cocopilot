/**
 * Config API — system configuration management.
 *
 * GET  /api/v1/config           — Get current configuration
 * PUT  /api/v1/config           — Update configuration
 * GET  /api/v1/config/keys      — Get API key status (masked)
 * PUT  /api/v1/config/keys      — Set API keys (BYOK)
 * GET  /api/v1/config/limits    — Get container resource limits
 * PUT  /api/v1/config/limits    — Update container resource limits
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

export interface ApiKeys {
  openaiKey?: string;
  anthropicKey?: string;
  azureEndpoint?: string;
  azureKey?: string;
  azureDeployment?: string;
  customBaseUrl?: string;
  customApiKey?: string;
}

export interface ContainerLimits {
  memory: string;
  cpu: string;
  pidsLimit?: number;
  networkEnabled?: boolean;
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
  containerLimits?: ContainerLimits;
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
  containerLimits: {
    memory: "4g",
    cpu: "2",
    pidsLimit: 256,
    networkEnabled: true,
  },
};

const DEFAULT_CONTAINER_LIMITS: ContainerLimits = {
  memory: "4g",
  cpu: "2",
  pidsLimit: 256,
  networkEnabled: true,
};

function getConfigPath(): string {
  return path.join(getCocopilotDir(), "config.json");
}

function getKeysPath(): string {
  return path.join(getCocopilotDir(), "keys.json");
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

/**
 * Load API keys from separate secure file.
 */
function loadApiKeys(): ApiKeys {
  try {
    const keysPath = getKeysPath();
    if (fs.existsSync(keysPath)) {
      const data = fs.readFileSync(keysPath, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // Ignore errors, return empty
  }
  return {};
}

/**
 * Save API keys to separate secure file.
 */
function saveApiKeys(keys: ApiKeys): void {
  const keysPath = getKeysPath();
  const dir = path.dirname(keysPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(keysPath, JSON.stringify(keys, null, 2), { encoding: "utf-8", mode: 0o600 });
}

/**
 * Mask an API key for display (show first 4 and last 4 chars).
 */
function maskKey(key: string | undefined): string | undefined {
  if (!key || key.length < 12) return key ? "***" : undefined;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/**
 * Get API keys with values masked for safe display.
 */
export function getMaskedApiKeys(): Record<string, string | undefined> {
  const keys = loadApiKeys();
  return {
    openaiKey: maskKey(keys.openaiKey),
    anthropicKey: maskKey(keys.anthropicKey),
    azureEndpoint: keys.azureEndpoint, // URLs don't need masking
    azureKey: maskKey(keys.azureKey),
    azureDeployment: keys.azureDeployment,
    customBaseUrl: keys.customBaseUrl,
    customApiKey: maskKey(keys.customApiKey),
  };
}

/**
 * Get raw API keys (for internal use only).
 */
export function getApiKeys(): ApiKeys {
  return loadApiKeys();
}

/**
 * Get container resource limits.
 */
export function getContainerLimits(): ContainerLimits {
  const config = loadConfig();
  return config.containerLimits ?? DEFAULT_CONTAINER_LIMITS;
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
        containerLimits: {
          ...DEFAULT_CONTAINER_LIMITS,
          ...(req.body.containerLimits || {}),
        },
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

  // GET /keys — Get API key status (masked)
  router.get("/keys", (_req, res) => {
    const maskedKeys = getMaskedApiKeys();
    const hasKeys = Object.values(maskedKeys).some(v => v !== undefined);
    res.json({
      configured: hasKeys,
      keys: maskedKeys,
    });
  });

  // PUT /keys — Set API keys (BYOK)
  router.put("/keys", (req, res) => {
    try {
      const existingKeys = loadApiKeys();
      const newKeys: ApiKeys = { ...existingKeys };

      // Only update provided keys (allow partial updates)
      if (req.body.openaiKey !== undefined) newKeys.openaiKey = req.body.openaiKey || undefined;
      if (req.body.anthropicKey !== undefined) newKeys.anthropicKey = req.body.anthropicKey || undefined;
      if (req.body.azureEndpoint !== undefined) newKeys.azureEndpoint = req.body.azureEndpoint || undefined;
      if (req.body.azureKey !== undefined) newKeys.azureKey = req.body.azureKey || undefined;
      if (req.body.azureDeployment !== undefined) newKeys.azureDeployment = req.body.azureDeployment || undefined;
      if (req.body.customBaseUrl !== undefined) newKeys.customBaseUrl = req.body.customBaseUrl || undefined;
      if (req.body.customApiKey !== undefined) newKeys.customApiKey = req.body.customApiKey || undefined;

      saveApiKeys(newKeys);

      res.json({
        success: true,
        message: "API keys updated",
        keys: getMaskedApiKeys(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // DELETE /keys — Clear all API keys
  router.delete("/keys", (_req, res) => {
    try {
      saveApiKeys({});
      res.json({ success: true, message: "All API keys cleared" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // GET /limits — Get container resource limits
  router.get("/limits", (_req, res) => {
    const limits = getContainerLimits();
    res.json(limits);
  });

  // PUT /limits — Update container resource limits
  router.put("/limits", (req, res) => {
    try {
      const config = loadConfig();
      const newLimits: ContainerLimits = {
        ...DEFAULT_CONTAINER_LIMITS,
        ...config.containerLimits,
        ...req.body,
      };

      // Validate memory format (e.g., "4g", "512m")
      if (newLimits.memory && !/^\d+[gmkGMK]?$/.test(newLimits.memory)) {
        res.status(400).json({ error: 'memory must be in format like "4g" or "512m"' });
        return;
      }

      // Validate CPU format (e.g., "2", "0.5")
      if (newLimits.cpu && !/^\d+(\.\d+)?$/.test(newLimits.cpu)) {
        res.status(400).json({ error: 'cpu must be a number like "2" or "0.5"' });
        return;
      }

      config.containerLimits = newLimits;
      saveConfig(config);

      res.json({ success: true, limits: newLimits });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
