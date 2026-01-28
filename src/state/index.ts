export { StateManager } from "./state-manager.js";
export type { StateEvents } from "./state-manager.js";

export {
  type GlobalConfig,
  type DaemonState,
  type RepoState,
  type WorkerState,
  type AgentState,
  type AgentType,
  type AgentStatus,
  type WorkerStatus,
  type RepoMode,
  type RepoStatus,
  type DaemonStatus,
  type MessagePriority,
  type GitHubConfig,
  type RedisConfig,
  type CustomAgentDef,
  type McpServerConfig,
  type RepoConfig,
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_DAEMON_STATE,
  CURRENT_STATE_VERSION,
} from "./schemas.js";

export {
  atomicWriteFile,
  atomicWriteFileSync,
  readJsonFile,
  writeJsonFile,
  writeJsonFileSync,
} from "./atomic-write.js";

export { recoverState } from "./recovery.js";
