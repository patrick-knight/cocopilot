/**
 * Express app factory + Socket.IO setup.
 *
 * Creates the HTTP server with Express middleware, REST routes,
 * and Socket.IO real-time capabilities. Lifecycle is managed by
 * the Concher daemon.
 */

import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import express from "express";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";

import type { StateManager } from "../state/index.js";
import type { EventStore } from "../state/index.js";
import type { MessageBroker } from "../messaging/index.js";
import type { RedisMessageBus } from "../messaging/index.js";

import { errorHandler } from "./middleware/error-handler.js";
import { configRoutes } from "./routes/config.js";
import { repositoryRoutes } from "./routes/repositories.js";
import { workerRoutes } from "./routes/workers.js";
import { agentRoutes } from "./routes/agents.js";
import { prRoutes } from "./routes/prs.js";
import { eventsRoutes } from "./routes/events.js";
import { createExtApiRouter } from "../api/index.js";
import { metricsRoutes } from "../web/routes/metrics.js";
import { createSocketBridge } from "./socket-bridge.js";
import { createStreamBridge } from "./stream-bridge.js";

export interface ServerDeps {
  stateManager: StateManager;
  broker: MessageBroker;
  redisBus?: RedisMessageBus;
  eventStore?: EventStore;
}

export interface CocoServer {
  httpServer: HttpServer;
  io: SocketIOServer;
  cleanup: () => void;
}

/**
 * Create an Express app with all routes mounted, a Socket.IO server
 * attached, and bridges wired up.
 */
export function createServer(deps: ServerDeps): CocoServer {
  const { stateManager, broker, redisBus, eventStore } = deps;

  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // REST API routes under /api/v1
  const api = express.Router();
  api.use("/config", configRoutes(stateManager));
  api.use("/repositories", repositoryRoutes(stateManager));
  api.use(
    "/repositories/:repoName/workers",
    workerRoutes(stateManager, broker),
  );
  api.use(
    "/repositories/:repoName/agents",
    agentRoutes(stateManager, broker),
  );
  api.use(
    "/repositories/:repoName/prs",
    prRoutes(stateManager),
  );
  api.use("/metrics", metricsRoutes(stateManager));
  if (eventStore) {
    api.use("/events", eventsRoutes(eventStore));
  }
  app.use("/api/v1", api);

  // External integration API (flat worker management, webhooks, status)
  const extApi = createExtApiRouter({
    stateManager,
    broker,
    redisConnected: redisBus ? () => redisBus.isReady : undefined,
  });
  app.use("/api/v1", extApi);

  // Error handler (must be after routes)
  app.use(errorHandler);

  // HTTP server
  const httpServer = createHttpServer(app);

  // Socket.IO
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
  });

  // Wire up bridges
  const cleanupSocketBridge = createSocketBridge(io, stateManager, broker, eventStore);
  let cleanupStreamBridge: (() => void) | undefined;
  if (redisBus) {
    cleanupStreamBridge = createStreamBridge(io, redisBus);
  }

  const cleanup = (): void => {
    cleanupSocketBridge();
    cleanupStreamBridge?.();
  };

  return { httpServer, io, cleanup };
}

/**
 * Start listening on the given port.
 */
export function startServer(
  server: CocoServer,
  port: number,
): Promise<void> {
  return new Promise((resolve) => {
    server.httpServer.listen(port, () => {
      resolve();
    });
  });
}

/**
 * Gracefully stop the server.
 * Note: io.close() internally closes the underlying httpServer,
 * so we only need to call io.close().
 */
export function stopServer(server: CocoServer): Promise<void> {
  return new Promise((resolve) => {
    server.cleanup();
    server.io.close(() => {
      resolve();
    });
  });
}
