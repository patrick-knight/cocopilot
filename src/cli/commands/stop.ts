import { Command } from "commander";
import { stopDaemon } from "../daemon.js";

export function registerStopCommand(program: Command): void {
  program
    .command("stop")
    .description("Stop all CoCoPilot services")
    .option("--force", "Force stop without waiting for workers to finish")
    .action(async (options: { force: boolean }) => {
      try {
        if (options.force) {
          console.log("Force stopping all CoCoPilot services...");
        } else {
          console.log("Stopping CoCoPilot services gracefully...");
        }

        await stopDaemon();

        console.log("All services stopped.");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("ECONNREFUSED")) {
          console.error("Error: Cannot reach the CoCoPilot daemon. It may already be stopped.");
        } else if (message.includes("docker")) {
          console.error("Error: Docker is not running. Start Docker Desktop and try again.");
        } else if (message.includes("EPERM") || message.includes("EACCES")) {
          console.error("Error: Permission denied. Try running with elevated privileges.");
        } else {
          console.error(`Error: Failed to stop services — ${message}`);
        }
        process.exitCode = 1;
      }
    });
}
