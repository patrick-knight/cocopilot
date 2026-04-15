/**
 * CoCoPilot Copilot Client Wrapper
 *
 * Wraps @github/copilot-sdk's CopilotClient with CoCoPilot-specific
 * functionality: Redis streaming for the dashboard, configurable defaults,
 * and automatic reconnection.
 */

import {
  CopilotClient,
  CopilotSession,
  defineTool,
  approveAll,
} from "@github/copilot-sdk";
import type {
  SessionConfig,
  SessionEvent,
  Tool,
  ConnectionState,
} from "@github/copilot-sdk";

import type { RedisMessageBus } from "../messaging/redis-bus.js";
import { streamChannel } from "../messaging/types.js";

import type {
  CopilotWrapperConfig,
  CopilotSessionOptions,
  StreamEvent,
  ConnectionStateHandler,
  ManagedSession,
} from "./types.js";

// Re-export defineTool for convenience
export { defineTool };

const DEFAULT_MODEL = "claude-sonnet-4-5";
const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * CoCoPilot's wrapper around the Copilot SDK client.
 *
 * Provides:
 * - Session creation with merged default tools and MCP servers
 * - Automatic streaming of session events to Redis for the dashboard
 * - Configurable model selection with per-session overrides
 * - Connection lifecycle management with automatic reconnection
 */
export class CopilotClientWrapper {
  private client: CopilotClient;
  private readonly config: Required<
    Pick<
      CopilotWrapperConfig,
      | "agentName"
      | "model"
      | "streaming"
      | "autoReconnect"
      | "maxReconnectAttempts"
      | "reconnectDelayMs"
    >
  > &
    CopilotWrapperConfig;
  private redisBus: RedisMessageBus | null;
  private sessions: Map<string, ManagedSession> = new Map();
  private connectionStateHandlers: Set<ConnectionStateHandler> = new Set();
  private reconnectAttempts = 0;
  private reconnecting = false;
  private stopped = false;

  constructor(config: CopilotWrapperConfig, redisBus?: RedisMessageBus) {
    this.config = {
      model: DEFAULT_MODEL,
      streaming: true,
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelayMs: 1000,
      ...config,
    };

    this.redisBus = redisBus ?? null;
    this.client = new CopilotClient(config.clientOptions ?? {});
  }

  /**
   * Start the underlying Copilot CLI server connection.
   * Must be called before creating sessions (unless autoStart is enabled
   * on the CopilotClient).
   */
  async start(): Promise<void> {
    this.stopped = false;
    this.reconnectAttempts = 0;
    await this.client.start();
    this.emitConnectionState("connected");
  }

  /**
   * Create a new Copilot session with CoCoPilot defaults merged in.
   *
   * Tools, MCP servers, and other config from the wrapper's defaults
   * are merged with session-specific overrides.
   */
  async createSession(
    options: CopilotSessionOptions = {},
  ): Promise<CopilotSession> {
    const mergedTools = this.mergeTools(options.tools);
    const mergedMcpServers = this.mergeMcpServers(options.mcpServers);

    const provider = this.resolveProvider(
      options.provider ?? this.config.provider,
      options.apiKey ?? this.config.apiKey,
    );

    const permissionHandler =
      options.onPermissionRequest ?? this.config.onPermissionRequest ?? approveAll;

    const sessionConfig: SessionConfig = {
      sessionId: options.sessionId,
      model: options.model ?? this.config.model,
      streaming: options.streaming ?? this.config.streaming,
      tools: mergedTools.length > 0 ? mergedTools : undefined,
      mcpServers:
        Object.keys(mergedMcpServers).length > 0
          ? mergedMcpServers
          : undefined,
      systemMessage: options.systemMessage ?? this.config.systemMessage,
      provider: provider as SessionConfig["provider"],
      onPermissionRequest: permissionHandler,
    };

    const session = await this.client.createSession(sessionConfig);

    // Subscribe to events for Redis streaming
    const unsubscribe = session.on((event: SessionEvent) => {
      this.handleSessionEvent(session.sessionId, event);
    });

    const managed: ManagedSession = {
      sessionId: session.sessionId,
      model: sessionConfig.model ?? this.config.model,
      createdAt: Date.now(),
      unsubscribe,
    };

    this.sessions.set(session.sessionId, managed);

    return session;
  }

