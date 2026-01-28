/**
 * PRPipeline – Visualizes the PR merge pipeline.
 *
 * Shows each tracked PR as a horizontal progress bar indicating its stage:
 * draft → ready → CI running → CI passed → merged.
 */

import React from "react";
import type { PRPipelineEntry } from "../types.js";
import { PR_STAGE_DISPLAY } from "../types.js";

export interface PRPipelineProps {
  /** Pull requests to display. */
  prs: PRPipelineEntry[];
}

export function PRPipeline({ prs }: PRPipelineProps): React.ReactElement {
  if (prs.length === 0) {
    return (
      <section aria-label="PR Pipeline">
        <h2 className="text-lg font-semibold text-stone-800">PR Pipeline</h2>
        <p className="mt-2 text-sm text-stone-500 italic">No pull requests in the pipeline.</p>
      </section>
    );
  }

  // Sort: merged at bottom, then by PR number descending
  const sorted = [...prs].sort((a, b) => {
    if (a.stage === "merged" && b.stage !== "merged") return 1;
    if (a.stage !== "merged" && b.stage === "merged") return -1;
    return b.number - a.number;
  });

  return (
    <section aria-label="PR Pipeline">
      <h2 className="text-lg font-semibold text-stone-800">PR Pipeline</h2>
      <div className="mt-2 space-y-3">
        {sorted.map((pr) => (
          <PRRow key={pr.number} pr={pr} />
        ))}
      </div>
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
  const stage = PR_STAGE_DISPLAY[pr.stage];

  return (
    <div className="flex items-center gap-3">
      {/* PR identifier */}
      <a
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        className="w-16 shrink-0 text-sm font-medium text-caramel-700 hover:underline"
        title={pr.title}
      >
        PR #{pr.number}
      </a>

      {/* Progress bar */}
      <div className="flex-1 h-5 rounded-full bg-stone-200 overflow-hidden" role="progressbar" aria-valuenow={stage.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`PR #${pr.number}: ${stage.label}`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${stage.color}`}
          style={{ width: `${stage.progress}%` }}
        />
      </div>

      {/* Stage label */}
      <span className={`w-24 shrink-0 text-xs font-medium text-right ${stageTextColor(pr.stage)}`}>
        {stage.label}
        {pr.stage === "merged" && " ✓"}
      </span>
    </div>
  );
}

function stageTextColor(stage: string): string {
  switch (stage) {
    case "merged":
      return "text-green-600";
    case "ci_failed":
      return "text-red-600";
    case "ci_running":
      return "text-yellow-600";
    default:
      return "text-stone-600";
  }
}
