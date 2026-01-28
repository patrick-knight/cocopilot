/**
 * MCP Server Extensibility
 *
 * Provides functions to load, validate, and inject external MCP servers
 * into CoCoPilot agent sessions. MCP servers are configured per-repo
 * in `.cocopilot/config.json` under the `mcpServers` key.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { MCPServerConfig, MCPValidationResult } from "./types.js";
import type { CopilotSessionOptions } from "../copilot/types.js";

/**
 * Load MCP server configurations from a per-repo config file.
 *
 * Reads the `mcpServers` array from the JSON file at `configPath`.
 * Returns an empty array if the file doesn't exist or has no `mcpServers`.
 *
 * @param configPath - Absolute or relative path to `.cocopilot/config.json`
 * @returns Array of MCP server configurations
 */
export function loadMCPConfig(configPath: string): MCPServerConfig[] {
  const fullPath = path.resolve(configPath);

  if (!fs.existsSync(fullPath)) {
    return [];
  }

  let raw: string;
  try {
    raw = fs.readFileSync(fullPath, "utf-8");
  } catch {
    return [];
  }

  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch {
    return [];
  }

  if (
    config === null ||
    typeof config !== "object" ||
    !Array.isArray((config as Record<string, unknown>).mcpServers)
  ) {
    return [];
  }

  const servers = (config as Record<string, unknown>).mcpServers as unknown[];

  // Filter to only well-formed entries
  return servers.filter(
    (s): s is MCPServerConfig =>
      s !== null &&
      typeof s === "object" &&
      typeof (s as Record<string, unknown>).name === "string" &&
      typeof (s as Record<string, unknown>).url === "string" &&
      ((s as Record<string, unknown>).transport === "stdio" ||
        (s as Record<string, unknown>).transport === "sse"),
  );
}

/**
 * Validate an MCP server configuration.
 *
 * Checks structural validity and, for SSE transport, attempts to reach
 * the server URL with a HEAD request (5-second timeout).
 *
 * @param config - The MCP server configuration to validate
 * @returns Validation result with `valid` flag and optional `error`
 */
export async function validateServer(
  config: MCPServerConfig,
): Promise<MCPValidationResult> {
  if (!config.name || typeof config.name !== "string") {
    return { valid: false, error: "Server name is required" };
  }

  if (!config.url || typeof config.url !== "string") {
    return { valid: false, error: "Server URL is required" };
  }

  if (config.transport !== "stdio" && config.transport !== "sse") {
    return {
      valid: false,
      error: 'Transport must be "stdio" or "sse"',
    };
  }

  if (config.env !== undefined) {
    if (typeof config.env !== "object" || config.env === null) {
      return { valid: false, error: "env must be a Record<string, string>" };
    }
    for (const [key, value] of Object.entries(config.env)) {
      if (typeof key !== "string" || typeof value !== "string") {
        return {
          valid: false,
          error: "All env keys and values must be strings",
        };
      }
    }
  }

  // For SSE transport, check URL reachability
  if (config.transport === "sse") {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(config.url, {
          method: "HEAD",
          signal: controller.signal,
        });
        if (!response.ok && response.status !== 405) {
          return {
            valid: false,
            error: `Server returned HTTP ${response.status}`,
          };
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { valid: false, error: `Server unreachable: ${message}` };
    }
  }

  return { valid: true };
}

/**
 * Inject MCP servers into Copilot session options.
 *
 * Converts an array of `MCPServerConfig` (from per-repo config) into
 * the SDK's `Record<string, MCPServerConfig>` format and merges them
 * into the provided session options. Existing MCP servers in the
 * session options are preserved; new servers are added (or override
 * entries with the same name).
 *
 * @param sessionOptions - Existing session options to augment
 * @param servers - MCP server configs to inject
 * @returns New session options with MCP servers merged in
 */
export function injectServers(
  sessionOptions: CopilotSessionOptions,
  servers: MCPServerConfig[],
): CopilotSessionOptions {
  if (servers.length === 0) {
    return sessionOptions;
  }

  // Build a plain record of server entries. We use `unknown` casts because
  // our simplified config shape doesn't match the SDK's full MCPServerConfig
  // union, but the SDK accepts these properties at runtime.
  const existingServers = (sessionOptions.mcpServers ?? {}) as Record<
    string,
    unknown
  >;
  const merged: Record<string, unknown> = { ...existingServers };

  for (const server of servers) {
    merged[server.name] = {
      url: server.url,
      transport: server.transport,
      ...(server.env ? { env: server.env } : {}),
    };
  }

  return {
    ...sessionOptions,
    mcpServers: merged as unknown as CopilotSessionOptions["mcpServers"],
  };
}
