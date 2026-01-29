import { fork } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { isDaemonRunning, readPid } from "../daemon/pid.js";
import { getCocopilotDir, ensureCocopilotDir } from "../daemon/config.js";

/**
 * Start the Concher daemon as a detached background process.
 */
export async function startDaemon(foreground: boolean = false): Promise<void> {
  const { running, pid } = isDaemonRunning();
  if (running) {
    console.log(`Concher daemon is already running (PID ${pid})`);
    return;
  }

  ensureCocopilotDir();

  if (foreground) {
    console.log("Starting Concher daemon in foreground...");
    // Run in current process
    const { Concher } = await import("../daemon/concher.js");
    const daemon = new Concher();
    const started = await daemon.start();
    if (!started) {
      console.error("Failed to start daemon");
      process.exit(1);
    }
    // Keep process alive until a signal triggers shutdown
    const keepAlive = setInterval(() => {}, 60_000);
    keepAlive.unref?.();
    await new Promise<void>(() => {});
  }

  // Fork a detached child process running the daemon entry point
  const entryPoint = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "daemon-entry.js"
  );

  const logPath = path.join(getCocopilotDir(), "daemon.log");
  const logFd = fs.openSync(logPath, "a");

  const child = fork(entryPoint, [], {
    detached: true,
    stdio: ["ignore", logFd, logFd, "ipc"],
    env: { ...process.env, COCOPILOT_DAEMONIZED: "1" },
  });

  // Wait for the child to report success or failure
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.disconnect?.();
      child.unref();
      reject(new Error("Daemon startup timed out"));
    }, 10_000);

    child.on("message", (msg: { status: string; pid?: number; error?: string }) => {
      clearTimeout(timeout);
      if (msg.status === "started") {
        console.log(`Concher daemon started (PID ${msg.pid})`);
        child.disconnect?.();
        child.unref();
        resolve();
      } else {
        reject(new Error(msg.error || "Daemon failed to start"));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Daemon exited with code ${code}`));
      }
    });
  });

  fs.closeSync(logFd);
}

/**
 * Stop the running Concher daemon by sending SIGTERM.
 */
export async function stopDaemon(): Promise<void> {
  const { running, pid } = isDaemonRunning();
  if (!running || pid === null) {
    console.log("Concher daemon is not running");
    return;
  }

  console.log(`Stopping Concher daemon (PID ${pid})...`);

  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    console.error(`Failed to send SIGTERM to PID ${pid}:`, err);
    return;
  }

  // Wait for the process to exit
  const maxWait = 15_000;
  const interval = 250;
  let waited = 0;

  while (waited < maxWait) {
    await new Promise((r) => setTimeout(r, interval));
    waited += interval;

    const { running: stillRunning } = isDaemonRunning();
    if (!stillRunning) {
      console.log("Concher daemon stopped");
      return;
    }
  }

  console.error("Daemon did not stop gracefully, sending SIGKILL");
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process may have exited between check and kill
  }
  console.log("Concher daemon killed");
}

/**
 * Print the daemon's current status.
 */
export function daemonStatus(): void {
  const { running, pid } = isDaemonRunning();

  if (!running) {
    console.log("Concher daemon is not running");
    return;
  }

  console.log(`Concher daemon is running (PID ${pid})`);

  // Read state for more details
  const statePath = path.join(getCocopilotDir(), "state.json");
  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      const repoCount = state.repositories?.length || 0;
      const containerCount =
        state.containers?.filter((c: { status: string }) => c.status === "running")
          .length || 0;
      const startedAt = state.startedAt || "unknown";

      console.log(`  Started:    ${startedAt}`);
      console.log(`  Repos:      ${repoCount}`);
      console.log(`  Containers: ${containerCount} running`);
    } catch {
      // State file might be corrupted
    }
  }
}
