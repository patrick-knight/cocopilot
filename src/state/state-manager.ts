/**
 * StateManager — single entry-point for all CoCoPilot persistent state.
 *
 * Manages:
 *   ~/.cocopilot/config.json   → GlobalConfig
 *   ~/.cocopilot/state.json    → DaemonState (repos, workers, daemon status)
 *   ~/.cocopilot/daemon.pid    → PID file
 *
 * All writes go through atomic-write to prevent corruption.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import {
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
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_DAEMON_STATE,
  CURRENT_STATE_VERSION,
} from "./schemas.js";
import {
  readJsonFile,
  writeJsonFile,
  writeJsonFileSync,
  atomicWriteFile,
} from "./atomic-write.js";
import { recoverState } from "./recovery.js";

// ---------------------------------------------------------------------------
// Candy names for workers (adjective + candy combinations = 400 unique names)
// ---------------------------------------------------------------------------

const CANDY_ADJECTIVES = [
  "Sweet",
  "Rich",
  "Golden",
  "Silky",
  "Melty",
  "Sugary",
  "Gooey",
  "Minty",
  "Creamy",
  "Honeyed",
  "Buttery",
  "Toasty",
  "Swirly",
  "Frosted",
  "Glazed",
  "Candied",
  "Chewy",
  "Crunchy",
  "Caramelly",
  "Fizzy",
];

const CANDY_NOUNS = [
  "Caramel",
  "Toffee",
  "Praline",
  "Ganache",
  "Nougat",
  "Fudge",
  "Brittle",
  "Marzipan",
  "Taffy",
  "Bonbon",
  "Butterscotch",
  "Licorice",
  "Gummy",
  "Jellybean",
  "Lollipop",
  "Gumdrop",
  "Peppermint",
  "Marshmallow",
  "Fondant",
  "Turtles",
];

// Generate all adjective-candy combinations
const CANDY_NAMES = CANDY_ADJECTIVES.flatMap((adj) =>
  CANDY_NOUNS.map((noun) => `${adj}${noun}`)
);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface StateEvents {
  configChanged: [config: GlobalConfig];
  stateChanged: [state: DaemonState];
  repoAdded: [repo: RepoState];
  repoRemoved: [repoName: string];
  workerAdded: [repoName: string, worker: WorkerState];
  workerUpdated: [repoName: string, worker: WorkerState];
  workerRemoved: [repoName: string, workerName: string];
  agentUpdated: [repoName: string, agent: AgentState];
}

// ---------------------------------------------------------------------------
// StateManager
// ---------------------------------------------------------------------------

export class StateManager extends EventEmitter {
  private readonly baseDir: string;
  private config: GlobalConfig;
  private state: DaemonState;

  private readonly configPath: string;
  private readonly statePath: string;
  private readonly pidPath: string;
  
  private stateWatcher: fs.FSWatcher | null = null;
  private isReloadingState = false;
  private stateOperationQueue: Promise<void> = Promise.resolve();

  constructor(baseDir?: string) {
    super();
    this.baseDir =
      baseDir ?? path.join(process.env.HOME ?? "/tmp", ".cocopilot");
    this.configPath = path.join(this.baseDir, "config.json");
    this.statePath = path.join(this.baseDir, "state.json");
    this.pidPath = path.join(this.baseDir, "daemon.pid");

    this.config = { ...DEFAULT_GLOBAL_CONFIG };
    this.state = structuredClone(DEFAULT_DAEMON_STATE);
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Load persisted config and state from disk.
   * Creates default files when they don't exist.
   * Runs recovery if state is corrupted.
   */
  async init(): Promise<void> {
    await fs.promises.mkdir(this.baseDir, { recursive: true });

    // Load global config (create defaults if missing)
    const loadedConfig = await readJsonFile<GlobalConfig>(this.configPath);
    if (loadedConfig) {
      this.config = { ...DEFAULT_GLOBAL_CONFIG, ...loadedConfig };
    } else {
      this.config = { ...DEFAULT_GLOBAL_CONFIG };
      await this.persistConfig();
    }

    // Load daemon state (with recovery)
    const loadedState = await this.loadStateWithRecovery();
    this.state = loadedState;
    
    // Watch for external state file changes (e.g., from CLI commands)
    this.startStateFileWatcher();
  }

  /**
   * Start watching the state file for external changes.
   * When the CLI modifies state.json, reload it automatically.
   */
  private startStateFileWatcher(): void {
    if (this.stateWatcher) return;

    try {
      this.stateWatcher = fs.watch(this.statePath, (eventType) => {
        // Only reload on 'change' events, and prevent reloading our own writes
        if (eventType === 'change' && !this.isReloadingState) {
          // Queue the reload operation to serialize with writes
          this.stateOperationQueue = this.stateOperationQueue.then(async () => {
            // Double-check the flag in case it changed while queued
            if (this.isReloadingState) return;
            
            this.isReloadingState = true;
            try {
              // Wait a bit to ensure the write is complete
              await new Promise(resolve => setTimeout(resolve, 100));
              const newState = await this.loadStateWithRecovery();
              
              // Only update if repositories actually changed
              const oldRepoNames = Object.keys(this.state.repositories).sort();
              const newRepoNames = Object.keys(newState.repositories).sort();
              
              if (JSON.stringify(oldRepoNames) !== JSON.stringify(newRepoNames)) {
                // Preserve daemon runtime state (status, pid, startedAt)
                newState.status = this.state.status;
                newState.pid = this.state.pid;
                newState.startedAt = this.state.startedAt;
                
                this.state = newState;
                this.emit('stateChanged', this.state);
                console.log('[StateManager] Reloaded state from disk - repositories updated');
              }
            } catch (error) {
              console.error('[StateManager] Failed to reload state:', error);
            } finally {
              this.isReloadingState = false;
            }
          }).catch(err => {
            console.error('[StateManager] State reload error:', err);
          });
        }
      });
    } catch (error) {
      console.error('[StateManager] Failed to start state file watcher:', error);
    }
  }

  /**
   * Stop watching the state file and clean up resources.
   */
  stopStateFileWatcher(): void {
    if (this.stateWatcher) {
      this.stateWatcher.close();
      this.stateWatcher = null;
    }
  }

  /**
   * Reload state from disk (called by API when CLI modifies state.json).
   * Preserves daemon runtime state (status, pid, startedAt).
   */
  async reloadState(): Promise<void> {
    this.isReloadingState = true;
    try {
      const newState = await this.loadStateWithRecovery();
      
      // Preserve daemon runtime state
      newState.status = this.state.status;
      newState.pid = this.state.pid;
      newState.startedAt = this.state.startedAt;
      
      this.state = newState;
      this.emit('stateChanged', this.state);
      console.log('[StateManager] State reloaded via API - repositories updated');
    } finally {
      this.isReloadingState = false;
    }
  }

  private async loadStateWithRecovery(): Promise<DaemonState> {
    try {
      const raw = await readJsonFile<DaemonState>(this.statePath);
      if (!raw) {
        // No state file — first run
        // Use sync write to avoid deadlock when called from queued operations
        const fresh = structuredClone(DEFAULT_DAEMON_STATE);
        writeJsonFileSync(this.statePath, fresh);
        return fresh;
      }
      // Validate & recover
      return recoverState(raw);
    } catch {
      // Corrupted JSON — start fresh but preserve backup
      const backupPath = this.statePath + ".corrupt." + Date.now();
      await fs.promises
        .rename(this.statePath, backupPath)
        .catch(() => {});
      const fresh = structuredClone(DEFAULT_DAEMON_STATE);
      // Use sync write to avoid deadlock when called from queued operations
      writeJsonFileSync(this.statePath, fresh);
      return fresh;
    }
  }

  // -----------------------------------------------------------------------
  // Persistence helpers
  // -----------------------------------------------------------------------

  private async persistConfig(): Promise<void> {
    await writeJsonFile(this.configPath, this.config);
  }

  private async persistState(state?: DaemonState): Promise<void> {
    // Queue state operations to prevent concurrent writes
    this.stateOperationQueue = this.stateOperationQueue.then(async () => {
      // Set flag to prevent reloading our own write
      this.isReloadingState = true;
      try {
        await writeJsonFile(this.statePath, state ?? this.state);
        // Brief delay after write completes to ensure fs.watch event passes
        await new Promise(resolve => setTimeout(resolve, 150));
      } finally {
        this.isReloadingState = false;
      }
    }).catch(err => {
      console.error('[StateManager] Failed to persist state:', err);
      throw err;
    });
    return this.stateOperationQueue;
  }

  /** Sync flush for use in signal handlers. */
  persistStateSync(): void {
    writeJsonFileSync(this.statePath, this.state);
  }

  // -----------------------------------------------------------------------
  // Global config
  // -----------------------------------------------------------------------

  getConfig(): Readonly<GlobalConfig> {
    return this.config;
  }

  async updateConfig(
    patch: Partial<GlobalConfig>,
  ): Promise<GlobalConfig> {
    this.config = { ...this.config, ...patch };
    await this.persistConfig();
    this.emit("configChanged", this.config);
    return this.config;
  }

  // -----------------------------------------------------------------------
  // Daemon lifecycle
  // -----------------------------------------------------------------------

  getDaemonState(): Readonly<DaemonState> {
    return this.state;
  }

  async setDaemonRunning(pid: number): Promise<void> {
    this.state.status = "running";
    this.state.pid = pid;
    this.state.startedAt = new Date().toISOString();
    await this.persistState();
    await atomicWriteFile(this.pidPath, String(pid));
    this.emit("stateChanged", this.state);
  }

  async setDaemonStopped(): Promise<void> {
    this.state.status = "stopped";
    this.state.pid = undefined;
    await this.persistState();
    await fs.promises.unlink(this.pidPath).catch(() => {});
    this.emit("stateChanged", this.state);
  }

  async readPid(): Promise<number | undefined> {
    try {
      const raw = await fs.promises.readFile(this.pidPath, "utf-8");
      const pid = parseInt(raw.trim(), 10);
      return Number.isFinite(pid) ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  // -----------------------------------------------------------------------
  // Repository management
  // -----------------------------------------------------------------------

  getRepos(): Readonly<Record<string, RepoState>> {
    return this.state.repositories;
  }

  getRepo(name: string): Readonly<RepoState> | undefined {
    return this.state.repositories[name];
  }

  async addRepo(opts: {
    name: string;
    url: string;
    localPath: string;
    mode: RepoMode;
    defaultBranch?: string;
  }): Promise<RepoState> {
    if (this.state.repositories[opts.name]) {
      throw new Error(`Repository "${opts.name}" is already tracked`);
    }

    const now = new Date().toISOString();
    const repo: RepoState = {
      id: randomUUID(),
      name: opts.name,
      url: opts.url,
      localPath: opts.localPath,
      mode: opts.mode,
      status: "initializing",
      defaultBranch: opts.defaultBranch ?? "main",
      agents: {},
      workers: {},
      createdAt: now,
      updatedAt: now,
    };

    this.state.repositories[opts.name] = repo;
    await this.persistState();
    this.emit("repoAdded", repo);
    this.emit("stateChanged", this.state);
    return repo;
  }

  async updateRepoStatus(
    name: string,
    status: RepoStatus,
  ): Promise<RepoState> {
    const repo = this.requireRepo(name);
    repo.status = status;
    repo.updatedAt = new Date().toISOString();
    await this.persistState();
    this.emit("stateChanged", this.state);
    return repo;
  }

  async removeRepo(name: string): Promise<void> {
    if (!this.state.repositories[name]) {
      throw new Error(`Repository "${name}" is not tracked`);
    }
    await this.cleanupRepoDir(name);
    delete this.state.repositories[name];
    await this.persistState();
    this.emit("repoRemoved", name);
    this.emit("stateChanged", this.state);
  }

  // -----------------------------------------------------------------------
  // Agent management (within a repo)
  // -----------------------------------------------------------------------

  async setAgent(
    repoName: string,
    opts: {
      name: string;
      type: AgentType;
      status: AgentStatus;
      containerId?: string;
    },
  ): Promise<AgentState> {
    const repo = this.requireRepo(repoName);
    const now = new Date().toISOString();
    const existing = repo.agents[opts.name];
    const agent: AgentState = {
      name: opts.name,
      type: opts.type,
      status: opts.status,
      containerId: opts.containerId,
      lastActivity: now,
      startedAt: existing?.startedAt ?? now,
    };
    repo.agents[opts.name] = agent;
    repo.updatedAt = now;
    await this.persistState();
    this.emit("agentUpdated", repoName, agent);
    this.emit("stateChanged", this.state);
    return agent;
  }

  async updateAgentStatus(
    repoName: string,
    agentName: string,
    status: AgentStatus,
    error?: string,
  ): Promise<AgentState> {
    const repo = this.requireRepo(repoName);
    const agent = repo.agents[agentName];
    if (!agent) {
      throw new Error(
        `Agent "${agentName}" not found in repo "${repoName}"`,
      );
    }
    agent.status = status;
    agent.lastActivity = new Date().toISOString();
    if (error !== undefined) agent.error = error;
    repo.updatedAt = agent.lastActivity;
    await this.persistState();
    this.emit("agentUpdated", repoName, agent);
    this.emit("stateChanged", this.state);
    return agent;
  }

  // -----------------------------------------------------------------------
  // Worker management (within a repo)
  // -----------------------------------------------------------------------

  /**
   * Pick the next available candy name that isn't already in use for the
   * given repo. Uses adjective+candy combinations (400 unique names).
   * Falls back to numbering if all combinations are exhausted.
   */
  nextWorkerName(repoName: string): string {
    const repo = this.requireRepo(repoName);
    const used = new Set(Object.keys(repo.workers));
    const available = CANDY_NAMES.find((n) => !used.has(n));
    if (available) return available;
    // Fallback: find a name with suffix -N
    for (const baseName of CANDY_NAMES) {
      let n = 2;
      while (n <= 100) {
        const numbered = `${baseName}-${n}`;
        if (!used.has(numbered)) return numbered;
        n++;
      }
    }
    // Ultimate fallback
    return `Worker-${Object.keys(repo.workers).length + 1}`;
  }

  async addWorker(
    repoName: string,
    opts: {
      task: string;
      branch?: string;
      name?: string;
      model?: string;
    },
  ): Promise<WorkerState> {
    const repo = this.requireRepo(repoName);
    const name = opts.name ?? this.nextWorkerName(repoName);

    if (repo.workers[name]) {
      throw new Error(
        `Worker "${name}" already exists in repo "${repoName}"`,
      );
    }

    const maxWorkers =
      this.config.maxWorkersPerRepo;
    if (Object.keys(repo.workers).length >= maxWorkers) {
      throw new Error(
        `Maximum workers (${maxWorkers}) reached for repo "${repoName}"`,
      );
    }

    const now = new Date().toISOString();
    const worker: WorkerState = {
      id: randomUUID(),
      name,
      task: opts.task,
      branch: opts.branch ?? `work/${name}`,
      status: "starting",
      model: opts.model,
      createdAt: now,
      updatedAt: now,
    };

    repo.workers[name] = worker;
    repo.updatedAt = now;
    await this.persistState();
    this.emit("workerAdded", repoName, worker);
    this.emit("stateChanged", this.state);
    return worker;
  }

  async updateWorkerStatus(
    repoName: string,
    workerName: string,
    status: WorkerStatus,
    extra?: Partial<Pick<WorkerState, "containerId" | "prNumber" | "prUrl" | "error">>,
  ): Promise<WorkerState> {
    const worker = this.requireWorker(repoName, workerName);
    worker.status = status;
    worker.updatedAt = new Date().toISOString();
    if (status === "completed" || status === "failed") {
      worker.completedAt = worker.updatedAt;
    }
    if (extra) {
      if (extra.containerId !== undefined) worker.containerId = extra.containerId;
      if (extra.prNumber !== undefined) worker.prNumber = extra.prNumber;
      if (extra.prUrl !== undefined) worker.prUrl = extra.prUrl;
      if (extra.error !== undefined) worker.error = extra.error;
    }

    const repo = this.requireRepo(repoName);
    repo.updatedAt = worker.updatedAt;
    await this.persistState();
    this.emit("workerUpdated", repoName, worker);
    this.emit("stateChanged", this.state);
    return worker;
  }

  async removeWorker(repoName: string, workerName: string): Promise<void> {
    const repo = this.requireRepo(repoName);
    if (!repo.workers[workerName]) {
      throw new Error(
        `Worker "${workerName}" not found in repo "${repoName}"`,
      );
    }
    delete repo.workers[workerName];
    repo.updatedAt = new Date().toISOString();
    await this.persistState();
    this.emit("workerRemoved", repoName, workerName);
    this.emit("stateChanged", this.state);
  }

  /** Remove the on-disk repo directory under ~/.cocopilot/repos/<name>. */
  private async cleanupRepoDir(name: string): Promise<void> {
    const repoDir = path.resolve(this.baseDir, "repos", name);
    const reposRoot = path.resolve(this.baseDir, "repos") + path.sep;

    // Safety check: only delete paths under the repos root
    if (!repoDir.startsWith(reposRoot)) {
      return;
    }

    try {
      await fs.promises.rm(repoDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; ignore errors
    }
  }

  getWorker(
    repoName: string,
    workerName: string,
  ): Readonly<WorkerState> | undefined {
    return this.state.repositories[repoName]?.workers[workerName];
  }

  /**
   * Record a successful merge for the repo.
   */
  async recordMerge(repoName: string): Promise<void> {
    const repo = this.requireRepo(repoName);
    repo.lastMerge = new Date().toISOString();
    repo.updatedAt = repo.lastMerge;
    await this.persistState();
    this.emit("stateChanged", this.state);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  getBaseDir(): string {
    return this.baseDir;
  }

  private requireRepo(name: string): RepoState {
    const repo = this.state.repositories[name];
    if (!repo) {
      throw new Error(`Repository "${name}" is not tracked`);
    }
    return repo;
  }

  private requireWorker(repoName: string, workerName: string): WorkerState {
    const repo = this.requireRepo(repoName);
    const worker = repo.workers[workerName];
    if (!worker) {
      throw new Error(
        `Worker "${workerName}" not found in repo "${repoName}"`,
      );
    }
    return worker;
  }
}
