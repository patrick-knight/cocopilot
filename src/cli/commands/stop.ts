import { Command } from "commander";

export function registerStopCommand(program: Command): void {
  program
    .command("stop")
    .description("Stop all CoCoPilot services")
    .option("--force", "Force stop without waiting for workers to finish")
    .action(async (options: { force: boolean }) => {
      if (options.force) {
        console.log("Force stopping all CoCoPilot services...");
      } else {
        console.log("Stopping CoCoPilot services gracefully...");
      }

      // TODO: Implement actual daemon/container shutdown
      console.log("All services stopped.");
    });
}
