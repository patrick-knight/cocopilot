/**
 * CoCoPilot Copilot SDK Integration Types
 *
 * Configuration interfaces for the CopilotClient wrapper that bridges
 * the @github/copilot-sdk with CoCoPilot's messaging infrastructure.
 */

import type {
  CopilotClientOptions,
  SessionConfig,
  MCPServerConfig,
  Tool,
  SessionEvent,
  SessionEventHandler,
  SystemMessageConfig,
  PermissionHandler,
  ConnectionState,
} from "@github/copilot-sdk";

// Re-export SDK types consumers will need
export type {
  SessionEvent,
  SessionEventHandler,
  Tool,
  MCPServerConfig,
  ConnectionState,
  SystemMessageConfig,
  PermissionHandler,
  CopilotClientOptions,
  SessionConfig,
};

/**
 * Custom API provider configuration (BYOK - Bring Your Own Key).
 * Compatible with the SDK's internal ProviderConfig type.
 */
export interface ProviderConfig {
  /** Provider type. Defaults to "openai" for generic OpenAI-compatible APIs. */
  type?: "openai" | "azure" | "anthropic";
  /** API format (openai/azure only). */
  wireApi?: "completions" | "responses";
  /** API endpoint URL. */
  baseUrl: string;
  /** API key. Optional for local providers like Ollama. */
  apiKey?: string;
  /** Bearer token for authentication. Takes precedence over apiKey. */
  bearerToken?: string;
  /** Azure-specific options. */
  azure?: { apiVersion?: string };
}

/**
 * Configuration for the CoCoPilot Copilot client wrapper.
 * Extends SDK client options with CoCoPilot-specific settings.
 */
export interface CopilotWrapperConfig {
  /** Name of this agent (used for Redis stream channels). */
  agentName: string;

  /**
   * Default model for new sessions.
   * @default "claude-sonnet-4-5"
   */
  model?: string;

  /**
   * Options passed to the underlying CopilotClient constructor.
   * Includes cliPath, cliUrl, port, useStdio, logLevel, etc.
   */
  clientOptions?: CopilotClientOptions;

  /**
   * MCP servers to configure on every session created by this wrapper.
   * Keys are server names, values are server configurations.
   */
  mcpServers?: Record<string, MCPServerConfig>;

  /**
   * Custom tools to register on every session created by this wrapper.
   * These are merged with any session-specific tools.
   */
  defaultTools?: Tool[];

  /**
   * System message configuration for sessions.
   */
  systemMessage?: SystemMessageConfig;

  /**
   * Whether to enable streaming events.
   * @default true
   */
  streaming?: boolean;

  /**
   * Whether to automatically reconnect on connection errors.
   * @default true
   */
  autoReconnect?: boolean;

  /**
   * Maximum number of reconnection attempts before giving up.
   * @default 5
   */
  maxReconnectAttempts?: number;

  /**
   * Base delay between reconnection attempts in milliseconds.
   * Uses exponential backoff: delay * 2^attempt, capped at 30s.
   * @default 1000
   */
  reconnectDelayMs?: number;

  /**
   * Handler for permission requests from the Copilot CLI.
   * If not provided, all permissions are auto-approved.
   */
  onPermissionRequest?: PermissionHandler;

  /**
   * Custom BYOK provider configuration.
   * When set, uses the provided API endpoint instead of the Copilot API.
   */
  provider?: ProviderConfig;

  /**
   * Convenience shorthand for BYOK API key.
   * When set, injects the key into the provider config's `apiKey` field.
   * If a `provider` is also specified, this value is merged into it.
   */
  apiKey?: string;
}

/**
 * Options for creating a session through the CoCoPilot wrapper.
 * Session-specific overrides for the wrapper's defaults.
 */
export interface CopilotSessionOptions {
  /** Override the default model for this session. */
  model?: string;

  /** Additional tools for this session (merged with wrapper defaults). */
  tools?: Tool[];

  /** Additional MCP servers for this session (merged with wrapper defaults). */
  mcpServers?: Record<string, MCPServerConfig>;

  /** Override system message for this session. */
  systemMessage?: SystemMessageConfig;

  /** Override streaming for this session. */
  streaming?: boolean;

  /** Override provider for this session. */
  provider?: ProviderConfig;

  /** Override API key for this session (merged into provider config). */
  apiKey?: string;

  /** Override permission handler for this session. */
  onPermissionRequest?: PermissionHandler;

  /** Custom session ID. If not provided, the server generates one. */
  sessionId?: string;
}

/**
 * Streaming event published to Redis for the dashboard.
 * Wraps SDK SessionEvents with CoCoPilot metadata.
 */
export interface StreamEvent {
  /** The type of stream event. */
  type: "output" | "tool_call" | "tool_result" | "error" | "status";

  /** The content of the event. */
  content: string;

  /** Unix epoch timestamp in milliseconds. */
  timestamp: number;

  /** The agent that generated this event. */
  agent: string;

  /** The session ID this event belongs to. */
  sessionId: string;

  /** Original SDK event type for detailed processing. */
  eventType: string;
}

/**
 * Callback invoked when the wrapper's connection state changes.
 */
export type ConnectionStateHandler = (
  state: ConnectionState,
  error?: Error,
) => void;

/**
 * Tracked session metadata within the wrapper.
 */
export interface ManagedSession {
  /** Session ID from the SDK. */
  sessionId: string;

  /** Model used for this session. */
  model: string;

  /** When the session was created. */
  createdAt: number;

  /** Unsubscribe function for the session's event handler. */
  unsubscribe: () => void;
}

/**
 * Copilot SDK Tool Definition Types
 *
 * Type definitions mirroring the @github/copilot-sdk `defineTool` API.
 * These types allow implementing Copilot-compatible tools without a
 * direct SDK dependency, making the tools testable and portable.
 */

/** JSON Schema property definition for tool parameters. */
export interface JSONSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
}

/** JSON Schema object definition for tool parameters. */
export interface JSONSchemaObject {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

/**
 * A Copilot SDK tool definition returned by defineTool.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface CopilotToolDefinition<TParams = any, TResult = any> {
  name: string;
  description: string;
  parameters: JSONSchemaObject;
  handler: (params: TParams) => Promise<TResult>;
}

/** Configuration passed to defineTool (excludes the name which is the first arg). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface DefineToolConfig<TParams = any, TResult = any> {
  description: string;
  parameters: JSONSchemaObject;
  handler: (params: TParams) => Promise<TResult>;
}

/**
 * Create a Copilot SDK tool definition.
 *
 * Matches the `defineTool(name, config)` API from `@github/copilot-sdk`.
 * Each tool has a JSON Schema for its parameters and an async handler.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineTool<TParams = any, TResult = any>(
  name: string,
  config: DefineToolConfig<TParams, TResult>,
): CopilotToolDefinition<TParams, TResult> {
  return {
    name,
    description: config.description,
    parameters: config.parameters,
    handler: config.handler,
  };
}
