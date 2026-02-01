export {
  TruffleAgent,
  type TruffleConfig,
  type TruffleEvents,
  type PRResult,
} from "./truffle.js";

export { Chocolatier, CHOCOLATIER_SYSTEM_PROMPT } from "./chocolatier.js";

export type {
  AgentConfig,
  ChocolatierConfig,
  ChocolatierEvents,
  EnroberConfig,
  EnroberEvents,
  ReviewerConfig,
  ReviewerEvents,
  ReviewComment,
  ReviewResult,
  ReviewerStatus,
  ApprovalState,
  SpawnWorkerOptions,
  WorkerSummary,
  WorkerHealthStatus,
  HealthCheckReport,
  AgentToolDefinition,
  ToolParameterSchema,
  WorkspaceConfig,
  WorkspaceState,
} from "./types.js";

export {
  Temperer,
  type TempererConfig,
  type PRInfo as TempererPRInfo,
  type CheckInfo,
  type CIStatus,
  type TrackedPR,
  type TrackedPRState,
  type ExecFn as TempererExecFn,
} from "./temperer.js";

export {
  Enrober,
  ENROBER_SYSTEM_PROMPT,
  type EnroberPRInfo,
  type TrackedEnroberPR,
  type TrackedEnroberPRState,
  type ExecFn as EnroberExecFn,
} from "./enrober.js";

export {
  parseAgentDefinition,
  loadAllAgents,
  type ParsedAgentDef,
  type AgentClass,
} from "./custom-loader.js";

export {
  CustomAgent,
  type CustomAgentStatus,
  type CustomAgentOptions,
} from "./custom-agent.js";

export {
  ReviewerAgent,
  REVIEWER_SYSTEM_PROMPT,
} from "./reviewer.js";

export {
  WorkspaceAgent,
  WORKSPACE_SYSTEM_PROMPT,
  type WorkspaceEvents,
} from "./workspace.js";

export {
  SecurityReviewerAgent,
  type SecurityReviewerConfig,
  type SecurityReviewerEvents,
} from "./security-reviewer.js";

export {
  scopedAgentName,
  scopedWorkerName,
  isScopedName,
} from "./scoped-name.js";
