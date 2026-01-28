// Mock the copilot SDK before any imports that transitively depend on it
jest.mock("../../copilot/client.js", () => ({
  CopilotClientWrapper: jest.fn(),
}));

import { formatAgentList } from "./agents";
import type { ParsedAgentDef } from "../../agents/custom-loader";

// ---------------------------------------------------------------------------
// formatAgentList
// ---------------------------------------------------------------------------

describe("formatAgentList", () => {
  it("displays a message when no agents are found", () => {
    const output = formatAgentList([]);

    expect(output).toContain("No agent definitions found");
    expect(output).toContain(".cocopilot/agents/");
  });

  it("formats a table with agent definitions", () => {
    const agents: ParsedAgentDef[] = [
      {
        name: "reviewer",
        class: "persistent",
        tools: ["read_file", "search_code"],
        systemPrompt: "Review PRs.",
        filePath: "/project/.cocopilot/agents/reviewer.md",
      },
      {
        name: "scanner",
        class: "ephemeral",
        tools: ["grep"],
        systemPrompt: "Scan code.",
        filePath: "/project/.cocopilot/agents/scanner.md",
      },
    ];

    const output = formatAgentList(agents);

    // Header row
    expect(output).toContain("NAME");
    expect(output).toContain("CLASS");
    expect(output).toContain("TOOLS");
    expect(output).toContain("FILE");

    // Data rows
    expect(output).toContain("reviewer");
    expect(output).toContain("persistent");
    expect(output).toContain("read_file, search_code");
    expect(output).toContain("reviewer.md");

    expect(output).toContain("scanner");
    expect(output).toContain("ephemeral");
    expect(output).toContain("grep");
    expect(output).toContain("scanner.md");
  });

  it("shows 'none' for agents with no tools", () => {
    const agents: ParsedAgentDef[] = [
      {
        name: "simple",
        class: "persistent",
        tools: [],
        systemPrompt: "Simple agent.",
        filePath: "/project/.cocopilot/agents/simple.md",
      },
    ];

    const output = formatAgentList(agents);

    expect(output).toContain("none");
  });

  it("includes separator line between header and data", () => {
    const agents: ParsedAgentDef[] = [
      {
        name: "test",
        class: "ephemeral",
        tools: [],
        systemPrompt: "Test.",
        filePath: "/project/.cocopilot/agents/test.md",
      },
    ];

    const output = formatAgentList(agents);
    const lines = output.split("\n");

    // Second line should be dashes
    expect(lines[1]).toMatch(/^-+$/);
  });
});
