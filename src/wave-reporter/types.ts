/**
 * Wave report types for CoCoPilot.
 *
 * Defines TypeScript interfaces for wave completion reports including
 * task summaries, PR summaries, test coverage deltas, security posture
 * changes, time analysis, and recommendations.
 *
 * Follows codebase conventions: ISO 8601 timestamps, string literal
 * unions, Record maps.
 */

// ---------------------------------------------------------------------------
// Enums / union types
// ---------------------------------------------------------------------------

export type WaveId =
  | "wave-1"
  | "wave-2"
  | "wave-3"
  | "wave-4"
  | "wave-5"
  | "wave-6";

export type WaveStatus = "in_progress" | "completed" | "failed" | "partial";

export type RecommendationSeverity = "info" | "warning" | "critical";

export type RecommendationCategory =
  | "performance"
  | "quality"
  | "security"
  | "process";

// ---------------------------------------------------------------------------
// Task summary
// ---------------------------------------------------------------------------

export interface WaveTaskSummary {
  workerName: string;
  task: string;
  branch: string;
  status: string;
  createdAt: string; // ISO 8601
  completedAt?: string; // ISO 8601
  durationMs?: number;
  prNumber?: number;
  prUrl?: string;
}

// ---------------------------------------------------------------------------
// PR summary
// ---------------------------------------------------------------------------

export interface WavePRSummary {
  prNumber: number;
  prUrl?: string;
  workerName: string;
  merged: boolean;
  branch: string;
}

// ---------------------------------------------------------------------------
// Test coverage delta
// ---------------------------------------------------------------------------

export interface TestCoverageDelta {
  beforePercent: number;
  afterPercent: number;
  deltaPercent: number;
  newTestFiles: number;
  newTestCases: number;
}

// ---------------------------------------------------------------------------
// Security posture change
// ---------------------------------------------------------------------------

export interface SecurityPostureChange {
  scansRun: number;
  newVulnerabilities: number;
  resolvedVulnerabilities: number;
  netChange: number;
  auditPassed: boolean;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Time summary
// ---------------------------------------------------------------------------

export interface WaveTimeSummary {
  startedAt: string; // ISO 8601
  endedAt: string; // ISO 8601
  totalDurationMs: number;
  workerSecondsTotal: number;
  avgTaskDurationMs: number;
  peakConcurrency: number;
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

export interface WaveRecommendation {
  id: string;
  severity: RecommendationSeverity;
  category: RecommendationCategory;
  title: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Top-level wave report
// ---------------------------------------------------------------------------

export interface WaveReportSummary {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalPRs: number;
  mergedPRs: number;
}

export interface WaveReport {
  id: string;
  waveId: WaveId;
  waveName: string;
  generatedAt: string; // ISO 8601
  status: WaveStatus;
  summary: WaveReportSummary;
  tasks: WaveTaskSummary[];
  prs: WavePRSummary[];
  testCoverage: TestCoverageDelta;
  security: SecurityPostureChange;
  time: WaveTimeSummary;
  recommendations: WaveRecommendation[];
}

// ---------------------------------------------------------------------------
// Options for report generation
// ---------------------------------------------------------------------------

export interface BuildWaveReportOptions {
  /** Override start time (defaults to earliest worker createdAt). */
  startedAt?: string;
  /** Override end time (defaults to now). */
  endedAt?: string;
  /** Test coverage before this wave. */
  coverageBefore?: number;
  /** Test coverage after this wave. */
  coverageAfter?: number;
  /** New test files added. */
  newTestFiles?: number;
  /** New test cases added. */
  newTestCases?: number;
  /** Security scan count. */
  securityScansRun?: number;
  /** New vulnerabilities discovered. */
  newVulnerabilities?: number;
  /** Vulnerabilities resolved. */
  resolvedVulnerabilities?: number;
  /** Whether security audit passed. */
  auditPassed?: boolean;
  /** Extra security notes. */
  securityNotes?: string[];
}
