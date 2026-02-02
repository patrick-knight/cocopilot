/**
 * Custom Agent Loader
 *
 * Loads custom agent definitions from .cocopilot/agents/ directory.
 * Each agent is defined in a markdown file with YAML frontmatter:
 *
 * ```markdown
 * ---
 * name: my-agent
 * description: A custom agent for specific tasks
 * model: claude-sonnet-4-5
 * triggers:
 *   - "fix bug"
 *   - "refactor"
 * tools:
 *   - read_file
 *   - edit_file
 * ---
 *
 * # System Prompt
 *
 * You are a custom agent that...
 * ```
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CustomAgentDefinition {
  /** Unique name for the agent (from filename or frontmatter). */
  name: string;
  /** Human-readable description. */
  description?: string;
  /** Model to use (overrides global default). */
  model?: string;
  /** Trigger phrases that suggest this agent should handle a task. */
  triggers?: string[];
  /** Allowed tools for this agent. */
  tools?: string[];
  /** System prompt (markdown body after frontmatter). */
  systemPrompt: string;
  /** Path to the source file. */
  sourcePath: string;
}

export interface CustomAgentLoaderOptions {
  /** Path to the repository root. */
  repoPath: string;
  /** Directory name within .cocopilot for agents. Default: "agents" */
  agentsDir?: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

interface Frontmatter {
  name?: string;
  description?: string;
  model?: string;
  triggers?: string[];
  tools?: string[];
}

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  
  if (!match) {
    return { frontmatter: {}, body: content.trim() };
  }

  const [, yamlPart, bodyPart] = match;
  const frontmatter: Frontmatter = {};

  // Simple YAML-like parsing (avoiding external dependencies)
  for (const line of yamlPart.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Handle arrays (triggers, tools)
    if (trimmed.startsWith("- ")) {
      continue; // Handled below
    }

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    let value = trimmed.slice(colonIndex + 1).trim();

    // Remove quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key === "name") frontmatter.name = value;
    else if (key === "description") frontmatter.description = value;
    else if (key === "model") frontmatter.model = value;
  }

  // Parse arrays
  const triggersMatch = yamlPart.match(/triggers:\s*\n((?:\s*-\s*.+\n?)*)/);
  if (triggersMatch) {
    frontmatter.triggers = triggersMatch[1]
      .split(/\r?\n/)
      .filter(l => l.trim().startsWith("- "))
      .map(l => {
        let v = l.trim().slice(2).trim();
        if ((v.startsWith('"') && v.endsWith('"')) ||
            (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        return v;
      });
  }

  const toolsMatch = yamlPart.match(/tools:\s*\n((?:\s*-\s*.+\n?)*)/);
  if (toolsMatch) {
    frontmatter.tools = toolsMatch[1]
      .split(/\r?\n/)
      .filter(l => l.trim().startsWith("- "))
      .map(l => {
        let v = l.trim().slice(2).trim();
        if ((v.startsWith('"') && v.endsWith('"')) ||
            (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        return v;
      });
  }

  return { frontmatter, body: bodyPart.trim() };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load all custom agent definitions from a repository's .cocopilot/agents/ directory.
 */
export async function loadCustomAgents(
  options: CustomAgentLoaderOptions
): Promise<CustomAgentDefinition[]> {
  const { repoPath, agentsDir = "agents" } = options;
  const agentsPath = path.join(repoPath, ".cocopilot", agentsDir);

  // Check if directory exists
  try {
    const stat = await fs.stat(agentsPath);
    if (!stat.isDirectory()) {
      return [];
    }
  } catch {
    // Directory doesn't exist
    return [];
  }

  const agents: CustomAgentDefinition[] = [];
  const entries = await fs.readdir(agentsPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md") && !entry.name.endsWith(".markdown")) continue;

    const filePath = path.join(agentsPath, entry.name);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);

      // Use filename (without extension) as fallback name
      const baseName = entry.name.replace(/\.(md|markdown)$/, "");
      const name = frontmatter.name || baseName;

      agents.push({
        name,
        description: frontmatter.description,
        model: frontmatter.model,
        triggers: frontmatter.triggers,
        tools: frontmatter.tools,
        systemPrompt: body,
        sourcePath: filePath,
      });
    } catch (err) {
      console.warn(`[CustomAgentLoader] Failed to load ${filePath}:`, err);
    }
  }

  return agents;
}

/**
 * Load a single custom agent by name.
 */
export async function loadCustomAgent(
  options: CustomAgentLoaderOptions,
  name: string
): Promise<CustomAgentDefinition | null> {
  const agents = await loadCustomAgents(options);
  return agents.find(a => a.name === name) ?? null;
}

/**
 * Find the best matching custom agent for a given task description.
 * Returns null if no agent has matching triggers.
 */
export function matchCustomAgent(
  agents: CustomAgentDefinition[],
  task: string
): CustomAgentDefinition | null {
  const taskLower = task.toLowerCase();
  
  // Score each agent by number of trigger matches
  let bestMatch: CustomAgentDefinition | null = null;
  let bestScore = 0;

  for (const agent of agents) {
    if (!agent.triggers || agent.triggers.length === 0) continue;

    let score = 0;
    for (const trigger of agent.triggers) {
      if (taskLower.includes(trigger.toLowerCase())) {
        score++;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = agent;
    }
  }

  return bestMatch;
}

/**
 * Watch for changes to custom agent definitions.
 * Returns a function to stop watching.
 */
export function watchCustomAgents(
  options: CustomAgentLoaderOptions,
  onChange: (agents: CustomAgentDefinition[]) => void
): () => void {
  const { repoPath, agentsDir = "agents" } = options;
  const agentsPath = path.join(repoPath, ".cocopilot", agentsDir);

  let watcher: fs.FileHandle | null = null;
  let abortController: AbortController | null = null;

  const startWatching = async () => {
    try {
      abortController = new AbortController();
      const asyncWatcher = fs.watch(agentsPath, { signal: abortController.signal });
      
      for await (const event of asyncWatcher) {
        if (event.filename?.endsWith(".md") || event.filename?.endsWith(".markdown")) {
          const agents = await loadCustomAgents(options);
          onChange(agents);
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.warn(`[CustomAgentLoader] Watch error:`, err);
      }
    }
  };

  startWatching();

  return () => {
    abortController?.abort();
  };
}
