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
  SpawnWorkerOptions,
  WorkerSummary,
  WorkerHealthStatus,
  HealthCheckReport,
  AgentToolDefinition,
  ToolParameterSchema,
} from "./types.js";
