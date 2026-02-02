/**
 * External integration API — webhook management.
 *
 * Allows external tools to register callback URLs that receive
 * event notifications (worker lifecycle, PR events, etc.).
 *
 * Webhooks are stored in-memory for now; they reset on daemon restart.
 *
 * POST   /api/v1/webhooks       -- Register a callback URL
 * GET    /api/v1/webhooks       -- List registered webhooks
 * DELETE /api/v1/webhooks/:id   -- Remove a webhook
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { createApiError } from "../../server/middleware/error-handler.js";

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
}

export type WebhookStore = Map<string, Webhook>;

const VALID_EVENTS = [
  "worker.created",
  "worker.updated",
  "worker.completed",
  "worker.failed",
  "worker.removed",
  "pr.created",
  "pr.merged",
  "ci.failed",
];

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/i,
  /^\[::1\]$/i,
  /^fe80:/i,
  /^fc/i,
  /^fd/i,
  /^::ffff:127\./i,
];

function isSafeWebhookUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    const host = url.hostname.toLowerCase();
    return !BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

export function extWebhookRoutes(store?: WebhookStore): Router {
  const webhooks: WebhookStore = store ?? new Map();
  const router = Router();

  // POST / -- Register a webhook
  router.post("/", (req, res, next) => {
    const { url, events } = req.body ?? {};

    if (!url || typeof url !== "string") {
      next(createApiError(400, "Missing required field: url"));
      return;
    }

    if (!isSafeWebhookUrl(url)) {
      next(createApiError(400, "Invalid or unsafe webhook URL"));
      return;
    }

    if (!Array.isArray(events) || events.length === 0) {
      next(
        createApiError(
          400,
          `Missing or empty field: events. Valid events: ${VALID_EVENTS.join(", ")}`,
        ),
      );
      return;
    }

    const invalid = events.filter(
      (e: unknown) => typeof e !== "string" || !VALID_EVENTS.includes(e),
    );
    if (invalid.length > 0) {
      next(
        createApiError(
          400,
          `Invalid events: ${invalid.join(", ")}. Valid events: ${VALID_EVENTS.join(", ")}`,
        ),
      );
      return;
    }

    const webhook: Webhook = {
      id: randomUUID(),
      url,
      events,
      createdAt: new Date().toISOString(),
    };

    webhooks.set(webhook.id, webhook);
    res.status(201).json(webhook);
  });

  // GET / -- List all webhooks
  router.get("/", (_req, res) => {
    res.json(Array.from(webhooks.values()));
  });

  // DELETE /:id -- Remove a webhook
  router.delete("/:id", (req, res, next) => {
    const { id } = req.params;

    if (!webhooks.has(id)) {
      next(createApiError(404, `Webhook "${id}" not found`));
      return;
    }

    webhooks.delete(id);
    res.status(204).end();
  });

  // POST /:id/test -- Test a webhook
  router.post("/:id/test", async (req, res, next) => {
    const { id } = req.params;
    const webhook = webhooks.get(id);

    if (!webhook) {
      next(createApiError(404, `Webhook "${id}" not found`));
      return;
    }

    try {
      const testPayload = {
        event: "test",
        timestamp: new Date().toISOString(),
        data: {
          message: "This is a test webhook delivery from CoCoPilot",
          webhookId: id,
        },
      };

      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CoCoPilot-Event": "test",
          "X-CoCoPilot-Webhook-Id": id,
        },
        body: JSON.stringify(testPayload),
      });

      res.json({
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to deliver test webhook: ${message}` });
    }
  });

  return router;
}

/**
 * Notify all registered webhooks about an event.
 */
export async function notifyWebhooks(
  webhooks: WebhookStore,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  const promises: Promise<void>[] = [];

  for (const webhook of webhooks.values()) {
    if (!webhook.events.includes(event)) continue;

    promises.push(
      (async () => {
        try {
          await fetch(webhook.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CoCoPilot-Event": event,
              "X-CoCoPilot-Webhook-Id": webhook.id,
            },
            body: JSON.stringify(payload),
          });
        } catch (err) {
          // Log error but don't fail
          console.error(`[Webhook] Failed to deliver to ${webhook.url}:`, err);
        }
      })(),
    );
  }

  await Promise.allSettled(promises);
}
