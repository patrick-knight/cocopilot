/**
 * WaveAuditor — runs comprehensive security scans and E2E tests after each wave.
 *
 * Scans:
 *   - npm audit:  dependency vulnerability check
 *   - Trivy:      container image scanning
 *   - CodeQL:     GitHub SAST analysis (via `gh` CLI)
 *   - gitleaks:   secret detection in git history
 *
 * After all scans, runs E2E tests via `npm test`.
 * Produces a WaveAuditReport with pass/fail verdict and detailed findings.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { v4 as uuidv4 } from "uuid";

import type {
  AuditFinding,
  AuditVerdict,
  E2ETestCase,
  E2ETestResult,
  FindingSeverity,
  ScanKind,
  ScanResult,
  WaveAuditOptions,
  WaveAuditReport,
} from "./types.js";

const execFileAsync = promisify(execFile);

/** Max raw output length stored per scan. */
const MAX_RAW_OUTPUT = 8192;

/** Default scanners when none are specified. */
const DEFAULT_SCANNERS: ScanKind[] = [
  "npm-audit",
  "trivy",
  "codeql",
  "gitleaks",
];

/** Truncate a string to a maximum length. */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\n... (truncated)" : s;
}

// ---------------------------------------------------------------------------
// npm audit
// ---------------------------------------------------------------------------

interface NpmAuditVulnerability {
  severity: string;
  name: string;
  title?: string;
  url?: string;
  via?: Array<{ title?: string; url?: string }>;
}

