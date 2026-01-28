/**
 * MCP Server Extensibility Types
 *
 * Defines configuration types for external MCP (Model Context Protocol)
 * servers that can be injected into agent sessions via per-repo config.
 */

/**
 * Configuration for an MCP server loaded from `.cocopilot/config.json`.
 *
 * This is the user-facing config format. It gets translated to the SDK's
 * internal MCPServerConfig when injected into a Copilot session.
 */
export interface MCPServerConfig {
  /** Unique name identifying this MCP server. */
  name: string;

  /** Server URL or command path (for stdio transport). */
  url: string;

  /** Transport protocol for communicating with the server. */
  transport: "stdio" | "sse";

  /** Optional environment variables passed to the MCP server process. */
  env?: Record<string, string>;
}

/**
 * Result of validating an MCP server configuration.
 */
export interface MCPValidationResult {
  /** Whether the server configuration is valid and reachable. */
  valid: boolean;

  /** Error message if validation failed. */
  error?: string;
}
