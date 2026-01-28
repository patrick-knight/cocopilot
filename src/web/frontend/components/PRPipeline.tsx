/**
 * PRPipeline — Horizontal pipeline visualization for PR progression.
 *
 * Displays PRs moving through pipeline stages:
 *   draft → ready → CI running → CI passed → merged
 *
 * Uses the cocoa theme:
 *   - Caramel (#C68B3C) for active stages
 *   - Milk-chocolate (#7B3F00) for completed stages
 *   - Cream (#FFF8E7) for pending stages
 *
 * Shows: PR title, author, branch name, and time in current stage.
 */

import React, { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stages a PR progresses through. */
export type PRStage = "draft" | "ready" | "ci_running" | "ci_passed" | "ci_failed" | "merged";

/** A pull request in the pipeline. */
export interface PRPipelineEntry {
  number: number;
  title: string;
  url: string;
  branch: string;
  author: string;
  stage: PRStage;
  workerName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PRPipelineProps {
  prs: PRPipelineEntry[];
}

// ---------------------------------------------------------------------------
// Pipeline stage configuration
// ---------------------------------------------------------------------------

/** The ordered main-line stages displayed as nodes. */
const PIPELINE_STAGES: PRStage[] = ["draft", "ready", "ci_running", "ci_passed", "merged"];

const STAGE_LABELS: Record<PRStage, string> = {
  draft: "Draft",
  ready: "Ready",
  ci_running: "CI Running",
  ci_passed: "CI Passed",
  ci_failed: "CI Failed",
  merged: "Merged",
};

/** Numeric index for ordering. ci_failed shares ci_running's position. */
const STAGE_INDEX: Record<PRStage, number> = {
  draft: 0,
  ready: 1,
  ci_running: 2,
  ci_passed: 3,
  ci_failed: 2,
  merged: 4,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PRPipeline({ prs }: PRPipelineProps): React.ReactElement {
  if (prs.length === 0) {
    return (
      <section aria-label="PR Pipeline">
        <h2 className="text-lg font-semibold text-[#3B1F0B]">PR Pipeline</h2>
        <p className="mt-2 text-sm text-gray-500 italic">No pull requests in the pipeline.</p>
      </section>
    );
  }

  const activePRs = prs
    .filter((p) => p.stage !== "merged")
    .sort((a, b) => b.number - a.number);

  const mergedPRs = prs
    .filter((p) => p.stage === "merged")
    .sort((a, b) => b.number - a.number);

  return (
    <section aria-label="PR Pipeline">
      <h2 className="text-lg font-semibold text-[#3B1F0B]">PR Pipeline</h2>

      {activePRs.length > 0 && (
        <div className="mt-3 space-y-3" data-testid="active-prs">
          {activePRs.map((pr) => (
            <PRCard key={pr.number} pr={pr} />
          ))}
        </div>
      )}

      {activePRs.length === 0 && mergedPRs.length > 0 && (
        <p className="mt-2 text-sm text-gray-500 italic">All pull requests have been merged.</p>
      )}

      {mergedPRs.length > 0 && (
        <MergedSection prs={mergedPRs} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// PR card with pipeline nodes
// ---------------------------------------------------------------------------

function PRCard({ pr }: { pr: PRPipelineEntry }): React.ReactElement {
  const isFailed = pr.stage === "ci_failed";

  return (
    <div
      className="rounded-lg border border-[#C68B3C]/30 bg-white p-4 shadow-sm"
      data-testid={`pr-row-${pr.number}`}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-sm font-semibold text-[#C68B3C] hover:underline"
            title={`Open PR #${pr.number}`}
          >
            #{pr.number}
          </a>
          <span className="text-sm text-[#3B1F0B] truncate" title={pr.title}>
            {pr.title}
          </span>
        </div>
        <span className="shrink-0 text-xs text-gray-400" title={pr.updatedAt}>
          {timeInStage(pr.updatedAt)}
        </span>
      </div>

      {/* Metadata */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1" title={`Branch: ${pr.branch}`}>
          <BranchIcon />
          <span className="font-mono">{pr.branch}</span>
        </span>
        <span title={`Author: ${pr.author}`}>by {pr.author}</span>
        {pr.workerName && (
          <span className="text-gray-400" title={`Worker: ${pr.workerName}`}>
            worker: {pr.workerName}
          </span>
        )}
      </div>

      {/* Pipeline stage nodes */}
      <div className="mt-3">
        <StageNodes currentStage={pr.stage} isFailed={isFailed} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage nodes (horizontal pipeline)
// ---------------------------------------------------------------------------

function StageNodes({
  currentStage,
  isFailed,
}: {
  currentStage: PRStage;
  isFailed: boolean;
}): React.ReactElement {
  const currentIdx = STAGE_INDEX[currentStage];

  return (
    <div
      className="flex items-center"
      role="group"
      aria-label={`Pipeline stage: ${STAGE_LABELS[currentStage]}`}
    >
      {PIPELINE_STAGES.map((stage, idx) => {
        const isCompleted = currentIdx > idx;
        const isCurrent = currentIdx === idx && !isFailed;
        const isFailedHere = isFailed && idx === STAGE_INDEX.ci_running;

        // Cocoa theme node colors:
        //   completed  → milk-chocolate (#7B3F00)
        //   active     → caramel (#C68B3C)
        //   failed     → red
        //   pending    → cream (#FFF8E7) with border
        let nodeClass: string;
        if (isFailedHere) {
          nodeClass = "border-red-500 bg-red-500 text-white";
        } else if (isCompleted) {
          nodeClass = "border-[#7B3F00] bg-[#7B3F00] text-white";
        } else if (isCurrent) {
          nodeClass = "border-[#C68B3C] bg-[#C68B3C] text-white";
        } else {
          nodeClass = "border-gray-300 bg-[#FFF8E7] text-gray-300";
        }

        let labelClass: string;
        if (isFailedHere) {
          labelClass = "text-red-600 font-medium";
        } else if (isCurrent) {
          labelClass = "text-[#C68B3C] font-medium";
        } else if (isCompleted) {
          labelClass = "text-[#7B3F00]";
        } else {
          labelClass = "text-gray-400";
        }

        return (
          <React.Fragment key={stage}>
            {idx > 0 && (
              <div
                className={`flex-1 h-0.5 ${isCompleted ? "bg-[#7B3F00]" : "bg-gray-200"}`}
                data-testid={`connector-${idx}`}
              />
            )}
            <div className="flex flex-col items-center" data-testid={`stage-${stage}`}>
              <div
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[8px] font-bold ${nodeClass}`}
                title={STAGE_LABELS[stage]}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isFailedHere ? "\u2717" : isCompleted ? "\u2713" : ""}
              </div>
              <span className={`mt-1 text-[10px] leading-tight ${labelClass}`}>
                {isFailedHere ? "CI Failed" : STAGE_LABELS[stage]}
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

function MergedSection({ prs }: { prs: PRPipelineEntry[] }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-4" data-testid="merged-section">
      <button
        type="button"
        className="text-sm text-gray-500 hover:text-[#3B1F0B] transition-colors"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? "\u25BE" : "\u25B8"} {prs.length} merged PR{prs.length !== 1 ? "s" : ""}
      </button>
      {expanded && (
        <div className="mt-2 space-y-2" data-testid="merged-prs">
          {prs.map((pr) => (
            <div
              key={pr.number}
              className="flex items-center gap-3 rounded-lg border border-gray-100 bg-[#FFF8E7] px-4 py-2"
              data-testid={`merged-pr-row-${pr.number}`}
            >
              <span className="text-[#7B3F00] text-sm" aria-hidden="true">
                {"\u2713"}
              </span>
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-[#C68B3C] hover:underline"
              >
                #{pr.number}
              </a>
              <span className="text-sm text-[#3B1F0B] truncate">{pr.title}</span>
              <span className="ml-auto shrink-0 text-xs text-gray-400">
                {timeInStage(pr.updatedAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a human-readable relative time (e.g. "2h ago"). */
function timeInStage(iso: string): string {
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
