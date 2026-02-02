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

export interface MetricsResponse {
  throughput: { hour: string; count: number }[];
  cycleTime: { date: string; avgHours: number }[];
  ciSuccess: { passed: number; failed: number };
  tokenUsage: { model: string; tokens: number }[];
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
      return this.fetch(`/api/v1/workers/${encodeURIComponent(repoName)}/${encodeURIComponent(workerName)}`);
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

  onWorkerOutput(callback: (data: { worker: string; output: string }) => void): () => void {
    const socket = this.connect();
    socket.on("worker:output", callback);
    return () => {
      socket.off("worker:output", callback);
    };
  }

  onAgentOutput(callback: (data: { agent: string; output: string }) => void): () => void {
    const socket = this.connect();
    socket.on("agent:output", callback);
    return () => {
      socket.off("agent:output", callback);
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
