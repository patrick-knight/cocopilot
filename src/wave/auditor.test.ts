/**
 * Unit tests for WaveAuditor.
 *
 * All external commands (npm, trivy, gitleaks, gh, git) are mocked
 * via jest.mock on node:child_process. We use argument-based routing
 * so that concurrent Promise.all execution doesn't cause ordering issues.
 */

import { WaveAuditor, _extractNwo, _buildSummary } from "./auditor.js";
import type {
  ScanResult,
  E2ETestResult,
  WaveAuditOptions,
} from "./types.js";

// ---------------------------------------------------------------------------
// Mock child_process.execFile
// ---------------------------------------------------------------------------

var mockExecFile: jest.Mock; // eslint-disable-line no-var

jest.mock("node:child_process", () => {
  mockExecFile = jest.fn();
  return { execFile: mockExecFile };
});

jest.mock("node:util", () => {
  const actual = jest.requireActual("node:util");
  return {
    ...actual,
    promisify: () => mockExecFile,
  };
});

jest.mock("uuid", () => ({
  v4: () => "test-uuid-1234",
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function npmAuditOutput(vulns: Record<string, object> = {}): string {
  return JSON.stringify({ vulnerabilities: vulns });
}

function trivyOutput(results: object[] = []): string {
  return JSON.stringify({ Results: results });
}

function gitleaksOutput(leaks: object[] = []): string {
  return JSON.stringify(leaks);
}

function jestOutput(opts: {
  passed?: number;
  failed?: number;
  pending?: number;
} = {}): string {
  const { passed = 3, failed = 0, pending = 0 } = opts;
  const testResults: object[] = [];
  for (let i = 0; i < passed; i++) {
    testResults.push({ name: `test-${i}`, status: "passed", duration: 100 });
  }
  for (let i = 0; i < failed; i++) {
    testResults.push({
      name: `failing-test-${i}`,
      status: "failed",
      duration: 50,
      failureMessages: ["Expected true to be false"],
    });
  }
  for (let i = 0; i < pending; i++) {
    testResults.push({ name: `pending-test-${i}`, status: "pending", duration: 0 });
  }
  return JSON.stringify({
    numPassedTests: passed,
    numFailedTests: failed,
    numPendingTests: pending,
    numTotalTests: passed + failed + pending,
    testResults: [{ testResults }],
  });
}

/**
 * Set up argument-based routing for mockExecFile so concurrent scans
 * resolve correctly regardless of Promise.all ordering.
 */
function setupMockRouting(overrides: {
  npm?: { stdout: string } | Error;
  trivy?: { stdout: string } | Error;
  gitRemote?: { stdout: string } | Error;
  ghApi?: { stdout: string } | Error;
  gitleaks?: { stdout: string } | Error;
  npmTest?: { stdout: string } | Error;
} = {}): void {
  const defaults = {
    npm: { stdout: npmAuditOutput() },
    trivy: { stdout: trivyOutput() },
    gitRemote: { stdout: "https://github.com/owner/repo.git\n" },
    ghApi: { stdout: "[]" },
    gitleaks: { stdout: gitleaksOutput() },
    npmTest: { stdout: jestOutput({ passed: 3 }) },
  };

  const responses = { ...defaults, ...overrides };

  mockExecFile.mockImplementation((cmd: string, args: string[]) => {
    // npm audit
    if (cmd === "npm" && args[0] === "audit") {
      if (responses.npm instanceof Error) return Promise.reject(responses.npm);
      return Promise.resolve(responses.npm);
    }
    // trivy
    if (cmd === "trivy") {
      if (responses.trivy instanceof Error) return Promise.reject(responses.trivy);
      return Promise.resolve(responses.trivy);
    }
    // git remote get-url origin
    if (cmd === "git" && args[0] === "remote") {
      if (responses.gitRemote instanceof Error) return Promise.reject(responses.gitRemote);
      return Promise.resolve(responses.gitRemote);
    }
    // gh api (codeql)
    if (cmd === "gh") {
      if (responses.ghApi instanceof Error) return Promise.reject(responses.ghApi);
      return Promise.resolve(responses.ghApi);
    }
    // gitleaks
    if (cmd === "gitleaks") {
      if (responses.gitleaks instanceof Error) return Promise.reject(responses.gitleaks);
      return Promise.resolve(responses.gitleaks);
    }
    // npm test (E2E)
    if (cmd === "npm" && args[0] === "test") {
      if (responses.npmTest instanceof Error) return Promise.reject(responses.npmTest);
      return Promise.resolve(responses.npmTest);
    }

    return Promise.reject(new Error(`Unexpected mock call: ${cmd} ${args.join(" ")}`));
  });
}

const DEFAULT_OPTIONS: WaveAuditOptions = {
  repoName: "test-repo",
  repoPath: "/tmp/test-repo",
  waveId: "wave-1",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WaveAuditor", () => {
  let auditor: WaveAuditor;

  beforeEach(() => {
    jest.clearAllMocks();
    auditor = new WaveAuditor();
  });

  describe("extractNwo", () => {
    it("extracts owner/repo from HTTPS URL", () => {
      expect(_extractNwo("https://github.com/owner/repo.git")).toBe(
        "owner/repo",
      );
    });

    it("extracts owner/repo from SSH URL", () => {
      expect(_extractNwo("git@github.com:owner/repo.git")).toBe("owner/repo");
    });

    it("extracts owner/repo from URL without .git suffix", () => {
      expect(_extractNwo("https://github.com/owner/repo")).toBe("owner/repo");
    });

    it("returns null for non-GitHub URLs", () => {
      expect(_extractNwo("https://gitlab.com/owner/repo")).toBeNull();
    });
  });

  describe("buildSummary", () => {
    it("builds pass summary", () => {
      const scans: ScanResult[] = [
        { scanner: "npm-audit", verdict: "pass", findings: [], durationMs: 100 },
      ];
      const e2e: E2ETestResult = {
        verdict: "pass",
        total: 5,
        passed: 5,
        failed: 0,
        skipped: 0,
        tests: [],
        durationMs: 200,
      };
      const summary = _buildSummary(scans, e2e, "pass");
      expect(summary).toContain("PASSED");
      expect(summary).toContain("npm-audit: PASS");
      expect(summary).toContain("E2E tests: PASS (5/5 passed)");
    });

    it("builds fail summary with findings count", () => {
      const scans: ScanResult[] = [
        {
          scanner: "gitleaks",
          verdict: "fail",
          findings: [
            { scanner: "gitleaks", severity: "critical", title: "AWS key found" },
          ],
          durationMs: 100,
        },
      ];
      const e2e: E2ETestResult = {
        verdict: "pass",
        total: 3,
        passed: 3,
        failed: 0,
        skipped: 0,
        tests: [],
        durationMs: 100,
      };
      const summary = _buildSummary(scans, e2e, "fail");
      expect(summary).toContain("FAILED");
      expect(summary).toContain("gitleaks: FAIL (1 finding)");
    });

    it("skips E2E section when skipped", () => {
      const scans: ScanResult[] = [];
      const e2e: E2ETestResult = {
        verdict: "skipped",
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        tests: [],
        durationMs: 0,
      };
      const summary = _buildSummary(scans, e2e, "pass");
      expect(summary).not.toContain("E2E");
    });
  });

  describe("audit()", () => {
    it("runs all scanners and E2E tests, returning a pass report", async () => {
      setupMockRouting({
        npmTest: { stdout: jestOutput({ passed: 5 }) },
      });

      const report = await auditor.audit(DEFAULT_OPTIONS);

      expect(report.id).toBe("test-uuid-1234");
      expect(report.repoName).toBe("test-repo");
      expect(report.waveId).toBe("wave-1");
      expect(report.verdict).toBe("pass");
      expect(report.scans).toHaveLength(4);
      expect(report.e2e.verdict).toBe("pass");
      expect(report.e2e.passed).toBe(5);
      expect(report.summary).toContain("PASSED");
      expect(report.startedAt).toBeDefined();
      expect(report.completedAt).toBeDefined();
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("returns fail verdict when npm audit finds critical vulnerabilities", async () => {
      const vulns = {
        "bad-package": {
          severity: "critical",
          name: "bad-package",
          title: "RCE in bad-package",
          via: [{ title: "Remote code execution" }],
        },
      };
      setupMockRouting({
        npm: { stdout: npmAuditOutput(vulns) },
        npmTest: { stdout: jestOutput({ passed: 5 }) },
      });

      const report = await auditor.audit(DEFAULT_OPTIONS);

      expect(report.verdict).toBe("fail");
      const npmScan = report.scans.find((s) => s.scanner === "npm-audit");
      expect(npmScan?.verdict).toBe("fail");
      expect(npmScan?.findings).toHaveLength(1);
      expect(npmScan?.findings[0].severity).toBe("critical");
    });

    it("returns fail verdict when E2E tests fail", async () => {
      setupMockRouting({
        npmTest: { stdout: jestOutput({ passed: 3, failed: 2 }) },
      });

      const report = await auditor.audit(DEFAULT_OPTIONS);

      expect(report.verdict).toBe("fail");
      expect(report.e2e.verdict).toBe("fail");
      expect(report.e2e.failed).toBe(2);
    });

    it("returns fail verdict when gitleaks finds secrets", async () => {
      const leaks = [
        {
          Description: "AWS Access Key",
          File: "config.js",
          StartLine: 10,
          RuleID: "aws-access-key",
        },
      ];
      setupMockRouting({
        gitleaks: { stdout: gitleaksOutput(leaks) },
        npmTest: { stdout: jestOutput({ passed: 5 }) },
      });

      const report = await auditor.audit(DEFAULT_OPTIONS);

      expect(report.verdict).toBe("fail");
      const gitleaksScan = report.scans.find((s) => s.scanner === "gitleaks");
      expect(gitleaksScan?.verdict).toBe("fail");
      expect(gitleaksScan?.findings[0].title).toBe("AWS Access Key");
      expect(gitleaksScan?.findings[0].severity).toBe("critical");
    });

    it("skips trivy when no dockerImage is provided", async () => {
      setupMockRouting();

      const report = await auditor.audit(DEFAULT_OPTIONS);

      const trivyScan = report.scans.find((s) => s.scanner === "trivy");
      expect(trivyScan?.verdict).toBe("skipped");
    });

    it("runs trivy when dockerImage is provided", async () => {
      setupMockRouting();

      const report = await auditor.audit({
        ...DEFAULT_OPTIONS,
        dockerImage: "myapp:latest",
      });

      const trivyScan = report.scans.find((s) => s.scanner === "trivy");
      expect(trivyScan?.verdict).toBe("pass");
    });

    it("handles scanner errors gracefully", async () => {
      setupMockRouting({
        npm: new Error("npm not found"),
        gitRemote: new Error("not a git repo"),
        gitleaks: new Error("gitleaks not found"),
      });

      const report = await auditor.audit(DEFAULT_OPTIONS);

      expect(report.verdict).toBe("fail");
      const errorScans = report.scans.filter((s) => s.verdict === "error");
      expect(errorScans.length).toBeGreaterThan(0);
    });

    it("skips E2E tests when runE2E is false", async () => {
      setupMockRouting();

      const report = await auditor.audit({
        ...DEFAULT_OPTIONS,
        runE2E: false,
      });

      expect(report.e2e.verdict).toBe("skipped");
      expect(report.verdict).toBe("pass");
    });

    it("runs only specified scanners", async () => {
      setupMockRouting();

      const report = await auditor.audit({
        ...DEFAULT_OPTIONS,
        scanners: ["npm-audit"],
      });

      expect(report.scans).toHaveLength(1);
      expect(report.scans[0].scanner).toBe("npm-audit");
    });

    it("handles npm audit non-zero exit with stdout", async () => {
      const error = new Error("npm audit failed") as Error & { stdout: string };
      error.stdout = npmAuditOutput({
        lodash: { severity: "low", name: "lodash", title: "Prototype pollution" },
      });
      setupMockRouting({ npm: error });

      const report = await auditor.audit(DEFAULT_OPTIONS);

      const npmScan = report.scans.find((s) => s.scanner === "npm-audit");
      expect(npmScan?.verdict).toBe("pass");
      expect(npmScan?.findings).toHaveLength(1);
      expect(npmScan?.findings[0].severity).toBe("low");
    });

    it("handles codeql skipping when code scanning is not enabled", async () => {
      setupMockRouting({
        ghApi: new Error("Advanced Security must be enabled"),
      });

      const report = await auditor.audit(DEFAULT_OPTIONS);

      const codeqlScan = report.scans.find((s) => s.scanner === "codeql");
      expect(codeqlScan?.verdict).toBe("skipped");
    });
  });
});
