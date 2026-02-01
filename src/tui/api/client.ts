/**
 * TUI API Client - HTTP + WebSocket client for communicating with the daemon
 */

import { io, Socket } from "socket.io-client";

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
    return this.fetch("/api/v1/status");
  }

  // Repositories
  async getRepositories(): Promise<Repository[]> {
    const data = await this.fetch<{ repositories: Repository[] }>("/api/v1/repositories");
    return data.repositories ?? [];
  }

  async getRepository(name: string): Promise<Repository> {
    return this.fetch(`/api/v1/repositories/${encodeURIComponent(name)}`);
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
    const path = repoName
      ? `/api/v1/workers?repo=${encodeURIComponent(repoName)}`
      : "/api/v1/workers";
    const data = await this.fetch<{ workers: Worker[] }>(path);
    return data.workers ?? [];
  }

  async getWorker(repoName: string, workerName: string): Promise<Worker> {
    return this.fetch(`/api/v1/workers/${encodeURIComponent(repoName)}/${encodeURIComponent(workerName)}`);
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
