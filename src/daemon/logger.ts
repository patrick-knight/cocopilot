import * as fs from "node:fs";
import * as path from "node:path";
import type { LogLevel } from "../types/index.js";
import { getCocopilotDir, ensureCocopilotDir } from "./config.js";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private stream: fs.WriteStream | null = null;
  private minLevel: LogLevel;

  constructor(minLevel: LogLevel = "info") {
    this.minLevel = minLevel;
  }

  open(): void {
    ensureCocopilotDir();
    const logPath = path.join(getCocopilotDir(), "daemon.log");
    this.stream = fs.createWriteStream(logPath, { flags: "a" });
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.minLevel]) return;

    const timestamp = new Date().toISOString();
    const tag = level.toUpperCase().padEnd(5);
    let line = `[${timestamp}] ${tag} ${message}`;
    if (meta !== undefined) {
      line += ` ${JSON.stringify(meta)}`;
    }
    line += "\n";

    if (this.stream) {
      this.stream.write(line);
    }
    // Also write to stderr when running in foreground
    if (!process.env.COCOPILOT_DAEMONIZED) {
      process.stderr.write(line);
    }
  }

  debug(message: string, meta?: unknown): void {
    this.write("debug", message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.write("info", message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.write("warn", message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.write("error", message, meta);
  }
}

// Singleton logger for the daemon process
export const logger = new Logger();
