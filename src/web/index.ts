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
