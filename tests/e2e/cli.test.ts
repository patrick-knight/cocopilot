/**
 * End-to-end tests for the CoCoPilot CLI.
 *
 * Tests the full CLI command flows: init, start, stop, list, status.
 * External dependencies (Docker, GitHub, daemon) are mocked.
 */

// Mock the copilot SDK to avoid ESM import issues in test environment
jest.mock("../../src/copilot/client.js", () => ({
  CopilotClientWrapper: jest.fn(),
}));

// Mock daemon lifecycle functions used by start/stop commands
jest.mock("../../src/cli/daemon", () => ({
  startDaemon: jest.fn().mockResolvedValue(undefined),
  stopDaemon: jest.fn().mockResolvedValue(undefined),
  daemonStatus: jest.fn(),
}));

// Mock daemon PID utilities used by status command
jest.mock("../../src/daemon/pid", () => ({
  isDaemonRunning: jest.fn().mockReturnValue({ running: false, pid: null }),
  readPid: jest.fn().mockReturnValue(null),
  writePid: jest.fn().mockReturnValue(true),
  removePid: jest.fn(),
}));

// Mock daemon config utilities used by init, status, and list commands
jest.mock("../../src/daemon/config", () => ({
  getCocopilotDir: jest.fn().mockReturnValue("/tmp/test-cocopilot"),
  ensureCocopilotDir: jest.fn(),
  loadConfig: jest.fn().mockReturnValue({
    model: "claude-sonnet-4-5",
    webPort: 3000,
    maxWorkersPerRepo: 10,
    workerTimeout: "4h",
    supervisorNudgeInterval: "5m",
    mergeQueuePollInterval: "2m",
    containerMemoryLimit: "4g",
    containerCpuLimit: "2",
    autoMerge: true,
    theme: "dark-chocolate",
    github: { defaultBranch: "main", prLabels: ["cocopilot"], requireCI: true },
    redis: { host: "localhost", port: 6379 },
  }),
  saveConfig: jest.fn(),
}));

// Mock fs for state file reads (used by status/list commands)
const mockFs = {
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue("{}"),
  writeFileSync: jest.fn(),
  renameSync: jest.fn(),
  mkdirSync: jest.fn(),
};
jest.mock("node:fs", () => {
  const actual = jest.requireActual("node:fs");
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockFs.existsSync(...args),
    readFileSync: (...args: unknown[]) => mockFs.readFileSync(...args),
    writeFileSync: (...args: unknown[]) => mockFs.writeFileSync(...args),
    renameSync: (...args: unknown[]) => mockFs.renameSync(...args),
    mkdirSync: (...args: unknown[]) => mockFs.mkdirSync(...args),
    promises: {
      ...actual.promises,
      mkdir: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
    },
  };
});

// Mock child_process for git clone in init command
jest.mock("node:child_process", () => ({
  ...jest.requireActual("node:child_process"),
  execFile: jest.fn((...args: unknown[]) => {
    const cb = args[args.length - 1] as Function;
    if (typeof cb === "function") {
      cb(null, { stdout: "", stderr: "" });
    }
  }),
}));

// Mock GitHub fork detection (used by `coco init`)
jest.mock("../../src/github/fork-detection", () => ({
  detectFork: jest.fn().mockResolvedValue({
    isFork: false,
    parentOwner: undefined,
    parentRepo: undefined,
    defaultBranch: "main",
  }),
  configureMultiplayer: jest.fn().mockImplementation(
    (_config: Record<string, unknown>, forkInfo: { parentOwner: string; parentRepo: string; defaultBranch: string }) => ({
      mode: "multiplayer",
      autoMerge: false,
      activeAgent: "enrober",
      upstream: {
        owner: forkInfo.parentOwner,
        repo: forkInfo.parentRepo,
        defaultBranch: forkInfo.defaultBranch,
      },
    }),
  ),
}));

