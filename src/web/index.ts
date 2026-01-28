/**
 * Web module exports for the CoCoPilot Cocoa Board.
 */

// Pages
export { TemperingStation } from "./pages/TemperingStation.js";

// Components
export { AgentCard, WorkerCard } from "./components/AgentCard.js";
export { LiveOutputPanel } from "./components/LiveOutputPanel.js";
export { PRPipeline } from "./components/PRPipeline.js";
export { MessageQueueInspector } from "./components/MessageQueueInspector.js";

// Hooks
export {
  useSocket,
  useRepoState,
  useAgentStream,
  usePRPipeline,
  useMessageQueue,
} from "./hooks/useSocket.js";

// Types
export type {
  AgentOutputLine,
  PRPipelineEntry,
  PRStage,
  MessageEntry,
  SpawnWorkerRequest,
  ServerToClientEvents,
  ClientToServerEvents,
  AgentDisplayInfo,
} from "./types.js";

export { AGENT_DISPLAY, STATUS_COLORS, PR_STAGE_DISPLAY } from "./types.js";

// Truffle Inspector (worker detail)
export { TruffleInspector } from "./frontend/pages/TruffleInspector.js";
export { WorkerHeader } from "./frontend/components/WorkerHeader.js";
export { LiveOutput } from "./frontend/components/LiveOutput.js";
export { GitLog } from "./frontend/components/GitLog.js";
export { ResourceUsage } from "./frontend/components/ResourceUsage.js";
export { WorkerControls } from "./frontend/components/WorkerControls.js";
export { MessageInspector } from "./frontend/components/MessageInspector.js";

// Worker API routes
export {
  registerWorkerRoutes,
  type WorkerRouteDeps,
  type WorkerDetail,
  type ContainerResources,
  type ExpressRouter,
} from "./routes/workers.js";

// Worker streaming (Socket.IO ↔ Redis bridge)
export {
  WorkerStreamManager,
  type WorkerStreamConfig,
  type WorkerOutputEvent,
  type WorkerStatusEvent,
  type WorkerCompletionEvent,
} from "./socket/worker-stream.js";