/** Run `npm audit --json` and parse findings. */
async function runNpmAudit(repoPath: string): Promise<ScanResult> {
  const start = Date.now();
  try {
    let stdout: string;
    try {
      const result = await execFileAsync("npm", ["audit", "--json"], {
        cwd: repoPath,
        timeout: 120_000,
      });
      stdout = result.stdout;
    } catch (err: unknown) {
      // npm audit exits non-zero when vulnerabilities are found — that's expected.
      if (
        err &&
        typeof err === "object" &&
        "stdout" in err &&
        typeof (err as { stdout: unknown }).stdout === "string"
      ) {
        stdout = (err as { stdout: string }).stdout;
      } else {
        throw err;
      }
    }

    const data = JSON.parse(stdout);
    const findings: AuditFinding[] = [];
    const vulns: Record<string, NpmAuditVulnerability> =
      data.vulnerabilities ?? {};

    for (const [name, vuln] of Object.entries(vulns)) {
      findings.push({
        scanner: "npm-audit",
        severity: mapNpmSeverity(vuln.severity),
        title: vuln.title ?? `Vulnerability in ${name}`,
        description:
          Array.isArray(vuln.via) && vuln.via[0]?.title
            ? vuln.via[0].title
            : undefined,
        location: name,
        cve: vuln.url,
      });
    }

    const hasCritical = findings.some(
      (f) => f.severity === "critical" || f.severity === "high",
    );
    const verdict: AuditVerdict = hasCritical ? "fail" : "pass";

    return {
      scanner: "npm-audit",
      verdict,
      findings,
      durationMs: Date.now() - start,
      rawOutput: truncate(stdout, MAX_RAW_OUTPUT),
    };
  } catch (err: unknown) {
    return {
      scanner: "npm-audit",
      verdict: "error",
      findings: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function mapNpmSeverity(severity: string): FindingSeverity {
  switch (severity.toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "moderate":
      return "medium";
    case "low":
      return "low";
    default:
      return "info";
  }
}

// ---------------------------------------------------------------------------
// Trivy (container image scan)
// ---------------------------------------------------------------------------

interface TrivyVulnerability {
  VulnerabilityID?: string;
  Severity?: string;
  Title?: string;
  Description?: string;
  PkgName?: string;
}

interface TrivyResult {
  Target?: string;
  Vulnerabilities?: TrivyVulnerability[];
}

/** Run `trivy image --format json` against a Docker image. */
async function runTrivy(
  repoPath: string,
  dockerImage?: string,
): Promise<ScanResult> {
  const start = Date.now();

  if (!dockerImage) {
    return {
      scanner: "trivy",
      verdict: "skipped",
      findings: [],
      durationMs: Date.now() - start,
      rawOutput: "No Docker image specified — skipping Trivy scan.",
    };
  }

  try {
    const { stdout } = await execFileAsync(
      "trivy",
      ["image", "--format", "json", "--severity", "CRITICAL,HIGH,MEDIUM", dockerImage],
      { cwd: repoPath, timeout: 300_000 },
    );

    const data = JSON.parse(stdout);
    const findings: AuditFinding[] = [];
    const results: TrivyResult[] = data.Results ?? [];

    for (const result of results) {
      for (const vuln of result.Vulnerabilities ?? []) {
        findings.push({
          scanner: "trivy",
          severity: mapTrivySeverity(vuln.Severity ?? "UNKNOWN"),
          title: vuln.Title ?? vuln.VulnerabilityID ?? "Unknown vulnerability",
          description: vuln.Description,
          location: `${result.Target ?? "unknown"}:${vuln.PkgName ?? ""}`,
          cve: vuln.VulnerabilityID,
        });
      }
    }

    const hasCritical = findings.some(
      (f) => f.severity === "critical" || f.severity === "high",
    );

    return {
      scanner: "trivy",
      verdict: hasCritical ? "fail" : "pass",
      findings,
      durationMs: Date.now() - start,
      rawOutput: truncate(stdout, MAX_RAW_OUTPUT),
    };
  } catch (err: unknown) {
    return {
      scanner: "trivy",
      verdict: "error",
      findings: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function mapTrivySeverity(severity: string): FindingSeverity {
  switch (severity.toUpperCase()) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    case "LOW":
      return "low";
    default:
      return "info";
  }
}

// ---------------------------------------------------------------------------
// CodeQL (GitHub SAST via gh CLI)
// ---------------------------------------------------------------------------

interface CodeQLAlert {
  number: number;
  rule: { severity?: string; description?: string };
  most_recent_instance?: { location?: { path?: string; start_line?: number } };
  html_url?: string;
}

/** List open CodeQL alerts via `gh api`. */
async function runCodeQL(repoPath: string): Promise<ScanResult> {
  const start = Date.now();
  try {
    // Detect the GitHub repo from the remote URL
    const { stdout: remoteUrl } = await execFileAsync(
      "git",
      ["remote", "get-url", "origin"],
      { cwd: repoPath, timeout: 10_000 },
    );

    const nwo = extractNwo(remoteUrl.trim());
    if (!nwo) {
      return {
        scanner: "codeql",
        verdict: "skipped",
        findings: [],
        durationMs: Date.now() - start,
        rawOutput: "Could not determine GitHub owner/repo from git remote.",
      };
    }

    const { stdout } = await execFileAsync(
      "gh",
      [
        "api",
        `/repos/${nwo}/code-scanning/alerts`,
        "--jq",
        "[.[] | select(.state == \"open\")]",
      ],
      { cwd: repoPath, timeout: 60_000 },
    );

    const alerts: CodeQLAlert[] = JSON.parse(stdout || "[]");
    const findings: AuditFinding[] = alerts.map((alert) => {
      const loc = alert.most_recent_instance?.location;
      return {
        scanner: "codeql",
        severity: mapCodeQLSeverity(alert.rule?.severity ?? "note"),
        title: alert.rule?.description ?? `Alert #${alert.number}`,
        location: loc
          ? `${loc.path ?? ""}:${loc.start_line ?? ""}`
          : undefined,
        cve: alert.html_url,
      };
    });

    const hasCritical = findings.some(
      (f) => f.severity === "critical" || f.severity === "high",
    );

    return {
      scanner: "codeql",
      verdict: hasCritical ? "fail" : "pass",
      findings,
      durationMs: Date.now() - start,
      rawOutput: truncate(stdout, MAX_RAW_OUTPUT),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // If code scanning is not enabled, treat as skipped rather than error
    if (message.includes("Advanced Security") || message.includes("404")) {
      return {
        scanner: "codeql",
        verdict: "skipped",
        findings: [],
        durationMs: Date.now() - start,
        rawOutput:
          "CodeQL / code scanning is not enabled on this repository.",
      };
    }
    return {
      scanner: "codeql",
      verdict: "error",
      findings: [],
      durationMs: Date.now() - start,
      error: message,
    };
  }
}

/** Extract GitHub owner/repo from a remote URL. */
function extractNwo(url: string): string | null {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
  if (sshMatch) return sshMatch[1];

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+\/[^/.]+)/);
  if (httpsMatch) return httpsMatch[1];

  return null;
}

function mapCodeQLSeverity(severity: string): FindingSeverity {
  switch (severity.toLowerCase()) {
    case "error":
      return "high";
    case "warning":
      return "medium";
    case "note":
      return "low";
    default:
      return "info";
  }
}

// ---------------------------------------------------------------------------
// gitleaks (secret detection)
// ---------------------------------------------------------------------------

interface GitleaksMatch {
  Description?: string;
  File?: string;
  StartLine?: number;
  Commit?: string;
  RuleID?: string;
}

/** Run `gitleaks detect --report-format json`. */
async function runGitleaks(repoPath: string): Promise<ScanResult> {
  const start = Date.now();
  try {
    let stdout: string;
    try {
      const result = await execFileAsync(
        "gitleaks",
        [
          "detect",
          "--source",
          repoPath,
          "--report-format",
          "json",
          "--report-path",
          "/dev/stdout",
          "--no-banner",
        ],
        { cwd: repoPath, timeout: 180_000 },
      );
      stdout = result.stdout;
    } catch (err: unknown) {
      // gitleaks exits non-zero when leaks are found
      if (
        err &&
        typeof err === "object" &&
        "stdout" in err &&
        typeof (err as { stdout: unknown }).stdout === "string"
      ) {
        stdout = (err as { stdout: string }).stdout;
      } else {
        throw err;
      }
    }

    const leaks: GitleaksMatch[] = JSON.parse(stdout || "[]");
    const findings: AuditFinding[] = leaks.map((leak) => ({
      scanner: "gitleaks",
      severity: "critical" as FindingSeverity,
      title: leak.Description ?? leak.RuleID ?? "Secret detected",
      location: leak.File
        ? `${leak.File}:${leak.StartLine ?? ""}`
        : leak.Commit,
    }));

    return {
      scanner: "gitleaks",
      verdict: findings.length > 0 ? "fail" : "pass",
      findings,
      durationMs: Date.now() - start,
      rawOutput: truncate(stdout, MAX_RAW_OUTPUT),
    };
  } catch (err: unknown) {
    return {
      scanner: "gitleaks",
      verdict: "error",
      findings: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// E2E test runner
// ---------------------------------------------------------------------------

interface JestTestResult {
  name: string;
  status: "passed" | "failed" | "pending";
  duration?: number;
  failureMessages?: string[];
}

interface JestSuite {
  testResults: JestTestResult[];
}

interface JestOutput {
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTotalTests: number;
  testResults: JestSuite[];
}

/** Run E2E tests via `npm test -- --json`. */
async function runE2ETests(repoPath: string): Promise<E2ETestResult> {
  const start = Date.now();
  try {
    let stdout: string;
    try {
      const result = await execFileAsync(
        "npm",
        ["test", "--", "--json", "--forceExit"],
        { cwd: repoPath, timeout: 300_000 },
      );
      stdout = result.stdout;
    } catch (err: unknown) {
      // jest exits non-zero on test failures
      if (
        err &&
        typeof err === "object" &&
        "stdout" in err &&
        typeof (err as { stdout: unknown }).stdout === "string"
      ) {
        stdout = (err as { stdout: string }).stdout;
      } else {
        throw err;
      }
    }

    const data: JestOutput = JSON.parse(stdout);
    const tests: E2ETestCase[] = [];

    for (const suite of data.testResults) {
      for (const test of suite.testResults) {
        tests.push({
          name: test.name,
          status:
            test.status === "pending"
              ? "skipped"
              : test.status === "passed"
                ? "passed"
                : "failed",
          durationMs: test.duration ?? 0,
          error:
            test.failureMessages && test.failureMessages.length > 0
              ? test.failureMessages.join("\n")
              : undefined,
        });
      }
    }

    return {
      verdict: data.numFailedTests > 0 ? "fail" : "pass",
      total: data.numTotalTests,
      passed: data.numPassedTests,
      failed: data.numFailedTests,
      skipped: data.numPendingTests,
      tests,
      durationMs: Date.now() - start,
      rawOutput: truncate(stdout, MAX_RAW_OUTPUT),
    };
  } catch (err: unknown) {
    return {
      verdict: "error",
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      tests: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Scanner dispatch map
// ---------------------------------------------------------------------------

type ScannerFn = (
  repoPath: string,
  dockerImage?: string,
) => Promise<ScanResult>;

const SCANNER_MAP: Record<ScanKind, ScannerFn> = {
  "npm-audit": (repoPath) => runNpmAudit(repoPath),
  trivy: (repoPath, dockerImage) => runTrivy(repoPath, dockerImage),
  codeql: (repoPath) => runCodeQL(repoPath),
  gitleaks: (repoPath) => runGitleaks(repoPath),
};

// ---------------------------------------------------------------------------
// WaveAuditor
// ---------------------------------------------------------------------------

/**
 * WaveAuditor runs comprehensive security scans and E2E tests after
 * each wave completes. Call `audit()` with options and receive a
 * WaveAuditReport with a pass/fail verdict and detailed findings.
 */
export class WaveAuditor {
  /**
   * Run a full audit: security scans + E2E tests.
   * Returns a WaveAuditReport with overall pass/fail verdict.
   */
  async audit(options: WaveAuditOptions): Promise<WaveAuditReport> {
    const id = uuidv4();
    const startedAt = new Date().toISOString();
    const start = Date.now();

    const scanners = options.scanners ?? DEFAULT_SCANNERS;

    // Run all scans concurrently
    const scanPromises = scanners.map((kind) => {
      const fn = SCANNER_MAP[kind];
      return fn(options.repoPath, options.dockerImage);
    });

    const scans = await Promise.all(scanPromises);

    // Run E2E tests
    let e2e: E2ETestResult;
    if (options.runE2E !== false) {
      e2e = await runE2ETests(options.repoPath);
    } else {
      e2e = {
        verdict: "skipped",
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        tests: [],
        durationMs: 0,
      };
    }

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - start;

    // Compute overall verdict: fail if any scan or e2e failed
    const allVerdicts = [...scans.map((s) => s.verdict), e2e.verdict];
    let verdict: AuditVerdict = "pass";
    if (allVerdicts.includes("fail")) {
      verdict = "fail";
    } else if (allVerdicts.includes("error")) {
      verdict = "fail";
    }

    const summary = buildSummary(scans, e2e, verdict);

    return {
      id,
      repoName: options.repoName,
      waveId: options.waveId,
      verdict,
      scans,
      e2e,
      startedAt,
      completedAt,
      durationMs,
      summary,
    };
  }
}

/** Build a human-readable summary string for the report. */
function buildSummary(
  scans: ScanResult[],
  e2e: E2ETestResult,
  verdict: AuditVerdict,
): string {
  const parts: string[] = [];

  for (const scan of scans) {
    const count = scan.findings.length;
    const label = scan.verdict.toUpperCase();
    parts.push(
      `${scan.scanner}: ${label}${count > 0 ? ` (${count} finding${count !== 1 ? "s" : ""})` : ""}`,
    );
  }

  if (e2e.verdict !== "skipped") {
    parts.push(
      `E2E tests: ${e2e.verdict.toUpperCase()} (${e2e.passed}/${e2e.total} passed)`,
    );
  }

  const header =
    verdict === "pass"
      ? "Wave audit PASSED."
      : "Wave audit FAILED.";

  return `${header} ${parts.join(" | ")}`;
}

// Export scanner functions for testing
export {
  runNpmAudit as _runNpmAudit,
  runTrivy as _runTrivy,
  runCodeQL as _runCodeQL,
  runGitleaks as _runGitleaks,
  runE2ETests as _runE2ETests,
  extractNwo as _extractNwo,
  buildSummary as _buildSummary,
};
