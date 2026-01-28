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

    try {
      new URL(url);
    } catch {
      next(createApiError(400, "Invalid URL format"));
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

  return router;
}
