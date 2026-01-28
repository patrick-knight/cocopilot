/**
 * Custom Agent
 *
 * Wraps CopilotClientWrapper with a parsed agent definition from
 * .cocopilot/agents/*.md files. Manages the lifecycle of a user-defined
 * agent with start/stop/status semantics.
 */

import { CopilotClientWrapper } from "../copilot/client.js";
import type { CopilotWrapperConfig } from "../copilot/types.js";
import type { ParsedAgentDef } from "./custom-loader.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Runtime status of a custom agent. */
export type CustomAgentStatus = "stopped" | "starting" | "running" | "error";

/** Configuration options for CustomAgent beyond the parsed definition. */
export interface CustomAgentOptions {
  /** Override the model for this agent's sessions. */
  model?: string;
  /** Additional CopilotClientWrapper config. */
  clientConfig?: Partial<CopilotWrapperConfig>;
}

// ---------------------------------------------------------------------------
// CustomAgent
// ---------------------------------------------------------------------------

/**
 * CustomAgent wraps a CopilotClientWrapper with configuration derived
 * from a parsed agent definition file.
 *
 * Lifecycle:
 *   new CustomAgent(def) -> start() -> [running] -> stop() -> [stopped]
 */
export class CustomAgent {
  private readonly def: ParsedAgentDef;
  private readonly options: CustomAgentOptions;
  private client: CopilotClientWrapper | null = null;
  private _status: CustomAgentStatus = "stopped";
  private _error: Error | null = null;
  private _startedAt: number | null = null;

  constructor(def: ParsedAgentDef, options: CustomAgentOptions = {}) {
    this.def = Object.freeze({ ...def });
    this.options = options;
  }

  // -----------------------------------------------------------------------
  // Read-only accessors
  // -----------------------------------------------------------------------

  /** Agent name from the definition. */
  get name(): string {
    return this.def.name;
  }

  /** Agent lifecycle class (persistent/ephemeral). */
  get agentClass(): ParsedAgentDef["class"] {
    return this.def.class;
  }

  /** Tool names configured for this agent. */
  get tools(): readonly string[] {
    return this.def.tools;
  }

  /** System prompt from the definition body. */
  get systemPrompt(): string {
    return this.def.systemPrompt;
  }

  /** Source file path for this agent's definition. */
  get filePath(): string {
    return this.def.filePath;
  }

  /** The underlying CopilotClientWrapper, if started. */
  get copilotClient(): CopilotClientWrapper | null {
    return this.client;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the custom agent.
   *
   * Creates and starts a CopilotClientWrapper configured with the
   * agent definition's system prompt and tools.
   *
   * @throws If the agent is already running.
   */
  async start(): Promise<void> {
    if (this._status === "running" || this._status === "starting") {
      throw new Error(`Agent "${this.def.name}" is already ${this._status}.`);
    }

    this._status = "starting";
    this._error = null;

    try {
      const wrapperConfig: CopilotWrapperConfig = {
        agentName: this.def.name,
        model: this.options.model,
        systemMessage: { mode: "replace" as const, content: this.def.systemPrompt },
        ...this.options.clientConfig,
      };

      this.client = new CopilotClientWrapper(wrapperConfig);
      await this.client.start();

      this._status = "running";
      this._startedAt = Date.now();
    } catch (err: unknown) {
      this._status = "error";
      this._error = err instanceof Error ? err : new Error(String(err));
      throw this._error;
    }
  }

  /**
   * Stop the custom agent.
   *
   * Gracefully stops the CopilotClientWrapper and cleans up resources.
   */
  async stop(): Promise<void> {
    if (this._status === "stopped") {
      return;
    }

    try {
      if (this.client) {
        await this.client.stop();
        this.client = null;
      }
    } finally {
      this._status = "stopped";
      this._startedAt = null;
    }
  }

  /**
   * Get the current status of the custom agent.
   *
   * Returns a snapshot including lifecycle state, uptime, and any error.
   */
  getStatus(): {
    name: string;
    class: ParsedAgentDef["class"];
    status: CustomAgentStatus;
    tools: readonly string[];
    filePath: string;
    startedAt: number | null;
    uptimeMs: number | null;
    error: string | null;
  } {
    return {
      name: this.def.name,
      class: this.def.class,
      status: this._status,
      tools: this.def.tools,
      filePath: this.def.filePath,
      startedAt: this._startedAt,
      uptimeMs:
        this._startedAt !== null ? Date.now() - this._startedAt : null,
      error: this._error?.message ?? null,
    };
  }
}
