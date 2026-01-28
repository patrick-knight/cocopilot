jest.mock("@github/copilot-sdk", () => ({
  CopilotClient: jest.fn(),
  CopilotSession: jest.fn(),
  defineTool: jest.fn((name: string, config: Record<string, unknown>) => ({
    name,
    ...config,
  })),
}));

// Mock the copilot SDK to avoid ESM import issues in test environment
jest.mock("../../copilot/client.js", () => ({
  CopilotClientWrapper: jest.fn(),
}));

// Mock daemon lifecycle functions (daemon.ts uses import.meta.url unsupported by ts-jest)
jest.mock("../daemon", () => ({
  startDaemon: jest.fn().mockResolvedValue(undefined),
  stopDaemon: jest.fn().mockResolvedValue(undefined),
  daemonStatus: jest.fn(),
}));

// Mock daemon PID utilities (used by status command)
jest.mock("../../daemon/pid", () => ({
  isDaemonRunning: jest.fn().mockReturnValue({ running: false, pid: null }),
  readPid: jest.fn().mockReturnValue(null),
}));

// Mock daemon config utilities (used by status, list, init commands)
jest.mock("../../daemon/config", () => ({
  getCocopilotDir: jest.fn().mockReturnValue("/tmp/test-cocopilot"),
  ensureCocopilotDir: jest.fn(),
}));

import { createProgram } from "../coco.js";

describe("config keys CLI", () => {
  it("registers the config command", () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain("config");
  });

  it("has keys subcommand under config", () => {
    const program = createProgram();
    const config = program.commands.find((c) => c.name() === "config")!;
    const subNames = config.commands.map((c) => c.name());
    expect(subNames).toContain("keys");
  });

  it("has set and list subcommands under keys", () => {
    const program = createProgram();
    const config = program.commands.find((c) => c.name() === "config")!;
    const keys = config.commands.find((c) => c.name() === "keys")!;
    const subNames = keys.commands.map((c) => c.name());
    expect(subNames).toContain("set");
    expect(subNames).toContain("list");
  });

  describe("set command", () => {
    it("requires provider and key arguments", () => {
      const program = createProgram();
      const config = program.commands.find((c) => c.name() === "config")!;
      const keys = config.commands.find((c) => c.name() === "keys")!;
      const set = keys.commands.find((c) => c.name() === "set")!;

      const args = set.registeredArguments;
      expect(args).toHaveLength(2);
      expect(args[0].name()).toBe("provider");
      expect(args[1].name()).toBe("key");
    });

    it("has --skip-validation option", () => {
      const program = createProgram();
      const config = program.commands.find((c) => c.name() === "config")!;
      const keys = config.commands.find((c) => c.name() === "keys")!;
      const set = keys.commands.find((c) => c.name() === "set")!;

      const optionNames = set.options.map((o) => o.long);
      expect(optionNames).toContain("--skip-validation");
    });
  });
});