  /**
   * Resume an existing session by ID.
   */
  async resumeSession(
    sessionId: string,
    options: CopilotSessionOptions = {},
  ): Promise<CopilotSession> {
    const mergedTools = this.mergeTools(options.tools);

    const resumeProvider = this.resolveProvider(
      options.provider ?? this.config.provider,
      options.apiKey ?? this.config.apiKey,
    );

    const session = await this.client.resumeSession(sessionId, {
      tools: mergedTools.length > 0 ? mergedTools : undefined,
      mcpServers: this.mergeMcpServers(options.mcpServers),
      streaming: options.streaming ?? this.config.streaming,
      provider: resumeProvider as SessionConfig["provider"],
      onPermissionRequest:
        options.onPermissionRequest ?? this.config.onPermissionRequest ?? approveAll,
    });

    const unsubscribe = session.on((event: SessionEvent) => {
      this.handleSessionEvent(session.sessionId, event);
    });

    const managed: ManagedSession = {
      sessionId: session.sessionId,
      model: options.model ?? this.config.model,
      createdAt: Date.now(),
      unsubscribe,
    };

    this.sessions.set(session.sessionId, managed);

    return session;
  }

  /**
   * Destroy a managed session and clean up its resources.
   */
  async destroySession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (managed) {
      managed.unsubscribe();
      this.sessions.delete(sessionId);
    }

