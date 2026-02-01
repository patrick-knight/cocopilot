import type { CopilotSession } from "@github/copilot-sdk";

import { CopilotClientWrapper, defineTool } from "../copilot/client.js";
import type { CopilotSessionOptions, Tool } from "../copilot/types.js";
import type { MessageBroker } from "../messaging/index.js";
import { MessageType } from "../messaging/index.js";
import type { MCPServerConfig } from "../mcp/types.js";
import { injectServers } from "../mcp/index.js";
import type { TruffleAgent } from "./truffle.js";

export interface LocalTruffleRuntimeConfig {
  truffle: TruffleAgent;
  broker: MessageBroker;
  model?: string;
  mcpServers?: MCPServerConfig[];
}

export class LocalTruffleRuntime {
  private readonly truffle: TruffleAgent;
  private readonly broker: MessageBroker;
  private readonly model?: string;
  private readonly mcpServers: MCPServerConfig[];
  private client: CopilotClientWrapper | null = null;
  private session: CopilotSession | null = null;
  private running = false;

  constructor(config: LocalTruffleRuntimeConfig) {
    this.truffle = config.truffle;
    this.broker = config.broker;
    this.model = config.model;
    this.mcpServers = config.mcpServers ?? [];
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const tools = this.buildTools();

    // Check if Redis bus is available (optional but improves streaming)
    const redisBus = this.broker.isReady ? this.broker.redisBus : undefined;

    this.client = new CopilotClientWrapper(
      {
        agentName: this.truffle.name,
        model: this.model,
        systemMessage: {
          mode: "replace",
          content: this.truffle.buildSystemPrompt(),
        },
        defaultTools: tools,
      },
      redisBus,
    );

    try {
      await this.client.start();
    } catch (err) {
      this.running = false;
      throw new Error(`Failed to start Copilot client: ${err instanceof Error ? err.message : String(err)}`);
    }

    let sessionOptions: CopilotSessionOptions = {};
    if (this.mcpServers.length > 0) {
      sessionOptions = injectServers(sessionOptions, this.mcpServers);
    }

    try {
      const session = await this.client.createSession(sessionOptions);
      this.session = session;

      const kickoff = `Begin the task now.

Task: ${this.truffle.task}

IMPORTANT: When your task is complete:
1. First, call create_pr with a descriptive title and body to push and create a pull request
2. Then, call mark_complete with a summary and the PR URL

If you get stuck, call request_help with details.`;
      await session.send(kickoff as any);
    } catch (err) {
      // Clean up client if session creation fails
      this.running = false;
      await this.client.stop().catch(() => {});
      this.client = null;
      throw new Error(`Failed to create Copilot session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    try {
      if (this.session && this.client) {
        await this.client.destroySession(this.session.sessionId);
      }
    } finally {
      await this.truffle.stop().catch(() => {});
      this.session = null;
      if (this.client) {
        await this.client.stop();
      }
      this.client = null;
    }
  }

  async sendNudge(hint: string, context?: string): Promise<void> {
    if (!this.session) return;
    const message = context
      ? `Nudge from Chocolatier: ${hint}\n\nContext: ${context}`
      : `Nudge from Chocolatier: ${hint}`;
    await this.session.send(message as any);
  }

  private buildTools(): Tool[] {
    const sendMessage = defineTool("send_message", {
      description:
        "Send a message to the Chocolatier or another agent. Use to share status or request clarification.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description:
              "Target agent name. Use '*' to broadcast. Defaults to supervisor.",
          },
          message: {
            type: "string",
            description: "Message content to send.",
          },
          level: {
            type: "string",
            enum: ["info", "warning", "error"],
            description: "Optional severity level for broadcasts.",
          },
        },
        required: ["message"],
      },
      handler: async (params: { to?: string; message: string; level?: "info" | "warning" | "error" }) => {
        const to = typeof params.to === "string" && params.to.length > 0
          ? params.to
          : this.truffle.supervisorName;
        const message = String(params.message ?? "");
        const level = (params.level as "info" | "warning" | "error") ?? "info";

        await this.broker.send({
          type: MessageType.BROADCAST,
          from: this.truffle.name,
          to,
          payload: { message, level },
        });

        return { ok: true };
      },
    });

    const markComplete = defineTool("mark_complete", {
      description:
        "Signal that the task is complete. Include a brief summary and optional PR URL.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Short summary of what was completed.",
          },
          prUrl: {
            type: "string",
            description: "Optional pull request URL, if created.",
          },
        },
        required: ["summary"],
      },
      handler: async (params: { summary: string; prUrl?: string }) => {
        const summary = String(params.summary ?? "");
        const prUrl = params.prUrl ? String(params.prUrl) : undefined;
        await this.truffle.signalComplete(summary, prUrl);
        return { ok: true };
      },
    });

    const requestHelp = defineTool("request_help", {
      description:
        "Ask the Chocolatier for guidance when blocked. Include a clear problem statement.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "Description of what is blocking progress.",
          },
        },
        required: ["message"],
      },
      handler: async (params: { message: string }) => {
        const message = String(params.message ?? "");
        await this.truffle.requestHelp(message);
        return { ok: true };
      },
    });

    const commitChanges = defineTool("commit_changes", {
      description:
        "Commit current changes in the worktree with the provided message.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "Commit message.",
          },
        },
        required: ["message"],
      },
      handler: async (params: { message: string }) => {
        const message = String(params.message ?? "");
        const hash = await this.truffle.commit(message);
        return { hash };
      },
    });

    const createPr = defineTool("create_pr", {
      description: "Create a pull request for the current branch.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Pull request title.",
          },
          body: {
            type: "string",
            description: "Pull request body/description.",
          },
        },
        required: ["title", "body"],
      },
      handler: async (params: { title: string; body: string }) => {
        const title = String(params.title ?? "");
        const body = String(params.body ?? "");
        const pr = await this.truffle.createPR(title, body);
        return pr;
      },
    });

    return [
      sendMessage,
      markComplete,
      requestHelp,
      commitChanges,
      createPr,
    ] as Tool[];
  }
}
