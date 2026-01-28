/**
 * Custom Agent Loader
 *
 * Parses markdown agent definition files from .cocopilot/agents/.
 * Each file uses YAML frontmatter for configuration and the markdown
 * body as the system prompt.
 *
 * Frontmatter fields:
 *   - name: Agent display name
 *   - class: "persistent" | "ephemeral"
 *   - tools: string[] of tool names
 *
 * Example .cocopilot/agents/reviewer.md:
 * ```
 * ---
 * name: reviewer
 * class: persistent
 * tools:
 *   - read_file
 *   - search_code
 * ---
 * You are a code reviewer agent. Review PRs for style and correctness.
 * ```
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported agent lifecycle classes. */
export type AgentClass = "persistent" | "ephemeral";

/** Parsed result from a .cocopilot/agents/*.md definition file. */
export interface ParsedAgentDef {
  /** Agent name from frontmatter. */
  name: string;
  /** Agent lifecycle class. */
  class: AgentClass;
  /** Tool names the agent has access to. */
  tools: string[];
  /** System prompt (markdown body after frontmatter). */
  systemPrompt: string;
  /** Absolute path of the source definition file. */
  filePath: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse a simple YAML frontmatter block.
 *
 * Supports scalar values and simple arrays (lines starting with "  - ").
 * This avoids pulling in a full YAML parser dependency for the minimal
 * frontmatter format we need.
 */
function parseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);

  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of lines) {
    // Skip blank lines and comments
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    // Array item: "  - value"
    const arrayMatch = line.match(/^\s+-\s+(.+)$/);
    if (arrayMatch && currentKey && currentArray) {
      currentArray.push(arrayMatch[1].trim());
      continue;
    }

    // Flush any pending array
    if (currentKey && currentArray) {
      result[currentKey] = currentArray;
      currentKey = null;
      currentArray = null;
    }

    // Key-value: "key: value" or "key:" (start of array)
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();

      if (value === "") {
        // Start of an array block
        currentKey = key;
        currentArray = [];
      } else {
        result[key] = value;
      }
    }
  }

  // Flush trailing array
  if (currentKey && currentArray) {
    result[currentKey] = currentArray;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateAgentClass(value: unknown): AgentClass {
  if (value === "persistent" || value === "ephemeral") {
    return value;
  }
  throw new Error(
    `Invalid agent class "${String(value)}". Must be "persistent" or "ephemeral".`,
  );
}

function validateTools(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item !== "string") {
      throw new Error(`Invalid tool entry: expected string, got ${typeof item}`);
    }
    return item;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a single agent definition file.
 *
 * @param filePath - Absolute path to the markdown definition file.
 * @returns Parsed agent definition.
 * @throws If the file cannot be read, has no frontmatter, or has invalid fields.
 */
export async function parseAgentDefinition(
  filePath: string,
): Promise<ParsedAgentDef> {
  const raw = await fs.promises.readFile(filePath, "utf-8");
  const match = raw.match(FRONTMATTER_REGEX);

  if (!match) {
    throw new Error(
      `Agent definition "${filePath}" is missing YAML frontmatter (--- delimiters).`,
    );
  }

  const [, frontmatterRaw, body] = match;
  const frontmatter = parseFrontmatter(frontmatterRaw);

  // Validate required fields
  if (!frontmatter.name || typeof frontmatter.name !== "string") {
    throw new Error(
      `Agent definition "${filePath}" is missing required "name" field.`,
    );
  }

  if (!frontmatter.class) {
    throw new Error(
      `Agent definition "${filePath}" is missing required "class" field.`,
    );
  }

  return {
    name: frontmatter.name as string,
    class: validateAgentClass(frontmatter.class),
    tools: validateTools(frontmatter.tools),
    systemPrompt: body.trim(),
    filePath: path.resolve(filePath),
  };
}

/**
 * Load all agent definitions from a directory.
 *
 * Scans for *.md files and parses each one. Files that fail to parse
 * are skipped with a warning logged to stderr.
 *
 * @param dir - Absolute path to the agents directory (e.g., ".cocopilot/agents").
 * @returns Array of successfully parsed agent definitions.
 */
export async function loadAllAgents(dir: string): Promise<ParsedAgentDef[]> {
  let entries: string[];

  try {
    entries = await fs.promises.readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const mdFiles = entries
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(dir, f));

  const results: ParsedAgentDef[] = [];

  for (const filePath of mdFiles) {
    try {
      const def = await parseAgentDefinition(filePath);
      results.push(def);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Warning: skipping "${filePath}" — ${message}`);
    }
  }

  return results;
}
