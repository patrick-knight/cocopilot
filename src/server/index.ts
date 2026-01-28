/**
 * Server module barrel export.
 */

export { createServer, startServer, stopServer } from "./app.js";
export type { CocoServer, ServerDeps } from "./app.js";

export { createSocketBridge } from "./socket-bridge.js";
export { createStreamBridge } from "./stream-bridge.js";

export { errorHandler, createApiError } from "./middleware/error-handler.js";
export type { ApiError } from "./middleware/error-handler.js";

export { configRoutes } from "./routes/config.js";
export { repositoryRoutes } from "./routes/repositories.js";
export { workerRoutes } from "./routes/workers.js";
export { agentRoutes } from "./routes/agents.js";
