/**
 * Entry point for the daemonized Concher process.
 * This file is forked by the CLI `start` command.
 */
import { Concher } from "../daemon/concher.js";

async function main(): Promise<void> {
  const daemon = new Concher();

  try {
    const started = await daemon.start();
    if (!started) {
      process.send?.({ status: "failed", error: "Failed to start daemon" });
      process.exit(1);
    }

    // Notify parent that we started successfully
    process.send?.({ status: "started", pid: process.pid });

    // Disconnect IPC so parent can exit
    if (process.connected) {
      process.disconnect?.();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.send?.({ status: "failed", error: message });
    process.exit(1);
  }
}

main();
