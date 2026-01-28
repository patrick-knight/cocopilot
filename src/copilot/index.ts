export { CopilotClientWrapper, defineTool } from "./client.js";

export type {
  CopilotWrapperConfig,
  CopilotSessionOptions,
  StreamEvent,
  ConnectionStateHandler,
  ManagedSession,
  SessionEvent,
  SessionEventHandler,
  Tool,
  MCPServerConfig,
  ConnectionState,
  SystemMessageConfig,
  ProviderConfig,
  CopilotClientOptions,
  SessionConfig,
} from "./types.js";

export {
  type CopilotToolDefinition,
  type DefineToolConfig,
  type JSONSchemaObject,
  type JSONSchemaProperty,
} from "./types.js";

export {
  createAgentTools,
  createSendMessageTool,
  createMarkCompleteTool,
  createRequestHelpTool,
  type AgentToolDependencies,
  type SendMessageParams,
  type SendMessageResult,
  type MarkCompleteParams,
  type MarkCompleteResult,
  type RequestHelpParams,
  type RequestHelpResult,
} from "./tools.js";
