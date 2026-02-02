/**
 * TUI API Client - HTTP + WebSocket client for communicating with the daemon
 * 
 * Falls back to reading state.json directly when daemon is unavailable.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { io, Socket } from "socket.io-client";

// Path to state file
const STATE_FILE_PATH = path.join(os.homedir(), ".cocopilot", "state.json");

interface DaemonState {
  version: number;
  status: string;
  pid?: number;
  startedAt?: string;
  repositories: Record<string, {
    id: string;
    name: string;
    url: string;
    localPath: string;
    defaultBranch: string;
    mode: "singleplayer" | "multiplayer";
    status: string;
    workers: Record<string, {
      id: string;
      name: string;
      task: string;
      branch: string;
      status: string;
      model?: string;
      prNumber?: number;
      prUrl?: string;
      createdAt: string;
      updatedAt: string;
    }>;
    agents: Record<string, {
      name: string;
      type: string;
      status: string;
    }>;
    createdAt: string;
    updatedAt: string;
  }>;
}

/**
 * Read repositories directly from state.json file
 */
function readStateFile(): DaemonState | null {
  try {
    const content = fs.readFileSync(STATE_FILE_PATH, "utf-8");
    return JSON.parse(content) as DaemonState;
  } catch {
    return null;
  }
}

export interface StatusResponse {
  daemon: { status: string; uptime?: number };
  redis: { status: string; connected?: boolean };
  github: { status: string; authenticated?: boolean };
  copilotCli: { status: string; installed?: boolean };
  repositories: number;
  workers: {
    total: number;
    byStatus: Record<string, number>;
  };
}

export interface Repository {
  name: string;
  url: string;
  localPath: string;
  defaultBranch: string;
  mode: "singleplayer" | "multiplayer";
  workers: Record<string, Worker>;
  agents: Record<string, Agent>;
}

export interface Worker {
  name: string;
  status: string;
  task: string;
  branch?: string;
  prUrl?: string;
  model?: string;
  startedAt?: string;
}

export interface Agent {
  name: string;
  type: string;
  status: string;
}

interface WorkerOutputPayload {
  workerName: string;
  line: string;
}

interface AgentOutputPayload {
  agentName: string;
  line: string;
}

export interface MetricsResponse {
  throughput: { hour: string; count: number }[];
  cycleTime: { date: string; avgHours: number }[];
  ciSuccess: { passed: number; failed: number };
  tokenUsage: { model: string; tokens: number }[];
}

export type PRStage = "draft" | "ready" | "ci_running" | "ci_passed" | "ci_failed" | "merged";

export interface PRPipelineEntry {
  number: number;
  title: string;
  url: string;
  branch: string;
  author: string;
  stage: PRStage;
  workerName?: string;
  createdAt: string;
  updatedAt: string;
}

export class TuiApiClient {
  private baseUrl: string;
  private socket: Socket | null = null;

