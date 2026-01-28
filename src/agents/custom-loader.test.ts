import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseAgentDefinition, loadAllAgents } from "./custom-loader";
import type { ParsedAgentDef } from "./custom-loader";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "coco-loader-"));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

async function writeAgentFile(name: string, content: string): Promise<string> {
  const filePath = path.join(tmpDir, name);
  await fs.promises.writeFile(filePath, content, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// parseAgentDefinition
// ---------------------------------------------------------------------------

describe("parseAgentDefinition", () => {
  it("parses a well-formed agent definition", async () => {
    const filePath = await writeAgentFile(
      "reviewer.md",
      [
        "---",
        "name: reviewer",
        "class: persistent",
        "tools:",
        "  - read_file",
        "  - search_code",
        "---",
        "You are a code reviewer agent.",
        "",
        "Review PRs for style and correctness.",
      ].join("\n"),
    );

    const def = await parseAgentDefinition(filePath);

    expect(def.name).toBe("reviewer");
    expect(def.class).toBe("persistent");
    expect(def.tools).toEqual(["read_file", "search_code"]);
    expect(def.systemPrompt).toBe(
      "You are a code reviewer agent.\n\nReview PRs for style and correctness.",
    );
    expect(def.filePath).toBe(path.resolve(filePath));
  });

  it("parses ephemeral agent class", async () => {
    const filePath = await writeAgentFile(
      "scanner.md",
      [
        "---",
        "name: scanner",
        "class: ephemeral",
        "tools:",
        "  - grep",
        "---",
        "Scan the codebase.",
      ].join("\n"),
    );

    const def = await parseAgentDefinition(filePath);

    expect(def.class).toBe("ephemeral");
  });

  it("handles definition with no tools", async () => {
    const filePath = await writeAgentFile(
      "simple.md",
      [
        "---",
        "name: simple-agent",
        "class: persistent",
        "---",
        "A simple agent with no tools.",
      ].join("\n"),
    );

    const def = await parseAgentDefinition(filePath);

    expect(def.name).toBe("simple-agent");
    expect(def.tools).toEqual([]);
    expect(def.systemPrompt).toBe("A simple agent with no tools.");
  });

  it("handles empty tools array", async () => {
    const filePath = await writeAgentFile(
      "empty-tools.md",
      [
        "---",
        "name: empty-tools",
        "class: ephemeral",
        "tools:",
        "---",
        "No tools here.",
      ].join("\n"),
    );

    const def = await parseAgentDefinition(filePath);

    expect(def.tools).toEqual([]);
  });

  it("preserves multiline system prompt", async () => {
    const filePath = await writeAgentFile(
      "multiline.md",
      [
        "---",
        "name: writer",
        "class: persistent",
        "---",
        "Line one.",
        "",
        "Line two.",
        "",
        "Line three.",
      ].join("\n"),
    );

    const def = await parseAgentDefinition(filePath);

    expect(def.systemPrompt).toBe("Line one.\n\nLine two.\n\nLine three.");
  });

  it("throws on missing frontmatter", async () => {
    const filePath = await writeAgentFile(
      "no-frontmatter.md",
      "Just some markdown without frontmatter.",
    );

    await expect(parseAgentDefinition(filePath)).rejects.toThrow(
      "missing YAML frontmatter",
    );
  });

  it("throws on missing name field", async () => {
    const filePath = await writeAgentFile(
      "no-name.md",
      ["---", "class: persistent", "---", "Body text."].join("\n"),
    );

    await expect(parseAgentDefinition(filePath)).rejects.toThrow(
      'missing required "name" field',
    );
  });

  it("throws on missing class field", async () => {
    const filePath = await writeAgentFile(
      "no-class.md",
      ["---", "name: test-agent", "---", "Body text."].join("\n"),
    );

    await expect(parseAgentDefinition(filePath)).rejects.toThrow(
      'missing required "class" field',
    );
  });

  it("throws on invalid class value", async () => {
    const filePath = await writeAgentFile(
      "bad-class.md",
      ["---", "name: bad", "class: invalid-class", "---", "Body."].join("\n"),
    );

    await expect(parseAgentDefinition(filePath)).rejects.toThrow(
      'Invalid agent class "invalid-class"',
    );
  });

  it("throws on non-existent file", async () => {
    await expect(
      parseAgentDefinition("/nonexistent/agent.md"),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// loadAllAgents
// ---------------------------------------------------------------------------

describe("loadAllAgents", () => {
  it("loads all valid .md files from a directory", async () => {
    await writeAgentFile(
      "alpha.md",
      ["---", "name: alpha", "class: persistent", "---", "Alpha agent."].join(
        "\n",
      ),
    );
    await writeAgentFile(
      "beta.md",
      [
        "---",
        "name: beta",
        "class: ephemeral",
        "tools:",
        "  - search",
        "---",
        "Beta agent.",
      ].join("\n"),
    );

    const agents = await loadAllAgents(tmpDir);

    expect(agents).toHaveLength(2);
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });

  it("ignores non-md files", async () => {
    await writeAgentFile(
      "valid.md",
      ["---", "name: valid", "class: persistent", "---", "Valid."].join("\n"),
    );
    await fs.promises.writeFile(
      path.join(tmpDir, "notes.txt"),
      "not an agent",
    );
    await fs.promises.writeFile(
      path.join(tmpDir, "config.json"),
      "{}",
    );

    const agents = await loadAllAgents(tmpDir);

    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("valid");
  });

  it("skips invalid files and logs warning", async () => {
    await writeAgentFile(
      "good.md",
      ["---", "name: good", "class: persistent", "---", "Good."].join("\n"),
    );
    await writeAgentFile("bad.md", "no frontmatter here");

    const stderrSpy = jest.spyOn(console, "error").mockImplementation();

    const agents = await loadAllAgents(tmpDir);

    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("good");
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("skipping"),
    );

    stderrSpy.mockRestore();
  });

  it("returns empty array for non-existent directory", async () => {
    const agents = await loadAllAgents("/nonexistent/directory");

    expect(agents).toEqual([]);
  });

  it("returns empty array for empty directory", async () => {
    const emptyDir = path.join(tmpDir, "empty");
    await fs.promises.mkdir(emptyDir);

    const agents = await loadAllAgents(emptyDir);

    expect(agents).toEqual([]);
  });
});
