/**
 * PRPipeline – Visualizes the PR merge pipeline.
 *
 * Shows each tracked PR with a multi-step stage indicator and metadata:
 * draft → ready → CI running → CI passed → merged.
 *
 * Features:
 * - Step indicator dots showing pipeline progression
 * - PR title, branch, author, and associated worker
 * - Relative timestamps
 * - Active vs merged grouping (merged PRs collapsible)
 */

import React, { useState } from "react";
import type { PRPipelineEntry, PRStage } from "../types.js";
import { PR_STAGE_DISPLAY } from "../types.js";

export interface PRPipelineProps {
  /** Pull requests to display. */
  prs: PRPipelineEntry[];
}

/**
 * Ordered pipeline stages for the step indicator.
 * ci_failed is not in the main flow — it's a branch off ci_running.
 */
const PIPELINE_STAGES: PRStage[] = ["draft", "ready", "ci_running", "ci_passed", "merged"];

/** Map each stage to its index in the pipeline for comparison. */
const STAGE_ORDER: Record<PRStage, number> = {
  draft: 0,
  ready: 1,
  ci_running: 2,
  ci_passed: 3,
  ci_failed: 2, // same position as ci_running (branched failure)
  merged: 4,
};

export function PRPipeline({ prs }: PRPipelineProps): React.ReactElement {
  if (prs.length === 0) {
    return (
      <section aria-label="PR Pipeline">
        <h2 className="text-lg font-semibold text-stone-800">PR Pipeline</h2>
        <div className="mt-2 text-sm text-stone-500">
          <p className="italic">No pull requests in the pipeline.</p>
          <p className="text-xs mt-1">
            💡 PRs appear here when workers create them. Spawn a worker with a task to see the pipeline in action.
          </p>
        </div>
      </section>
    );
  }

  // Separate active from merged
  const activePRs = prs
    .filter((p) => p.stage !== "merged")
    .sort((a, b) => b.number - a.number);

  const mergedPRs = prs
    .filter((p) => p.stage === "merged")
    .sort((a, b) => b.number - a.number);

  return (
    <section aria-label="PR Pipeline">
      <h2 className="text-lg font-semibold text-stone-800">PR Pipeline</h2>

      {/* Active PRs */}
      {activePRs.length > 0 && (
        <div className="mt-3 space-y-3" data-testid="active-prs">
          {activePRs.map((pr) => (
            <PRRow key={pr.number} pr={pr} />
          ))}
        </div>
      )}

      {activePRs.length === 0 && mergedPRs.length > 0 && (
        <p className="mt-2 text-sm text-stone-500 italic">All pull requests have been merged.</p>
      )}

      {/* Merged PRs (collapsible) */}
      {mergedPRs.length > 0 && (
        <MergedSection prs={mergedPRs} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// PR row
// ---------------------------------------------------------------------------

interface PRRowProps {
  pr: PRPipelineEntry;
}

function PRRow({ pr }: PRRowProps): React.ReactElement {
  const isFailed = pr.stage === "ci_failed";

  return (
    <div
      className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm"
      data-testid={`pr-row-${pr.number}`}
    >
      {/* Top row: PR identifier + title + timestamp */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-sm font-semibold text-caramel-700 hover:underline"
            title={`Open PR #${pr.number}`}
          >
            #{pr.number}
          </a>
          <span className="text-sm text-stone-800 truncate" title={pr.title}>
            {pr.title}
          </span>
        </div>
        <span className="shrink-0 text-xs text-stone-400" title={pr.updatedAt}>
          {relativeTime(pr.updatedAt)}
        </span>
      </div>

      {/* Metadata row: branch, author, worker */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
        <span className="inline-flex items-center gap-1" title={`Branch: ${pr.branch}`}>
          <BranchIcon />
          <span className="font-mono">{pr.branch}</span>
        </span>
        <span title={`Author: ${pr.author}`}>
          by {pr.author}
        </span>
        {pr.workerName && (
          <span className="text-stone-400" title={`Worker: ${pr.workerName}`}>
            worker: {pr.workerName}
          </span>
        )}
      </div>

      {/* Stage indicator */}
      <div className="mt-3">
        <StageIndicator currentStage={pr.stage} isFailed={isFailed} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage indicator (multi-step dots)
// ---------------------------------------------------------------------------

interface StageIndicatorProps {
  currentStage: PRStage;
  isFailed: boolean;
}

function StageIndicator({ currentStage, isFailed }: StageIndicatorProps): React.ReactElement {
  const currentIdx = STAGE_ORDER[currentStage];

  return (
    <div className="flex items-center" role="group" aria-label={`Pipeline stage: ${PR_STAGE_DISPLAY[currentStage].label}`}>
      {PIPELINE_STAGES.map((stage, idx) => {
        const isCompleted = currentIdx > idx;
        const isCurrent = currentIdx === idx && !isFailed;
        const isFailedAtThisStage = isFailed && idx === STAGE_ORDER.ci_running;

        return (
          <React.Fragment key={stage}>
            {/* Connector line (before each dot except the first) */}
            {idx > 0 && (
              <div
                className={`flex-1 h-0.5 ${isCompleted ? "bg-green-400" : "bg-stone-200"}`}
                data-testid={`connector-${idx}`}
              />
            )}

            {/* Stage dot */}
            <div className="flex flex-col items-center" data-testid={`stage-${stage}`}>
              <div
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[8px] font-bold ${
                  isFailedAtThisStage
                    ? "border-red-500 bg-red-500 text-white"
                    : isCompleted
                      ? "border-green-500 bg-green-500 text-white"
                      : isCurrent
                        ? "border-caramel-500 bg-caramel-500 text-white"
                        : "border-stone-300 bg-white text-stone-300"
                }`}
                title={PR_STAGE_DISPLAY[stage].label}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isFailedAtThisStage
                  ? "\u2717"
                  : isCompleted
                    ? "\u2713"
                    : ""}
              </div>
              <span
                className={`mt-1 text-[10px] leading-tight ${
                  isFailedAtThisStage
                    ? "text-red-600 font-medium"
                    : isCurrent
                      ? "text-caramel-700 font-medium"
                      : isCompleted
                        ? "text-green-600"
                        : "text-stone-400"
                }`}
              >
                {isFailedAtThisStage ? "CI Failed" : PR_STAGE_DISPLAY[stage].label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Merged section (collapsible)
// ---------------------------------------------------------------------------

interface MergedSectionProps {
  prs: PRPipelineEntry[];
}

function MergedSection({ prs }: MergedSectionProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-4" data-testid="merged-section">
      <button
        type="button"
        className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? "\u25BE" : "\u25B8"} {prs.length} merged PR{prs.length !== 1 ? "s" : ""}
      </button>
      {expanded && (
        <div className="mt-2 space-y-2" data-testid="merged-prs">
          {prs.map((pr) => (
            <MergedPRRow key={pr.number} pr={pr} />
          ))}
        </div>
      )}
    </div>
  );
}

function MergedPRRow({ pr }: PRRowProps): React.ReactElement {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-stone-100 bg-stone-50 px-4 py-2"
      data-testid={`merged-pr-row-${pr.number}`}
    >
      <span className="text-green-600 text-sm" aria-hidden="true">{"\u2713"}</span>
      <a
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-caramel-700 hover:underline"
      >
        #{pr.number}
      </a>
      <span className="text-sm text-stone-600 truncate">{pr.title}</span>
      <span className="ml-auto shrink-0 text-xs text-stone-400">
        {relativeTime(pr.updatedAt)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a human-readable relative time string (e.g. "2h ago"). */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Inline SVG branch icon. */
function BranchIcon(): React.ReactElement {
  return (
    <svg
      className="w-3 h-3"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6A1.5 1.5 0 004.5 10v.878a2.25 2.25 0 11-1.5 0V5.122a2.25 2.25 0 111.5 0v1.543A3 3 0 016 6h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"
      />
    </svg>
  );
}

// Exported for testing
export { PIPELINE_STAGES, STAGE_ORDER, relativeTime };
