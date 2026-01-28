import * as fs from "node:fs";
import * as path from "node:path";
import { getCocopilotDir } from "./config.js";

function getPidPath(): string {
  return path.join(getCocopilotDir(), "daemon.pid");
}

/**
 * Check if a process with the given PID is actually running.
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks existence without killing
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write the current process PID to the PID file.
 * Returns false if another daemon is already running.
 */
export function writePid(): boolean {
  const pidPath = getPidPath();
  const existingPid = readPid();

  if (existingPid !== null && isProcessRunning(existingPid)) {
    return false; // Another daemon is running
  }

  // Remove stale PID file if it exists
  if (existingPid !== null) {
    removePid();
  }

  fs.writeFileSync(pidPath, String(process.pid));
  return true;
}

/**
 * Read the PID from the PID file. Returns null if no file or invalid.
 */
export function readPid(): number | null {
  const pidPath = getPidPath();

  if (!fs.existsSync(pidPath)) {
    return null;
  }

  const content = fs.readFileSync(pidPath, "utf-8").trim();
  const pid = parseInt(content, 10);
  return Number.isFinite(pid) ? pid : null;
}

/**
 * Remove the PID file.
 */
export function removePid(): void {
  const pidPath = getPidPath();
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Check if the daemon is currently running.
 * Cleans up stale PID files.
 */
export function isDaemonRunning(): { running: boolean; pid: number | null } {
  const pid = readPid();

  if (pid === null) {
    return { running: false, pid: null };
  }

  if (isProcessRunning(pid)) {
    return { running: true, pid };
  }

  // Stale PID file - clean it up
  removePid();
  return { running: false, pid: null };
}
