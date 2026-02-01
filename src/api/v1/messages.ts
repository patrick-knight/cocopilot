/**
 * Messages API — Real-time stream of inter-agent messages.
 *
 * GET /api/v1/messages/stream — SSE endpoint for real-time message viewing
 * GET /api/v1/messages — List recent messages
 */

import { Router, type Request, type Response } from "express";
import type { RedisMessageBus } from "../../messaging/index.js";
import { streamChannel } from "../../messaging/types.js";

export interface MessagesDeps {
  redisBus?: RedisMessageBus;
}

export function messagesRoutes(deps: MessagesDeps): Router {
  const router = Router();
  const { redisBus } = deps;

  /**
   * SSE endpoint for streaming inter-agent messages in real-time.
   * Query params:
   *   - repo: Filter by repository name
   *   - agent: Filter by agent name
   */
  router.get("/stream", (req: Request, res: Response) => {
    if (!redisBus) {
      res.status(503).json({ error: "Redis not available" });
      return;
    }

    const { repo, agent } = req.query as { repo?: string; agent?: string };

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send keepalive comment every 15 seconds
    const keepalive = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15000);

    // Determine which channel(s) to subscribe to
    const channels: string[] = [];
    if (agent) {
      channels.push(streamChannel(agent));
    }
    if (repo) {
      channels.push(streamChannel(`messages:${repo}`));
    }
    // If no filters, subscribe to a wildcard pattern (all messages)
    if (channels.length === 0) {
      channels.push(streamChannel("messages:*"));
    }

    // Handler for incoming messages
    const handlers: Map<string, (message: unknown) => void> = new Map();

    const handleMessage = (channel: string) => (message: unknown) => {
      try {
        const data = typeof message === "string" ? message : JSON.stringify(message);
        const parsed = JSON.parse(data);

        // Apply filters
        if (repo && parsed.repoName && parsed.repoName !== repo) return;
        if (agent && parsed.agent && parsed.agent !== agent) return;

        res.write(`data: ${data}\n\n`);
      } catch {
        res.write(`data: ${JSON.stringify({ content: String(message) })}\n\n`);
      }
    };

    // Subscribe to channels
    for (const channel of channels) {
      const handler = handleMessage(channel);
      handlers.set(channel, handler);
      redisBus.subscribeChannel(channel, handler as never).catch(() => {
        // Non-fatal - channel may not exist yet
      });
    }

    // Clean up on client disconnect
    req.on("close", () => {
      clearInterval(keepalive);
      for (const [channel, handler] of handlers) {
        redisBus.unsubscribeChannel(channel).catch(() => {});
      }
    });
  });

  return router;
}
