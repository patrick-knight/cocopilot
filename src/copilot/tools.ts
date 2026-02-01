/**
 * Inter-Agent Messaging Tools for Copilot Sessions
 *
 * Defines the Copilot SDK tools that get injected into agent sessions
 * for inter-agent communication via the Ganache Bus (MessageBroker).
 *
 * Tools:
 *   - send_message: Send a message to any CoCoPilot agent
 *   - mark_complete: Signal task completion with summary and optional PR URL
 *   - request_help: Ask the Chocolatier (supervisor) for guidance
 *
 * Usage:
 *   const tools = createAgentTools({ agentName: "Snickers", broker });
 *   // Pass tools array to CopilotClient session configuration
 */

import { defineTool, CopilotToolDefinition } from "./types.js";
import { MessageBroker } from "../messaging/broker.js";
import {
  MessageType,
  MessagePriority,
  COMPLETIONS_CHANNEL,
} from "../messaging/types.js";

// --- Tool parameter types ---

export interface SendMessageParams {
  to: string;
  message: string;
  priority?: MessagePriority;
}

export interface SendMessageResult {
  sent: boolean;
  to: string;
  timestamp: number;
}

export interface MarkCompleteParams {
  summary: string;
  pr_url?: string;
}

export interface MarkCompleteResult {
  completed: boolean;
  agent: string;
  timestamp: number;
}

export interface RequestHelpParams {
  question: string;
  context?: string;
}

export interface RequestHelpResult {
  sent: boolean;
  to: string;
  timestamp: number;
}

// --- Dependencies for tool creation ---

export interface AgentToolDependencies {
  /** The name of the agent these tools belong to (e.g., "Snickers"). */
  agentName: string;
  /** The MessageBroker instance for sending messages. */
  broker: MessageBroker;
  /** Name of the supervisor agent to report to (defaults to "chocolatier"). */
  supervisorName?: string;
  /**
   * Optional raw Redis publish function for channels not managed by the broker.
   * Used by mark_complete to publish to the cocopilot:completions channel.
   * Signature matches ioredis `publish(channel, message)`.
   */
  redisPublish?: (channel: string, data: string) => Promise<number>;
}

// --- Tool factory ---

/**
 * Create the standard set of inter-agent messaging tools for a CoCoPilot agent.
 *
 * Returns an array of three CopilotToolDefinition objects ready to be passed
 * to a Copilot SDK session's `tools` configuration.
 */
export function createAgentTools(
  deps: AgentToolDependencies,
): CopilotToolDefinition[] {
  return [
    createSendMessageTool(deps),
    createMarkCompleteTool(deps),
    createRequestHelpTool(deps),
  ];
}

/**
 * send_message — Send a message to another CoCoPilot agent.
 *
 * Publishes to Redis channel cocopilot:messages:{to} via the MessageBroker.
 * Uses BROADCAST message type for general inter-agent communication.
 */
export function createSendMessageTool(
  deps: AgentToolDependencies,
): CopilotToolDefinition<SendMessageParams, SendMessageResult> {
  const { agentName, broker } = deps;

  return defineTool<SendMessageParams, SendMessageResult>("send_message", {
    description: "Send a message to another CoCoPilot agent",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Target agent name" },
        message: { type: "string", description: "Message content" },
        priority: {
          type: "string",
          description: "Message priority level",
          enum: ["low", "normal", "high"],
        },
      },
      required: ["to", "message"],
    },
    handler: async ({ to, message, priority = "normal" }) => {
      const timestamp = Date.now();

      await broker.send({
        type: MessageType.BROADCAST,
        from: agentName,
        to,
        payload: { message },
        priority,
      });

      return { sent: true, to, timestamp };
    },
  });
}

/**
 * mark_complete — Signal that the agent's task is complete.
 *
 * Sends a TASK_COMPLETE message to the Chocolatier (supervisor) via the
 * MessageBroker and publishes to the cocopilot:completions channel for
 * dashboard listeners.
 */
export function createMarkCompleteTool(
  deps: AgentToolDependencies,
): CopilotToolDefinition<MarkCompleteParams, MarkCompleteResult> {
  const { agentName, broker, supervisorName = "chocolatier", redisPublish } = deps;

  return defineTool<MarkCompleteParams, MarkCompleteResult>("mark_complete", {
    description: "Signal that your task is complete",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Summary of work done",
        },
        pr_url: {
          type: "string",
          description: "URL of created PR",
        },
      },
      required: ["summary"],
    },
    handler: async ({ summary, pr_url }) => {
      const timestamp = Date.now();

      // Send TASK_COMPLETE to supervisor via broker (persisted + real-time)
      await broker.send({
        type: MessageType.TASK_COMPLETE,
        from: agentName,
        to: supervisorName,
        payload: { summary, pr_url },
        priority: "high",
      });

      // Publish to completions channel for dashboard/daemon listeners
      if (redisPublish) {
        await redisPublish(
          COMPLETIONS_CHANNEL,
          JSON.stringify({
            agent: agentName,
            summary,
            pr_url,
            timestamp,
          }),
        );
      }

      return { completed: true, agent: agentName, timestamp };
    },
  });
}

/**
 * request_help — Ask the Chocolatier (supervisor) for guidance.
 *
 * Publishes a STATUS_REQUEST message to the Chocolatier with the
 * agent's question and optional context about what they're stuck on.
 */
export function createRequestHelpTool(
  deps: AgentToolDependencies,
): CopilotToolDefinition<RequestHelpParams, RequestHelpResult> {
  const { agentName, broker, supervisorName = "chocolatier" } = deps;

  return defineTool<RequestHelpParams, RequestHelpResult>("request_help", {
    description: "Ask the Chocolatier (supervisor) for guidance when stuck",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "What you need help with",
        },
        context: {
          type: "string",
          description: "Additional context about what you have tried",
        },
      },
      required: ["question"],
    },
    handler: async ({ question, context }) => {
      const timestamp = Date.now();

      await broker.send({
        type: MessageType.NUDGE,
        from: agentName,
        to: supervisorName,
        payload: {
          hint: question,
          context,
        },
        priority: "high",
        ack_required: true,
      });

      return { sent: true, to: supervisorName, timestamp };
    },
  });
}
