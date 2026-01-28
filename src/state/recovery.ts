/**
 * State recovery for daemon restart.
 *
 * Handles:
 *  - Schema version migrations
 *  - Resetting transient runtime state (containers, PIDs)
 *  - Marking previously-running agents/workers as crashed
 *  - Pruning invalid entries
 */

import {
  type DaemonState,
  type RepoState,
  type WorkerState,
  type AgentState,
  CURRENT_STATE_VERSION,
  DEFAULT_DAEMON_STATE,
} from "./schemas.js";

/**
 * Validate and recover a DaemonState loaded from disk after a restart.
 *
 * The returned state is safe to use as the daemon's initial state.
 */
export function recoverState(raw: Partial<DaemonState>): DaemonState {
  // If the loaded object is clearly invalid, start fresh.
  if (!raw || typeof raw !== "object") {
    return structuredClone(DEFAULT_DAEMON_STATE);
  }

  let state: DaemonState = {
    version: typeof raw.version === "number" ? raw.version : 0,
    status: "stopped", // Always start as stopped on recovery
    pid: undefined, // Clear stale PID
    startedAt: undefined,
    repositories:
      raw.repositories && typeof raw.repositories === "object"
        ? raw.repositories
        : {},
  };

  // Run migrations if needed
  state = migrateState(state);

  // Recover each repository
  const cleanRepos: Record<string, RepoState> = {};
  for (const [name, repo] of Object.entries(state.repositories)) {
    const recovered = recoverRepo(name, repo);
    if (recovered) {
      cleanRepos[name] = recovered;
    }
  }
  state.repositories = cleanRepos;

  return state;
}

// ---------------------------------------------------------------------------
// Schema migrations
// ---------------------------------------------------------------------------

function migrateState(state: DaemonState): DaemonState {
  // Version 0 → 1: initial schema, no changes needed beyond setting version
  if (state.version < CURRENT_STATE_VERSION) {
    state.version = CURRENT_STATE_VERSION;
  }
  return state;
}

// ---------------------------------------------------------------------------
// Repo recovery
// ---------------------------------------------------------------------------

function recoverRepo(
  name: string,
  repo: Partial<RepoState>,
): RepoState | null {
  // Validate minimum required fields
  if (!repo || typeof repo !== "object") return null;
  if (!repo.id || !repo.url || !repo.localPath) return null;

  const now = new Date().toISOString();

  // Recover agents
  const agents: Record<string, AgentState> = {};
  if (repo.agents && typeof repo.agents === "object") {
    for (const [agentName, agent] of Object.entries(repo.agents)) {
      const recovered = recoverAgent(agentName, agent);
      if (recovered) {
        agents[agentName] = recovered;
      }
    }
  }

  // Recover workers
  const workers: Record<string, WorkerState> = {};
  if (repo.workers && typeof repo.workers === "object") {
    for (const [workerName, worker] of Object.entries(repo.workers)) {
      const recovered = recoverWorker(workerName, worker);
      if (recovered) {
        workers[workerName] = recovered;
      }
    }
  }

  return {
    id: repo.id,
    name: repo.name ?? name,
    url: repo.url,
    localPath: repo.localPath,
    mode: repo.mode === "multiplayer" ? "multiplayer" : "single-player",
    status: repo.status === "initializing" ? "initializing" : "active",
    defaultBranch: repo.defaultBranch ?? "main",
    agents,
    workers,
    createdAt: repo.createdAt ?? now,
    updatedAt: now,
    lastMerge: repo.lastMerge,
  };
}

// ---------------------------------------------------------------------------
// Agent recovery
// ---------------------------------------------------------------------------

function recoverAgent(
  name: string,
  agent: Partial<AgentState>,
): AgentState | null {
  if (!agent || typeof agent !== "object") return null;
  if (!agent.type) return null;

  const wasRunning =
    agent.status === "starting" ||
    agent.status === "healthy" ||
    agent.status === "working";

  return {
    name: agent.name ?? name,
    type: agent.type,
    // If the agent was running before the crash, mark it as crashed
    status: wasRunning ? "crashed" : (agent.status ?? "stopped"),
    // Clear container ID — container is gone after restart
    containerId: undefined,
    lastActivity: agent.lastActivity ?? new Date().toISOString(),
    startedAt: agent.startedAt ?? new Date().toISOString(),
    error: wasRunning
      ? "Daemon restarted while agent was running"
      : agent.error,
  };
}

// ---------------------------------------------------------------------------
// Worker recovery
// ---------------------------------------------------------------------------

function recoverWorker(
  name: string,
  worker: Partial<WorkerState>,
): WorkerState | null {
  if (!worker || typeof worker !== "object") return null;
  if (!worker.id || !worker.task) return null;

  const wasActive =
    worker.status === "starting" || worker.status === "working";

  // Completed / failed / terminated workers are kept as-is for history
  if (
    worker.status === "completed" ||
    worker.status === "failed" ||
    worker.status === "terminated"
  ) {
    return {
      id: worker.id,
      name: worker.name ?? name,
      task: worker.task,
      branch: worker.branch ?? `work/${name}`,
      status: worker.status,
      model: worker.model,
      prNumber: worker.prNumber,
      prUrl: worker.prUrl,
      createdAt: worker.createdAt ?? new Date().toISOString(),
      updatedAt: worker.updatedAt ?? new Date().toISOString(),
      completedAt: worker.completedAt,
      error: worker.error,
    };
  }

  // Active workers become "stuck" — they may need re-spawning
  return {
    id: worker.id,
    name: worker.name ?? name,
    task: worker.task,
    branch: worker.branch ?? `work/${name}`,
    status: wasActive ? "stuck" : (worker.status ?? "stuck"),
    containerId: undefined, // container is gone
    model: worker.model,
    prNumber: worker.prNumber,
    prUrl: worker.prUrl,
    createdAt: worker.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: wasActive
      ? "Daemon restarted while worker was active"
      : worker.error,
  };
}
