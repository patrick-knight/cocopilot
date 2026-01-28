#!/usr/bin/env node
import { Command } from "commander";
import { startDaemon, stopDaemon, daemonStatus } from "./daemon.js";
import { registerInitCommand } from "./commands/init.js";
import { registerListCommand } from "./commands/list.js";

export { createProgram } from "./coco.js";

const program = new Command();

program
  .name("coco")
  .description("CoCoPilot - Collaborative Copilot Orchestration Platform")
  .version("0.1.0");

// --- Daemon commands ---

program
  .command("start")
  .description("Start the Concher daemon")
  .option("--foreground", "Run in the foreground instead of daemonizing")
  .action(async (opts: { foreground?: boolean }) => {
    try {
      await startDaemon(opts.foreground);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

program
  .command("stop")
  .description("Stop the Concher daemon")
  .action(async () => {
    try {
      await stopDaemon();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show daemon status")
  .action(() => {
    daemonStatus();
  });

// --- Repository commands ---

registerInitCommand(program);
registerListCommand(program);

program.parse(process.argv);
