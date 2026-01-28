/**
 * GitHub MCP Server Configuration
 *
 * Provides the MCP server configuration object that agents use to access
 * the GitHub API through the Copilot SDK. This configuration is passed
 * to CopilotClientWrapper or individual session options.
 */

import type { MCPServerConfig } from "../copilot/types.js";

/** Default GitHub MCP server URL used by Copilot CLI. */
const DEFAULT_GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";

/** Configuration options for the GitHub MCP server. */
export interface GitHubMCPOptions {
  /** Override the default MCP server URL. */
  url?: string;
  /**
   * Tool filter: which tools to make available from the MCP server.
   * Defaults to ["*"] (all tools).
   */
  tools?: string[];
}

/**
 * Returns the MCP server configuration for the GitHub MCP server.
 *
 * This config is designed to be spread into the `mcpServers` record
 * when creating a CopilotClientWrapper or session.
 *
 * @example
 * ```ts
 * const wrapper = new CopilotClientWrapper({
 *   agentName: "chocolatier",
 *   mcpServers: {
 *     ...getGitHubMCPConfig(),
 *   },
 * });
 * ```
 */
export function getGitHubMCPConfig(
  options?: GitHubMCPOptions,
): Record<string, MCPServerConfig> {
  const url = options?.url ?? DEFAULT_GITHUB_MCP_URL;

  const tools = options?.tools ?? ["*"];

  const config: MCPServerConfig = {
    type: "http",
    url,
    tools,
  };

  return { github: config };
}
