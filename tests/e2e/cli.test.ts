/**
 * End-to-end tests for the CoCoPilot CLI.
 *
 * Tests the full CLI command flows: init, start, stop, list, status.
 * External dependencies (Docker, GitHub) are mocked.
 */

import { createProgram } from "../../src/cli/coco";

// Mock GitHub fork detection (used by `coco init`)
jest.mock("../../src/github/fork-detection", () => ({
  detectFork: jest.fn().mockResolvedValue({
    isFork: false,
    parentOwner: undefined,
    parentRepo: undefined,
  }),
  configureMultiplayer: jest.fn().mockReturnValue({}),
}));

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

  console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => errors.push(a.map(String).join(" "));
  console.warn = (...a: unknown[]) => errors.push(a.map(String).join(" "));

  try {
    process.exitCode = undefined as unknown as number;
    const program = createProgram();
    program.exitOverride(); // Prevent Commander from calling process.exit
    program.configureOutput({
      writeOut: (str: string) => logs.push(str),
      writeErr: (str: string) => errors.push(str),
    });
    await program.parseAsync(["node", "coco", ...args]);
    exitCode = (process.exitCode as number) ?? 0;
  } catch (err: unknown) {
    // Commander throws on --help, --version, and unknown commands
    const code = (err as { exitCode?: number }).exitCode;
    exitCode = code ?? 1;
  } finally {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    process.exitCode = origExitCode;
  }

  return {
    stdout: logs.join("\n"),
    stderr: errors.join("\n"),
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// coco init
// ---------------------------------------------------------------------------

describe("coco init", () => {
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
      parentDefaultBranch: "main",
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