  constructor(port: number = 3000) {
    this.baseUrl = `http://localhost:${port}`;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  // Status
  async getStatus(): Promise<StatusResponse> {
    try {
      return this.fetch("/api/v1/status");
    } catch (err) {
      // Fallback: read directly from state file when daemon is unavailable
      const state = readStateFile();
      if (state) {
        const repos = Object.values(state.repositories);
        const allWorkers = repos.flatMap(r => Object.values(r.workers));
        const byStatus: Record<string, number> = {};
        for (const w of allWorkers) {
          byStatus[w.status] = (byStatus[w.status] || 0) + 1;
        }
        return {
          daemon: { status: state.status },
          redis: { status: "unknown" },
          github: { status: "unknown" },
          copilotCli: { status: "unknown" },
          repositories: repos.length,
          workers: {
            total: allWorkers.length,
            byStatus,
          },
        };
      }
      throw err;
    }
  }

  // Repositories
  async getRepositories(): Promise<Repository[]> {
    try {
      const data = await this.fetch<{ repositories?: Repository[] } | Repository[]>("/api/v1/repositories");
      // Handle both response formats: array or { repositories: [...] }
      if (Array.isArray(data)) {
        return data;
      }
      return data.repositories ?? [];
    } catch (err) {
      // Fallback: read directly from state file when daemon is unavailable
      const state = readStateFile();
      if (state && state.repositories) {
        return Object.values(state.repositories).map((repo) => ({
          name: repo.name,
          url: repo.url,
          localPath: repo.localPath,
          defaultBranch: repo.defaultBranch,
          mode: repo.mode,
          workers: repo.workers,
          agents: repo.agents,
        }));
      }
      throw err;
    }
  }

  async getRepository(name: string): Promise<Repository> {
    try {
      return this.fetch(`/api/v1/repositories/${encodeURIComponent(name)}`);
    } catch (err) {
      // Fallback: read directly from state file when daemon is unavailable
      const state = readStateFile();
      if (state && state.repositories && state.repositories[name]) {
        const repo = state.repositories[name];
        return {
          name: repo.name,
          url: repo.url,
          localPath: repo.localPath,
          defaultBranch: repo.defaultBranch,
          mode: repo.mode,
          workers: repo.workers,
          agents: repo.agents,
        };
      }
      throw err;
    }
  }

  async addRepository(url: string): Promise<Repository> {
    return this.fetch("/api/v1/repositories", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  }

  async deleteRepository(name: string): Promise<void> {
    await this.fetch(`/api/v1/repositories/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  async repairRepository(name: string): Promise<void> {
    await this.fetch(`/api/v1/repositories/${encodeURIComponent(name)}/repair`, {
      method: "POST",
    });
  }

  // PRs
  async getPRs(repoName: string): Promise<PRPipelineEntry[]> {
    try {
      const data = await this.fetch<{ prs: PRPipelineEntry[] }>(
        `/api/v1/repositories/${encodeURIComponent(repoName)}/prs`
      );
      return data.prs ?? [];
    } catch {
      // Fallback: extract PRs from workers in state file
      const state = readStateFile();
      if (state && state.repositories && state.repositories[repoName]) {
        const workers = Object.values(state.repositories[repoName].workers);
        return workers
          .filter((w: any) => w.prNumber != null)
          .map((w: any) => ({
            number: w.prNumber,
            title: w.task,
            url: w.prUrl ?? "",
            branch: w.branch,
            author: "cocopilot",
            stage: workerStatusToStage(w.status),
            workerName: w.name,
            createdAt: w.createdAt,
            updatedAt: w.updatedAt,
          }));
      }
      return [];
    }
  }

  // Workers
  async getWorkers(repoName?: string): Promise<Worker[]> {
    try {
      const path = repoName
        ? `/api/v1/workers?repo=${encodeURIComponent(repoName)}`
        : "/api/v1/workers";
      const data = await this.fetch<{ workers?: Worker[] } | Worker[]>(path);
      // Handle both response formats: array or { workers: [...] }
      if (Array.isArray(data)) {
        return data;
      }
      return data.workers ?? [];
    } catch (err) {
      // Fallback: read directly from state file when daemon is unavailable
      const state = readStateFile();
      if (state && state.repositories) {
        const allWorkers: Worker[] = [];
        for (const repo of Object.values(state.repositories)) {
          if (repoName && repo.name !== repoName) continue;
          for (const worker of Object.values(repo.workers)) {
            allWorkers.push({
              name: worker.name,
              status: worker.status,
              task: worker.task,
              branch: worker.branch,
              prUrl: worker.prUrl,
              model: worker.model,
              startedAt: worker.createdAt,
            });
          }
        }
        return allWorkers;
      }
      throw err;
    }
  }

  async getWorker(repoName: string, workerName: string): Promise<Worker> {
    try {
      // The external API uses just worker name: GET /api/v1/workers/:name
      return this.fetch(`/api/v1/workers/${encodeURIComponent(workerName)}`);
    } catch (err) {
      // Fallback: read directly from state file when daemon is unavailable
      const state = readStateFile();
      if (state && state.repositories && state.repositories[repoName]) {
        const worker = state.repositories[repoName].workers[workerName];
        if (worker) {
          return {
            name: worker.name,
            status: worker.status,
            task: worker.task,
            branch: worker.branch,
            prUrl: worker.prUrl,
            model: worker.model,
            startedAt: worker.createdAt,
          };
        }
      }
      throw err;
    }
  }

  async spawnWorker(repoName: string, task: string, options?: { branch?: string; model?: string }): Promise<Worker> {
    return this.fetch("/api/v1/workers", {
      method: "POST",
      body: JSON.stringify({ repoName, task, ...options }),
    });
  }

  async stopWorker(name: string): Promise<void> {
    await this.fetch(`/api/v1/workers/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  async pauseWorker(name: string): Promise<void> {
    await this.fetch(`/api/v1/workers/${encodeURIComponent(name)}/pause`, {
      method: "POST",
    });
  }

  async resumeWorker(name: string): Promise<void> {
    await this.fetch(`/api/v1/workers/${encodeURIComponent(name)}/resume`, {
      method: "POST",
    });
  }

  // Metrics
  async getMetrics(): Promise<MetricsResponse> {
    return this.fetch("/api/v1/metrics");
  }

  // WebSocket for streaming
  connect(): Socket {
    if (!this.socket) {
      this.socket = io(this.baseUrl, {
        transports: ["websocket"],
        reconnection: true,
      });
    }
    return this.socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  joinWorker(workerName: string): void {
    const socket = this.connect();
    socket.emit("worker:join", workerName);
  }

  leaveWorker(workerName: string): void {
    if (!this.socket) return;
    this.socket.emit("worker:leave", workerName);
  }

  subscribeAgent(agentName: string): void {
    const socket = this.connect();
    socket.emit("agent:stream:subscribe", agentName);
  }

  unsubscribeAgent(agentName: string): void {
    if (!this.socket) return;
    this.socket.emit("agent:stream:unsubscribe", agentName);
  }

  onWorkerOutput(callback: (data: WorkerOutputPayload) => void): () => void {
    const socket = this.connect();
    const handleSingle = (event: unknown) => {
      const parsed = this.normalizeWorkerOutput(event);
      if (parsed) callback(parsed);
    };
    const handleBatch = (batch: unknown) => {
      if (!Array.isArray(batch)) return;
      for (const event of batch) {
        handleSingle(event);
      }
    };

    socket.on("worker:output", handleSingle);
    socket.on("batch:worker:output", handleBatch);
    return () => {
      socket.off("worker:output", handleSingle);
      socket.off("batch:worker:output", handleBatch);
    };
  }

  onAgentOutput(callback: (data: AgentOutputPayload) => void): () => void {
    const socket = this.connect();
    const handleSingle = (event: unknown) => {
      const parsed = this.normalizeAgentOutput(event);
      if (parsed) callback(parsed);
    };
    const handleBatch = (batch: unknown) => {
      if (!Array.isArray(batch)) return;
      for (const event of batch) {
        handleSingle(event);
      }
    };

    socket.on("agent:output", handleSingle);
    socket.on("batch:agent:output", handleBatch);
    return () => {
      socket.off("agent:output", handleSingle);
      socket.off("batch:agent:output", handleBatch);
    };
  }

  onWorkerActivity(callback: (data: { workerName: string; timestamp: number; eventType?: string }) => void): () => void {
    const socket = this.connect();
    const handleSingle = (event: unknown) => {
      if (!event || typeof event !== "object") return;
      const payload = event as { workerName?: string; timestamp?: number; eventType?: string };
      if (typeof payload.workerName !== "string") return;
      callback({
        workerName: payload.workerName,
        timestamp: payload.timestamp ?? Date.now(),
        eventType: payload.eventType,
      });
    };
    const handleBatch = (batch: unknown) => {
      if (!Array.isArray(batch)) return;
      for (const event of batch) {
        handleSingle(event);
      }
    };

    socket.on("worker:activity", handleSingle);
    socket.on("batch:worker:activity", handleBatch);
    return () => {
      socket.off("worker:activity", handleSingle);
      socket.off("batch:worker:activity", handleBatch);
    };
  }

  onMessage(callback: (msg: { id: string; type: string; from: string; to: string; payload: unknown; timestamp: number }) => void): () => void {
    const socket = this.connect();
    socket.on("message:new", callback);
    return () => {
      socket.off("message:new", callback);
    };
  }

  async getMessages(repoName: string): Promise<{ id: string; type: string; from: string; to: string; payload: unknown; timestamp: number }[]> {
    try {
      const data = await this.fetch<{ messages: { id: string; type: string; from: string; to: string; payload: unknown; timestamp: number }[] }>(
        `/api/v1/repositories/${encodeURIComponent(repoName)}/messages`
      );
      return data.messages ?? [];
    } catch {
      return [];
    }
  }

  onStatusUpdate(callback: (status: StatusResponse) => void): () => void {
    const socket = this.connect();
    socket.on("status:update", callback);
    return () => {
      socket.off("status:update", callback);
    };
  }

  private normalizeWorkerOutput(event: unknown): WorkerOutputPayload | null {
    if (!event || typeof event !== "object") return null;
    const payload = event as {
      workerName?: string;
      worker?: string;
      content?: string;
      output?: string;
      text?: string;
    };
    const workerName = payload.workerName ?? payload.worker;
    const line = payload.content ?? payload.output ?? payload.text;
    if (typeof workerName !== "string" || typeof line !== "string") return null;
    return { workerName, line };
  }

  private normalizeAgentOutput(event: unknown): AgentOutputPayload | null {
    if (!event || typeof event !== "object") return null;
    const payload = event as { agent?: string; agentName?: string; text?: string; output?: string; content?: string };
    const agentName = payload.agentName ?? payload.agent;
    const line = payload.text ?? payload.output ?? payload.content;
    if (typeof agentName !== "string" || typeof line !== "string") return null;
    return { agentName, line };
  }
}

// Singleton instance
let client: TuiApiClient | null = null;
let clientPort: number | undefined = undefined;

export function getClient(port?: number): TuiApiClient {
  if (!client) {
    client = new TuiApiClient(port);
    clientPort = port;
  } else if (
    port !== undefined &&
    clientPort !== undefined &&
    port !== clientPort
  ) {
    console.warn(
      `TuiApiClient singleton already initialized on port ${clientPort}; ignoring requested port ${port}.`,
    );
  }
  return client;
}

/** Convert worker status to PR stage. */
function workerStatusToStage(status: string): PRStage {
  switch (status) {
    case "merged":
      return "merged";
    case "completed":
      return "ci_passed";
    case "failed":
      return "ci_failed";
    case "working":
      return "ci_running";
    case "starting":
      return "draft";
    default:
      return "ready";
  }
}
