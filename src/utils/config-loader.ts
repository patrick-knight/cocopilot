/**
 * Shared utility for loading per-repository configuration from .cocopilot/config.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { RepoConfig } from "../state/schemas.js";

/**
 * Load per-repo configuration from .cocopilot/config.json
 *
 * @param localPath - Absolute path to the repository root
 * @returns RepoConfig object, or empty object if config does not exist or fails to parse
 */
export function loadRepoConfig(localPath: string): RepoConfig {
  try {
    const configPath = path.join(localPath, ".cocopilot", "config.json");
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8")) as RepoConfig;
    }
  } catch {
    // Ignore read errors
  }
  return {};
}

/**
 * Save per-repo configuration to .cocopilot/config.json
 *
 * @param localPath - Absolute path to the repository root
 * @param config - RepoConfig object to save
 */
export function saveRepoConfig(localPath: string, config: RepoConfig): void {
  const dir = path.join(localPath, ".cocopilot");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify(config, null, 2),
  );
}
