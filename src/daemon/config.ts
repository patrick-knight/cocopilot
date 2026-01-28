import * as fs from "node:fs";
import * as path from "node:path";
import type { CocoConfig } from "../types/index.js";

const COCOPILOT_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".cocopilot"
);
const CONFIG_PATH = path.join(COCOPILOT_DIR, "config.json");

const DEFAULT_CONFIG: CocoConfig = {
  model: "claude-sonnet-4-5",
  webPort: 3000,
  maxWorkersPerRepo: 10,
  workerTimeout: "4h",
  supervisorNudgeInterval: "5m",
  mergeQueuePollInterval: "2m",
  containerMemoryLimit: "4g",
  containerCpuLimit: "2",
  autoMerge: true,
  theme: "dark-chocolate",
  github: {
    defaultBranch: "main",
    prLabels: ["cocopilot"],
    requireCI: true,
  },
  redis: {
    host: "localhost",
    port: 6379,
  },
};

export function getCocopilotDir(): string {
  return COCOPILOT_DIR;
}

export function ensureCocopilotDir(): void {
  fs.mkdirSync(COCOPILOT_DIR, { recursive: true });
  fs.mkdirSync(path.join(COCOPILOT_DIR, "repos"), { recursive: true });
  fs.mkdirSync(path.join(COCOPILOT_DIR, "web", "logs"), { recursive: true });
}

export function loadConfig(): CocoConfig {
  ensureCocopilotDir();

  if (!fs.existsSync(CONFIG_PATH)) {
    // Write default config if none exists
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  const userConfig = JSON.parse(raw) as Partial<CocoConfig>;

  // Merge with defaults so missing keys get filled in
  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    github: { ...DEFAULT_CONFIG.github, ...userConfig.github },
    redis: { ...DEFAULT_CONFIG.redis, ...userConfig.redis },
  };
}

export function saveConfig(config: CocoConfig): void {
  ensureCocopilotDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
