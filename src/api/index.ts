/**
 * External integration API router.
 *
 * Mounts all v1 routes for external tool integration:
 *   /api/v1/repositories — repository listing and onboarding
 *   /api/v1/workers      — flat worker management across repos
 *   /api/v1/webhooks     — callback URL registration
 *   /api/v1/status       — system health & uptime
 *   /api/v1/messages     — inter-agent message streaming
 */

import { Router } from "express";
import type { StateManager } from "../state/index.js";
import type { MessageBroker, RedisMessageBus } from "../messaging/index.js";
import type { FileMessageStore } from "../messaging/file-store.js";

import { extRepositoriesRoutes } from "./v1/repositories.js";
import { extWorkerRoutes } from "./v1/workers.js";
import { extWebhookRoutes } from "./v1/webhooks.js";
import { extStatusRoutes, type StatusDeps } from "./v1/status.js";
import { reloadState, type SystemDeps } from "./v1/system.js";
import { messagesRoutes } from "./v1/messages.js";

export interface ExtApiDeps {
  stateManager: StateManager;
  broker: MessageBroker;
  redisConnected?: () => boolean;
  redisBus?: RedisMessageBus;
  messageStore?: FileMessageStore;
}

/**
 * Create the external integration API router.
 * Mount the returned router at `/api/v1` (or wherever the host app prefers).
 */
export function createExtApiRouter(deps: ExtApiDeps): Router {
  const { stateManager, broker, redisConnected, redisBus, messageStore } = deps;

  const router = Router();

  router.use("/repositories", extRepositoriesRoutes({ stateManager }));
  router.use("/workers", extWorkerRoutes(stateManager, broker));
  router.use("/webhooks", extWebhookRoutes());
  router.use(
    "/status",
    extStatusRoutes({ stateManager, redisConnected } satisfies StatusDeps),
  );
  router.use("/messages", messagesRoutes({ redisBus, messageStore }));
  
  // System control endpoints
  router.post("/system/reload-state", (req, res) =>
    reloadState(req, res, { stateManager } satisfies SystemDeps),
  );

  return router;
}

export { extRepositoriesRoutes } from "./v1/repositories.js";
export { extWorkerRoutes } from "./v1/workers.js";
export { extWebhookRoutes } from "./v1/webhooks.js";
export type { Webhook, WebhookStore } from "./v1/webhooks.js";
export { extStatusRoutes } from "./v1/status.js";
export type { StatusDeps } from "./v1/status.js";
