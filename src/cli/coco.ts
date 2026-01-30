#!/usr/bin/env node

/**
 * CoCoPilot CLI — `coco`
 *
 * Main entry point for the CoCoPilot command-line interface.
 * Manages daemon lifecycle, repository tracking, and worker orchestration.
 */

import { Command } from "commander";
import { registerStartCommand } from "./commands/start.js";
import { registerStopCommand } from "./commands/stop.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerInitCommand } from "./commands/init.js";
import { registerListCommand } from "./commands/list.js";
import { registerAgentsCommand } from "./commands/agents.js";
import { registerConfigCommand } from "./commands/config-keys.js";
import { registerRemoveCommand } from "./commands/remove.js";
import { registerMulticlaudeCompatCommands } from "./commands/multiclaude.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("coco")
    .description(
      "CoCoPilot — Collaborative Copilot Orchestration Platform CLI",
    )
    .version("0.1.0");

  registerStartCommand(program);
  registerStopCommand(program);
  registerStatusCommand(program);
  registerInitCommand(program);
  registerListCommand(program);
  registerRemoveCommand(program);
  registerAgentsCommand(program);
  registerConfigCommand(program);
  registerMulticlaudeCompatCommands(program);

  return program;
}

// Run when invoked directly
const isDirectRun =
  typeof require !== "undefined" && require.main === module;

if (isDirectRun) {
  const program = createProgram();
  program.parse(process.argv);
}