// Mock StateManager (used by `coco init` to persist repo state)
const mockStateManagerInstance = {
  init: jest.fn().mockResolvedValue(undefined),
  getRepo: jest.fn().mockReturnValue(undefined),
  getBaseDir: jest.fn().mockReturnValue("/tmp/.cocopilot"),
  addRepo: jest.fn().mockResolvedValue({
    id: "mock-id",
    name: "mock",
    url: "",
    localPath: "",
    mode: "single-player",
    status: "initializing",
    defaultBranch: "main",
    agents: {},
    workers: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  setAgent: jest.fn().mockResolvedValue({
    name: "mock-agent",
    type: "supervisor",
    status: "starting",
    lastActivity: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  }),
  updateRepoStatus: jest.fn().mockResolvedValue({}),
};
jest.mock("../../src/state/state-manager", () => ({
  StateManager: jest.fn().mockImplementation(() => mockStateManagerInstance),
}));

import { createProgram } from "../../src/cli/coco";

/**
 * Helper to run a CLI command programmatically and capture output.
 * Uses Commander's parseAsync to simulate `child_process.execSync`
 * while still allowing jest mocks for Docker/GitHub externals.
 */
async function runCLI(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const logs: string[] = [];
  const errors: string[] = [];
  let exitCode = 0;

  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  const origExitCode = process.exitCode;
  const origExit = process.exit;

  console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => errors.push(a.map(String).join(" "));
  console.warn = (...a: unknown[]) => errors.push(a.map(String).join(" "));

  // Mock process.exit to capture exit code without actually exiting.
  // We do NOT throw here because the init command wraps process.exit(0)
  // inside a try/catch, and throwing would be caught by the command's
  // own error handler, which would set exitCode to 1.
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
  }) as never;

  try {
    process.exitCode = undefined as unknown as number;
    const program = createProgram();
    program.exitOverride(); // Prevent Commander from calling process.exit
    program.configureOutput({
      writeOut: (str: string) => logs.push(str),
      writeErr: (str: string) => errors.push(str),
    });
    await program.parseAsync(["node", "coco", ...args]);
    exitCode = (process.exitCode as number) ?? exitCode;
  } catch (err: unknown) {
    // Commander throws on --help, --version, and unknown commands
    const code = (err as { exitCode?: number }).exitCode;
    if (code !== undefined) {
      exitCode = code;
    } else if (exitCode === 0) {
      // Only override if not already set by process.exit mock
      exitCode = 1;
    }
  } finally {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    process.exitCode = origExitCode;
    process.exit = origExit;
  }

  return {
    stdout: logs.join("\n"),
    stderr: errors.join("\n"),
    exitCode,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reset fs mocks to defaults
  mockFs.existsSync.mockReturnValue(false);
  mockFs.readFileSync.mockReturnValue("{}");
});

// ---------------------------------------------------------------------------
// coco init
// ---------------------------------------------------------------------------

