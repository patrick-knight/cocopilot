// @ts-nocheck - ink components have incompatible types with React 19
/**
 * TUI PR Pipeline Component
 * 
 * Displays PR status with ASCII progress bars showing pipeline stage:
 * draft → ready → CI running → CI passed → merged
 */

import React from "react";
import { Box, Text } from "ink";
import { symbols, noColor } from "../utils/colors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PRStage = "draft" | "ready" | "ci_running" | "ci_passed" | "ci_failed" | "merged";

export interface PREntry {
  number: number;
  title: string;
  url?: string;
  branch: string;
  stage: PRStage;
  workerName?: string;
  updatedAt?: string;
}

interface PRPipelineProps {
  prs: PREntry[];
  maxDisplay?: number;
}

// ---------------------------------------------------------------------------
// Stage configuration
// ---------------------------------------------------------------------------

const STAGE_CONFIG: Record<PRStage, { label: string; progress: number; color: string; symbol: string }> = {
  draft: { label: "Draft", progress: 15, color: "gray", symbol: "○" },
  ready: { label: "Ready", progress: 35, color: "blue", symbol: "◐" },
  ci_running: { label: "CI Running", progress: 60, color: "yellow", symbol: "◑" },
  ci_passed: { label: "CI Passed", progress: 85, color: "green", symbol: "◕" },
  ci_failed: { label: "CI Failed", progress: 60, color: "red", symbol: "✗" },
  merged: { label: "Merged", progress: 100, color: "green", symbol: "✓" },
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function progressBar(progress: number, width: number = 28): string {
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;
  
  if (noColor) {
    return "#".repeat(filled) + "-".repeat(empty);
  }
  return "█".repeat(filled) + "░".repeat(empty);
}

function relativeTime(iso?: string): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function PRRow({ pr }: { pr: PREntry }): React.ReactElement {
  const config = STAGE_CONFIG[pr.stage];
  const bar = progressBar(config.progress);
  
  return (
    <Box>
      <Box width={8}>
        <Text bold>PR #{pr.number}</Text>
      </Box>
      <Box width={32}>
        <Text color={config.color as any}>{bar}</Text>
      </Box>
      <Box width={14}>
        <Text color={config.color as any}>
          {config.label} {config.symbol}
        </Text>
      </Box>
      {pr.workerName && (
        <Box>
          <Text dimColor>({pr.workerName})</Text>
        </Box>
      )}
    </Box>
  );
}

export function PRPipeline({ prs, maxDisplay = 10 }: PRPipelineProps): React.ReactElement {
  if (prs.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold underline>PR Pipeline</Text>
        <Text dimColor>No pull requests in the pipeline.</Text>
      </Box>
    );
  }

  // Separate active from merged
  const activePRs = prs
    .filter((p) => p.stage !== "merged")
    .sort((a, b) => b.number - a.number);

  const mergedPRs = prs
    .filter((p) => p.stage === "merged")
    .sort((a, b) => b.number - a.number);

  // Limit display
  const displayActive = activePRs.slice(0, maxDisplay);
  const displayMerged = mergedPRs.slice(0, Math.max(0, maxDisplay - displayActive.length));
  const hiddenCount = prs.length - displayActive.length - displayMerged.length;

  return (
    <Box flexDirection="column">
      <Text bold underline>PR Pipeline</Text>
      
      {/* Separator line */}
      <Text dimColor>{"─".repeat(60)}</Text>
      
      {/* Active PRs */}
      {displayActive.map((pr) => (
        <PRRow key={pr.number} pr={pr} />
      ))}

      {/* Merged PRs (dimmed) */}
      {displayMerged.length > 0 && displayActive.length > 0 && (
        <Text dimColor>{"─".repeat(40)}</Text>
      )}
      {displayMerged.map((pr) => (
        <Box key={pr.number}>
          <Box width={8}>
            <Text dimColor>PR #{pr.number}</Text>
          </Box>
          <Box width={32}>
            <Text color="green">{progressBar(100)}</Text>
          </Box>
          <Box width={14}>
            <Text color="green">Merged ✓</Text>
          </Box>
        </Box>
      ))}

      {/* Hidden count */}
      {hiddenCount > 0 && (
        <Text dimColor>  +{hiddenCount} more PRs</Text>
      )}

      {/* Summary */}
      <Box marginTop={1}>
        <Text dimColor>
          {activePRs.length} active, {mergedPRs.length} merged
        </Text>
      </Box>
    </Box>
  );
}
