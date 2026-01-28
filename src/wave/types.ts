/**
 * WaveAuditor types.
 *
 * Defines interfaces for security scan results, E2E test outcomes,
 * and the overall wave audit report.
 */

// ---------------------------------------------------------------------------
// Scan types
// ---------------------------------------------------------------------------

/** The kinds of security scans the WaveAuditor can run. */
export type ScanKind = "npm-audit" | "trivy" | "codeql" | "gitleaks";

/** Overall verdict for a scan or the full audit. */
export type AuditVerdict = "pass" | "fail" | "error" | "skipped";

/** Severity levels aligned with CVE / CVSS conventions. */
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

// ---------------------------------------------------------------------------
// Individual findings
// ---------------------------------------------------------------------------

/** A single finding from any scanner. */
export interface AuditFinding {
  scanner: ScanKind;
  severity: FindingSeverity;
  title: string;
  description?: string;
  location?: string;
  cve?: string;
}

// ---------------------------------------------------------------------------
// Per-scanner results
// ---------------------------------------------------------------------------

/** Result of a single scanner execution. */
export interface ScanResult {
  scanner: ScanKind;
  verdict: AuditVerdict;
  findings: AuditFinding[];
  /** Duration in milliseconds. */
  durationMs: number;
  /** Raw output (truncated if too long). */
  rawOutput?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// E2E test results
// ---------------------------------------------------------------------------

export type E2ETestStatus = "passed" | "failed" | "skipped";

export interface E2ETestCase {
  name: string;
  status: E2ETestStatus;
  durationMs: number;
  error?: string;
}

export interface E2ETestResult {
  verdict: AuditVerdict;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  tests: E2ETestCase[];
  durationMs: number;
  rawOutput?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Full audit report
// ---------------------------------------------------------------------------

export interface WaveAuditReport {
  id: string;
  repoName: string;
  waveId?: string;
  verdict: AuditVerdict;
  scans: ScanResult[];
  e2e: E2ETestResult;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Options for running an audit
// ---------------------------------------------------------------------------

export interface WaveAuditOptions {
  /** Repository name. */
  repoName: string;
  /** Path to the repository working directory. */
  repoPath: string;
  /** Optional wave identifier for tracking. */
  waveId?: string;
  /** Specific scanners to run (defaults to all). */
  scanners?: ScanKind[];
  /** Whether to run E2E tests (defaults to true). */
  runE2E?: boolean;
  /** Docker image to scan with Trivy (if applicable). */
  dockerImage?: string;
}