describe("coco init", () => {
  beforeEach(() => {
    // Reset StateManager mocks between init tests to avoid state leakage
    mockStateManagerInstance.getRepo.mockReturnValue(undefined);
    mockStateManagerInstance.addRepo.mockClear();
    mockStateManagerInstance.setAgent.mockClear();
    mockStateManagerInstance.updateRepoStatus.mockClear();
  });

  it("initializes a repository from a valid GitHub URL", async () => {
    const result = await runCLI([
      "init",
      "https://github.com/acme/widgets",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Initializing repository: widgets");
    expect(result.stdout).toContain("URL: https://github.com/acme/widgets");
    expect(result.stdout).toContain("initialized successfully");
  });

  it("rejects an invalid URL", async () => {
    const result = await runCLI(["init", "not-a-url"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not a valid GitHub repository URL");
  });

  it("uses --name to override the inferred repo name", async () => {
    const result = await runCLI([
      "init",
      "https://github.com/acme/widgets",
      "--name",
      "my-widgets",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Initializing repository: my-widgets");
  });

  it("configures multiplayer mode when a fork is detected", async () => {
    const { detectFork } = jest.requireMock(
      "../../src/github/fork-detection",
    ) as { detectFork: jest.Mock };

    detectFork.mockResolvedValueOnce({
      isFork: true,
      parentOwner: "upstream-org",
      parentRepo: "widgets",
      sourceOwner: "upstream-org",
      sourceRepo: "widgets",
      defaultBranch: "main",
    });

    const result = await runCLI([
      "init",
      "https://github.com/acme/widgets",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Detected fork of upstream-org/widgets");
    expect(result.stdout).toContain("multiplayer mode");
  });

  it("continues gracefully when fork detection fails", async () => {
    const { detectFork } = jest.requireMock(
      "../../src/github/fork-detection",
    ) as { detectFork: jest.Mock };

    detectFork.mockRejectedValueOnce(new Error("network error"));

    const result = await runCLI([
      "init",
      "https://github.com/acme/widgets",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Could not detect fork status");
    expect(result.stdout).toContain("initialized successfully");
  });

  it("rejects if repo is already tracked", async () => {
    mockStateManagerInstance.getRepo.mockReturnValue({
      name: "widgets",
      url: "https://github.com/acme/widgets",
    });

    const result = await runCLI([
      "init",
      "https://github.com/acme/widgets",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already tracked");
  });
});

// ---------------------------------------------------------------------------
// coco start
// ---------------------------------------------------------------------------

describe("coco start", () => {
  it("starts the daemon with default port", async () => {
    const result = await runCLI(["start"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Starting CoCoPilot daemon");
    expect(result.stdout).toContain("http://localhost:3000");
    expect(result.stdout).toContain("started successfully");
  });

  it("accepts a custom --port", async () => {
    const result = await runCLI(["start", "--port", "8080"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("http://localhost:8080");
  });

  it("rejects an invalid port", async () => {
    const result = await runCLI(["start", "--port", "999999"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid port");
  });

  it("supports --no-ui flag", async () => {
    const result = await runCLI(["start", "--no-ui"]);

    expect(result.exitCode).toBe(0);
    // When --no-ui is set, the dashboard URL should not appear
    expect(result.stdout).not.toContain("http://localhost");
  });

  it("calls startDaemon from daemon module", async () => {
    const { startDaemon } = jest.requireMock(
      "../../src/cli/daemon",
    ) as { startDaemon: jest.Mock };

    await runCLI(["start"]);

    expect(startDaemon).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// coco stop
// ---------------------------------------------------------------------------

describe("coco stop", () => {
  it("stops services gracefully", async () => {
    const result = await runCLI(["stop"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Stopping CoCoPilot services gracefully");
    expect(result.stdout).toContain("stopped");
  });

  it("force-stops with --force flag", async () => {
    const result = await runCLI(["stop", "--force"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Force stopping");
  });

  it("calls stopDaemon from daemon module", async () => {
    const { stopDaemon } = jest.requireMock(
      "../../src/cli/daemon",
    ) as { stopDaemon: jest.Mock };

    await runCLI(["stop"]);

    expect(stopDaemon).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// coco list
// ---------------------------------------------------------------------------

describe("coco list", () => {
  it("shows empty list when no repos tracked", async () => {
    const result = await runCLI(["list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No repositories tracked");
  });

  it("outputs JSON with --json flag", async () => {
    const result = await runCLI(["list", "--json"]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toEqual([]);
  });

  it("lists tracked repositories from state", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        version: 1,
        status: "running",
        repositories: {
          "my-app": {
            name: "my-app",
            url: "https://github.com/acme/my-app",
            workers: {
              Snickers: { status: "working" },
              KitKat: { status: "completed" },
            },
          },
        },
      }),
    );

    const result = await runCLI(["list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("my-app");
    expect(result.stdout).toContain("https://github.com/acme/my-app");
  });
});

// ---------------------------------------------------------------------------
// coco status
// ---------------------------------------------------------------------------

describe("coco status", () => {
  it("shows system status", async () => {
    const result = await runCLI(["status"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CoCoPilot Status");
    expect(result.stdout).toContain("Daemon:");
    expect(result.stdout).toContain("Resources:");
  });

  it("outputs JSON with --json flag", async () => {
    const result = await runCLI(["status", "--json"]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("daemon");
    expect(parsed).toHaveProperty("repositories");
    expect(parsed).toHaveProperty("containers");
  });

  it("reports daemon not running by default", async () => {
    const result = await runCLI(["status"]);

    expect(result.stdout).toContain("Not running");
  });

  it("reports daemon running when PID is active", async () => {
    const { isDaemonRunning } = jest.requireMock(
      "../../src/daemon/pid",
    ) as { isDaemonRunning: jest.Mock };

    isDaemonRunning.mockReturnValue({ running: true, pid: 12345 });

    const result = await runCLI(["status"]);

    expect(result.stdout).toContain("Running (PID 12345)");
  });
});

// ---------------------------------------------------------------------------
// Unknown / help
// ---------------------------------------------------------------------------

describe("coco (general)", () => {
  it("shows help text with --help", async () => {
    const result = await runCLI(["--help"]);

    // Commander exits with 0 for --help
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CoCoPilot");
  });

  it("shows version with --version", async () => {
    const result = await runCLI(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("0.1.0");
  });
});
