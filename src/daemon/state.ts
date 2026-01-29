import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type { DaemonState, RepoState, ContainerInfo } from "../types/index.js";
import { getCocopilotDir, ensureCocopilotDir } from "./config.js";
import { logger } from "./logger.js";

const STATE_VERSION = "1";

function getStatePath(): string {
  return path.join(getCocopilotDir(), "state.json");
}

function emptyState(): DaemonState {
  return {
    version: STATE_VERSION,
    pid: null,
    startedAt: null,
    repositories: [],
    containers: [],
  };
}

/**
 * Atomic write: write to a temp file then rename.
 * Prevents corruption from partial writes on crash.
 */
function atomicWrite(filePath: string, data: string): void {
  const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, filePath);
}

export class StateManager extends EventEmitter {
  private state: DaemonState;

  constructor() {
    super();
    this.state = emptyState();
  }

  load(): DaemonState {
    ensureCocopilotDir();
    const statePath = getStatePath();

    if (!fs.existsSync(statePath)) {
      this.state = emptyState();
      this.save();
      return this.state;
    }

    try {
      const raw = fs.readFileSync(statePath, "utf-8");
      this.state = JSON.parse(raw) as DaemonState;
      this.state.version = STATE_VERSION;
    } catch (err) {
      logger.error("Failed to parse state.json, starting fresh", err);
      this.state = emptyState();
      this.save();
    }

    return this.state;
  }

  save(): void {
    ensureCocopilotDir();
    atomicWrite(getStatePath(), JSON.stringify(this.state, null, 2));
  }

  getState(): DaemonState {
    return this.state;
  }

  setDaemonInfo(pid: number): void {
    this.state.pid = pid;
    this.state.startedAt = new Date().toISOString();
    this.save();
  }

  clearDaemonInfo(): void {
    this.state.pid = null;
    this.state.startedAt = null;
    this.save();
  }

  // --- Repository operations ---

  addRepository(repo: RepoState): void {
    this.state.repositories.push(repo);
    this.save();
  }

  removeRepository(name: string): RepoState | undefined {
    const idx = this.state.repositories.findIndex((r) => r.name === name);
    if (idx === -1) return undefined;
    const [removed] = this.state.repositories.splice(idx, 1);
    this.save();
    return removed;
  }

  getRepository(name: string): RepoState | undefined {
    return this.state.repositories.find((r) => r.name === name);
  }

  updateRepository(name: string, update: Partial<RepoState>): void {
    const repo = this.getRepository(name);
    if (repo) {
      Object.assign(repo, update);
      this.save();
    }
  }

  // --- Container operations ---

  addContainer(container: ContainerInfo): void {
    this.state.containers.push(container);
    this.save();
  }

  removeContainer(id: string): void {
    this.state.containers = this.state.containers.filter((c) => c.id !== id);
    this.save();
  }

  getContainer(id: string): ContainerInfo | undefined {
    return this.state.containers.find((c) => c.id === id);
  }

  updateContainer(id: string, update: Partial<ContainerInfo>): void {
    const container = this.getContainer(id);
    if (container) {
      Object.assign(container, update);
      this.save();
    }
  }

  getRunningContainers(): ContainerInfo[] {
    return this.state.containers.filter((c) => c.status === "running");
  }
}