    try {
      await this.client.deleteSession(sessionId);
    } catch {
      // Session may already be destroyed; ignore
    }
  }

  /**
   * Gracefully stop the client and all managed sessions.
   */
  async stop(): Promise<void> {
    this.stopped = true;

    // Unsubscribe all session event handlers
    for (const managed of this.sessions.values()) {
      managed.unsubscribe();
    }
    this.sessions.clear();

    const errors = await this.client.stop();
    if (errors.length > 0) {
      // If graceful stop had errors, force stop
      await this.client.forceStop();
    }

    this.emitConnectionState("disconnected");
  }

  /**
   * Get the current connection state of the underlying client.
   */
  getState(): ConnectionState {
    return this.client.getState();
  }

  /**
   * Register a handler for connection state changes.
   * Returns an unsubscribe function.
   */
  onConnectionStateChange(handler: ConnectionStateHandler): () => void {
    this.connectionStateHandlers.add(handler);
    return () => {
      this.connectionStateHandlers.delete(handler);
    };
  }

  /**
   * Ping the Copilot CLI server to verify connectivity.
   */
  async ping(): Promise<{ message: string; timestamp: number }> {
    return this.client.ping("cocopilot-health-check");
  }

  /**
   * List available models from the Copilot server.
   */
  async listModels() {
    return this.client.listModels();
  }

  /**
   * Get the set of currently managed session IDs.
   */
  getManagedSessions(): Map<string, ManagedSession> {
    return new Map(this.sessions);
  }

  /**
   * The agent name this wrapper is configured for.
   */
  get agentName(): string {
    return this.config.agentName;
  }

  /**
   * The default model for new sessions.
   */
  get defaultModel(): string {
    return this.config.model;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve a provider config, injecting an apiKey if provided.
   * Returns undefined if neither provider nor apiKey is set.
   */
  private resolveProvider(
    provider?: import("./types.js").ProviderConfig,
    apiKey?: string,
  ): import("./types.js").ProviderConfig | undefined {
    if (!provider && !apiKey) return undefined;

    if (apiKey && !provider) {
      // apiKey without explicit provider — create a minimal provider config.
      // The SDK will use the key with its default endpoint.
      return { apiKey, baseUrl: "" } as import("./types.js").ProviderConfig;
    }

    if (apiKey && provider) {
      return { ...provider, apiKey };
    }

    return provider;
  }

  /**
   * Merge wrapper-level default tools with session-specific tools.
   * Session tools take precedence (by name) over defaults.
   */
  private mergeTools(sessionTools?: Tool[]): Tool[] {
    const defaults = this.config.defaultTools ?? [];
    if (!sessionTools || sessionTools.length === 0) return [...defaults];

    const sessionToolNames = new Set(sessionTools.map((t) => t.name));
    const filtered = defaults.filter((t) => !sessionToolNames.has(t.name));

    return [...filtered, ...sessionTools];
  }

  /**
   * Merge wrapper-level MCP servers with session-specific servers.
   * Session servers override defaults with the same name.
   */
  private mergeMcpServers(
    sessionServers?: Record<string, import("@github/copilot-sdk").MCPServerConfig>,
  ): Record<string, import("@github/copilot-sdk").MCPServerConfig> {
    return {
      ...(this.config.mcpServers ?? {}),
      ...(sessionServers ?? {}),
    };
  }

  /**
   * Handle a session event: publish to Redis stream channel for the dashboard.
   */
  private handleSessionEvent(sessionId: string, event: SessionEvent): void {
    if (!this.redisBus?.isReady) return;

    const streamEvt = this.toStreamEvent(sessionId, event);
    if (!streamEvt) return;

    const channel = streamChannel(this.config.agentName);
    const raw = JSON.stringify(streamEvt);

    // Fire-and-forget; don't block the event handler
    this.redisBus
      .publish({
        id: event.id,
        type: "BROADCAST" as any,
        from: this.config.agentName,
        to: "*",
        payload: { message: raw } as any,
        priority: "low",
        timestamp: Date.now(),
        ack_required: false,
      })
      .catch(() => {
        // Swallow Redis errors — streaming is best-effort
      });

    // Publish directly to the stream channel for live worker output.
    this.redisBus
      .publishRaw(channel, raw)
      .catch(() => {
        // Swallow Redis errors — streaming is best-effort
      });
  }

  /**
   * Convert an SDK SessionEvent to a CoCoPilot StreamEvent for the dashboard.
   * Returns null for event types we don't stream.
   */
  private toStreamEvent(
    sessionId: string,
    event: SessionEvent,
  ): StreamEvent | null {
    const base = {
      timestamp: Date.now(),
      agent: this.config.agentName,
      sessionId,
      eventType: event.type,
    };

    switch (event.type) {
      case "assistant.message_delta":
        return {
          ...base,
          type: "output",
          content: event.data.deltaContent,
        };

      case "assistant.message":
        return {
          ...base,
          type: "output",
          content: event.data.content,
        };

      case "tool.execution_start":
        return {
          ...base,
          type: "tool_call",
          content: JSON.stringify({
            toolName: event.data.toolName,
            toolCallId: event.data.toolCallId,
            arguments: event.data.arguments,
          }),
        };

      case "tool.execution_complete":
        return {
          ...base,
          type: "tool_result",
          content: JSON.stringify({
            toolCallId: event.data.toolCallId,
            success: event.data.success,
            result: event.data.result,
            error: event.data.error,
          }),
        };

      case "session.error":
        this.handleError(new Error(event.data.message));
        return {
          ...base,
          type: "error",
          content: event.data.message,
        };

      case "session.start":
      case "session.resume":
      case "session.idle":
        return {
          ...base,
          type: "status",
          content: event.type,
        };

      default:
        // Don't stream ephemeral/internal events
        return null;
    }
  }

  /**
   * Handle connection errors with optional automatic reconnection.
   */
  private handleError(error: Error): void {
    this.emitConnectionState("error", error);

    if (
      this.config.autoReconnect &&
      !this.stopped &&
      !this.reconnecting &&
      this.reconnectAttempts < this.config.maxReconnectAttempts
    ) {
      this.attemptReconnect();
    }
  }

  /**
   * Attempt to reconnect to the Copilot CLI server with exponential backoff.
   */
  private async attemptReconnect(): Promise<void> {
    if (this.reconnecting || this.stopped) return;

    this.reconnecting = true;
    this.reconnectAttempts++;

    const delay = Math.min(
      this.config.reconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS,
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    if (this.stopped) {
      this.reconnecting = false;
      return;
    }

    try {
      this.emitConnectionState("connecting");

      // Stop existing client, create fresh one
      try {
        await this.client.forceStop();
      } catch {
        // Ignore errors during cleanup
      }

      this.client = new CopilotClient(this.config.clientOptions ?? {});
      await this.client.start();

      this.reconnectAttempts = 0;
      this.reconnecting = false;
      this.emitConnectionState("connected");
    } catch (err) {
      this.reconnecting = false;

      if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
        this.attemptReconnect();
      } else {
        this.emitConnectionState(
          "error",
          new Error(
            `Failed to reconnect after ${this.config.maxReconnectAttempts} attempts: ${err}`,
          ),
        );
      }
    }
  }

  /**
   * Notify all connection state handlers of a state change.
   */
  private emitConnectionState(
    state: ConnectionState,
    error?: Error,
  ): void {
    for (const handler of this.connectionStateHandlers) {
      try {
        handler(state, error);
      } catch {
        // Don't let handler errors break the client
      }
    }
  }
}
