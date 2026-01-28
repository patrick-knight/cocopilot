/**
 * CLI Commands: `coco agents`
 *
 * Subcommands:
 *   - `coco agents list`         — Scan .cocopilot/agents/*.md and display found definitions.
 *   - `coco agents spawn --from` — Parse and spawn a custom agent from a definition file.
 */

import * as path from "node:path";
import { Command } from "commander";
import {
  loadAllAgents,
  parseAgentDefinition,
  type ParsedAgentDef,
} from "../../agents/custom-loader.js";
import { CustomAgent } from "../../agents/custom-agent.js";

// ---------------------------------------------------------------------------
// Default agents directory
// ---------------------------------------------------------------------------

const DEFAULT_AGENTS_DIR = ".cocopilot/agents";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatAgentList(agents: ParsedAgentDef[]): string {
  if (agents.length === 0) {
    return [
      "No agent definitions found.",
      `Create markdown files in ${DEFAULT_AGENTS_DIR}/ to define custom agents.`,
    ].join("\n");
  }

  const nameWidth = Math.max(
    "NAME".length,
    ...agents.map((a) => a.name.length),
  );
  const classWidth = Math.max(
    "CLASS".length,
    ...agents.map((a) => a.class.length),
  );
  const toolsWidth = Math.max(
    "TOOLS".length,
    ...agents.map((a) => a.tools.join(", ").length || 4),
  );

  const lines: string[] = [];

  const header = [
    "NAME".padEnd(nameWidth),
    "CLASS".padEnd(classWidth),
    "TOOLS".padEnd(toolsWidth),
    "FILE",
  ].join("  ");

  lines.push(header);
  lines.push("-".repeat(header.length));

  for (const agent of agents) {
    const toolsStr = agent.tools.length > 0 ? agent.tools.join(", ") : "none";
    lines.push(
      [
        agent.name.padEnd(nameWidth),
        agent.class.padEnd(classWidth),
        toolsStr.padEnd(toolsWidth),
        path.basename(agent.filePath),
      ].join("  "),
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerAgentsCommand(program: Command): void {
  const agents = program
    .command("agents")
    .description("Manage custom agent definitions");

  // -- coco agents list -------------------------------------------------------

  agents
    .command("list")
    .description("List custom agent definitions from .cocopilot/agents/")
    .option("--dir <path>", "Path to agents directory", DEFAULT_AGENTS_DIR)
    .option("--json", "Output as JSON")
    .action(async (options: { dir: string; json?: boolean }) => {
      try {
        const dir = path.resolve(options.dir);
        const defs = await loadAllAgents(dir);

        if (options.json) {
          console.log(JSON.stringify(defs, null, 2));
        } else {
          console.log(formatAgentList(defs));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to list agents — ${message}`);
        process.exitCode = 1;
      }
    });

  // -- coco agents spawn ------------------------------------------------------

  agents
    .command("spawn")
    .description("Parse and spawn a custom agent from a definition file")
    .requiredOption(
      "--from <file>",
      "Path to the agent definition markdown file",
    )
    .option("--model <model>", "Override the AI model for this agent")
    .action(async (options: { from: string; model?: string }) => {
      try {
        const filePath = path.resolve(options.from);
        const def = await parseAgentDefinition(filePath);

        console.log(`Parsed agent "${def.name}" (${def.class})`);
        console.log(`  Tools: ${def.tools.length > 0 ? def.tools.join(", ") : "none"}`);
        console.log(`  Prompt: ${def.systemPrompt.slice(0, 80)}${def.systemPrompt.length > 80 ? "..." : ""}`);

        const agent = new CustomAgent(def, { model: options.model });
        await agent.start();

        const status = agent.getStatus();
        console.log(`Agent "${status.name}" started (status: ${status.status})`);

        // For persistent agents, keep the process alive
        if (def.class === "persistent") {
          console.log("Persistent agent running. Press Ctrl+C to stop.");

          const shutdown = async () => {
            console.log(`\nStopping agent "${def.name}"...`);
            await agent.stop();
            console.log("Agent stopped.");
            process.exit(0);
          };

          process.on("SIGINT", shutdown);
          process.on("SIGTERM", shutdown);
        } else {
          // Ephemeral agents stop immediately after spawning
          console.log("Ephemeral agent spawned. Stopping...");
          await agent.stop();
          console.log("Agent stopped.");
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("ENOENT")) {
          console.error(
            `Error: Agent definition file not found: ${options.from}`,
          );
        } else {
          console.error(`Error: Failed to spawn agent — ${message}`);
        }
        process.exitCode = 1;
      }
    });
}
