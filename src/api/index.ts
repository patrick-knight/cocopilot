/**
 * External integration API router.
 *
 * Mounts all v1 routes for external tool integration:
 *   /api/v1/workers   — flat worker management across repos
 *   /api/v1/webhooks  — callback URL registration
 *   /api/v1/status    — system health & uptime
 */

import { Router } from "express";
import type { StateManager } from "../state/index.js";
import type { MessageBroker } from "../messaging/index.js";

import { extWorkerRoutes } from "./v1/workers.js";
import { extWebhookRoutes } from "./v1/webhooks.js";
import { extStatusRoutes, type StatusDeps } from "./v1/status.js";

export interface ExtApiDeps {
  stateManager: StateManager;
  broker: MessageBroker;
  redisConnected?: () => boolean;
}

/**
 * Create the external integration API router.
 * Mount the returned router at `/api/v1` (or wherever the host app prefers).
 */
export function createExtApiRouter(deps: ExtApiDeps): Router {
  const { stateManager, broker, redisConnected } = deps;

  const router = Router();

  router.use("/workers", extWorkerRoutes(stateManager, broker));
  router.use("/webhooks", extWebhookRoutes());
  router.use(
    "/status",
    extStatusRoutes({ stateManager, redisConnected } satisfies StatusDeps),
  );

  return router;
}

export { extWorkerRoutes } from "./v1/workers.js";
export { extWebhookRoutes } from "./v1/webhooks.js";
export type { Webhook, WebhookStore } from "./v1/webhooks.js";
export { extStatusRoutes } from "./v1/status.js";
export type { StatusDeps } from "./v1/status.js";
