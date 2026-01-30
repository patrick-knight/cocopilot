// Mock the copilot SDK to avoid ESM import issues in test environment
jest.mock("../copilot/client.js", () => ({
  CopilotClientWrapper: jest.fn(),
}));

// Mock daemon lifecycle functions (daemon.ts uses import.meta.url unsupported by ts-jest)
jest.mock("./daemon", () => ({
  startDaemon: jest.fn().mockResolvedValue(undefined),
  stopDaemon: jest.fn().mockResolvedValue(undefined),
  daemonStatus: jest.fn(),
}));

// Mock daemon PID utilities (used by status command)
jest.mock("../daemon/pid", () => ({
  isDaemonRunning: jest.fn().mockReturnValue({ running: false, pid: null }),
  readPid: jest.fn().mockReturnValue(null),
}));

// Mock daemon config utilities (used by status, list, init commands)
jest.mock("../daemon/config", () => ({
  getCocopilotDir: jest.fn().mockReturnValue("/tmp/test-cocopilot"),
  ensureCocopilotDir: jest.fn(),
}));

import { createProgram } from "./coco";

describe("coco CLI program", () => {
  it("has correct name and version", () => {
    const program = createProgram();
    expect(program.name()).toBe("coco");
    expect(program.version()).toBe("0.1.0");
  });

  it("registers all expected commands", () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain("start");
    expect(commandNames).toContain("stop");
    expect(commandNames).toContain("status");
    expect(commandNames).toContain("init");
    expect(commandNames).toContain("list");
    expect(commandNames).toContain("remove");
    expect(commandNames).toContain("agents");
    expect(commandNames).toContain("config");
  });

  it("has expected number of commands", () => {
    const program = createProgram();
    expect(program.commands.length).toBeGreaterThanOrEqual(8);
  });
});

describe("start command", () => {
  it("has port and no-ui options", () => {
    const program = createProgram();
    const start = program.commands.find((c) => c.name() === "start")!;
    const optionNames = start.options.map((o) => o.long);
    expect(optionNames).toContain("--port");
    expect(optionNames).toContain("--no-ui");
  });

  it("defaults port to 3000", () => {
    const program = createProgram();
    const start = program.commands.find((c) => c.name() === "start")!;
    const portOpt = start.options.find((o) => o.long === "--port")!;
    expect(portOpt.defaultValue).toBe("3000");
  });
});

describe("stop command", () => {
  it("has force option", () => {
    const program = createProgram();
    const stop = program.commands.find((c) => c.name() === "stop")!;
    const optionNames = stop.options.map((o) => o.long);
    expect(optionNames).toContain("--force");
  });
});

describe("status command", () => {
  it("has json option", () => {
    const program = createProgram();
    const status = program.commands.find((c) => c.name() === "status")!;
    const optionNames = status.options.map((o) => o.long);
    expect(optionNames).toContain("--json");
  });
});

describe("init command", () => {
  it("requires repo-url argument", () => {
    const program = createProgram();
    const init = program.commands.find((c) => c.name() === "init")!;
    const args = init.registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0].name()).toBe("repo-url");
    expect(args[0].required).toBe(true);
  });

  it("has name option", () => {
    const program = createProgram();
    const init = program.commands.find((c) => c.name() === "init")!;
    const optionNames = init.options.map((o) => o.long);
    expect(optionNames).toContain("--name");
  });
});

describe("list command", () => {
  it("has json option", () => {
    const program = createProgram();
    const list = program.commands.find((c) => c.name() === "list")!;
    const optionNames = list.options.map((o) => o.long);
    expect(optionNames).toContain("--json");
  });
});
