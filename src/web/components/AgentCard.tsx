/**
 * AgentCard – Displays a single agent's status in the Tempering Station.
 *
 * Shows the agent icon, name, status indicator, current action, and
 * last activity timestamp. Supports Chocolatier (supervisor), Temperer
 * (merge-queue), Enrober (PR shepherd), and Truffle (worker) agent types.
 */

import React, { useState, useEffect } from "react";
import type { AgentState, WorkerState } from "../types.js";
import { AGENT_DISPLAY, STATUS_COLORS } from "../types.js";
import { useAgentStream } from "../hooks/useSocket.js";

// ---------------------------------------------------------------------------
// Agent card (system agents: Chocolatier, Temperer, Enrober)
// ---------------------------------------------------------------------------

export interface AgentCardProps {
  agent: AgentState;
  /** Called when user clicks "View" to open agent output. */
  onView?: (agentName: string) => void;
}

export function AgentCard({ agent, onView }: AgentCardProps): React.ReactElement {
  const display = AGENT_DISPLAY[agent.type];
  const statusColor = STATUS_COLORS[agent.status] ?? "bg-gray-400";
  const lastActivity = formatTimestamp(agent.lastActivity);
  
  // Collapsible output state
  const [showOutput, setShowOutput] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl" role="img" aria-label={display.label}>
            {display.icon}
          </span>
          <h3 className="font-semibold text-foreground">{display.label}</h3>
        </div>
        <StatusBadge status={agent.status} color={statusColor} />
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{display.description}</p>

      <p className="mt-1 text-xs text-muted-foreground/70">Last activity: {lastActivity}</p>

      {agent.error && (
        <p className="mt-2 text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{agent.error}</p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/80 transition-colors"
          onClick={() => setShowOutput(!showOutput)}
        >
          {showOutput ? "▾ Hide Output" : "▸ View Output"}
        </button>
      </div>

      {/* Collapsible Live Output */}
      {showOutput && (
        <AgentOutputPanel agentName={agent.name} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Output Panel - Shows live streaming output for an agent
// ---------------------------------------------------------------------------

interface AgentOutputPanelProps {
  agentName: string;
}

function AgentOutputPanel({ agentName }: AgentOutputPanelProps): React.ReactElement {
  const { lines, clear } = useAgentStream(agentName);

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">Live Output</span>
        <button
          type="button"
          onClick={clear}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear
        </button>
      </div>
      <div className="bg-muted rounded-lg p-2 max-h-48 overflow-y-auto font-mono text-xs">
        {lines.length === 0 ? (
          <p className="text-muted-foreground italic">No output yet...</p>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={`${line.stream === "stderr" ? "text-destructive" : "text-foreground"}`}>
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Worker card (Truffles – individual workers)
// ---------------------------------------------------------------------------

export interface WorkerCardProps {
  worker: WorkerState;
  /** Called when user clicks "View" to open worker output. */
  onView?: (workerName: string) => void;
  /** Called when user clicks "Stop" to terminate the worker. */
  onStop?: (workerName: string) => void;
  /** Called when user clicks "Delete" to remove a completed/failed worker. */
  onDelete?: (workerName: string) => void;
}

export function WorkerCard({ worker, onView, onStop, onDelete }: WorkerCardProps): React.ReactElement {
  const display = AGENT_DISPLAY.worker;
  const statusColor = STATUS_COLORS[worker.status] ?? "bg-gray-400";
  const lastActivity = formatTimestamp(worker.updatedAt);
  const isActive = worker.status === "starting" || worker.status === "working";
  const canDelete = worker.status === "completed" || worker.status === "failed" || worker.status === "stuck" || worker.status === "terminated";

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl" role="img" aria-label="worker">
            {display.icon}
          </span>
          <h3 className="font-semibold text-foreground">{worker.name}</h3>
        </div>
        <StatusBadge status={worker.status} color={statusColor} />
      </div>

      <p className="mt-2 text-sm text-muted-foreground line-clamp-2" title={worker.task}>
        {worker.task}
      </p>

      <div className="mt-1 flex flex-col gap-0.5">
        <p className="text-xs text-muted-foreground/70">Branch: {worker.branch}</p>
        <p className="text-xs text-muted-foreground/70">Last activity: {lastActivity}</p>
        {worker.prUrl && (
          <a
            href={worker.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            PR #{worker.prNumber}
          </a>
        )}
      </div>

      {worker.error && (
        <p className="mt-2 text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{worker.error}</p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/80 transition-colors"
          onClick={() => onView?.(worker.name)}
        >
          View
        </button>
        {isActive && (
          <button
            type="button"
            className="rounded bg-destructive px-3 py-1 text-xs text-destructive-foreground hover:bg-destructive/80 transition-colors"
            onClick={() => onStop?.(worker.name)}
          >
            Stop
          </button>
        )}
        {canDelete && onDelete && (
          <button
            type="button"
            className="rounded border border-border bg-muted px-3 py-1 text-xs text-muted-foreground hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
            onClick={() => onDelete(worker.name)}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

interface StatusBadgeProps {
  status: string;
  color: string;
}

function StatusBadge({ status, color }: StatusBadgeProps): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-foreground bg-muted">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden="true" />
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  if (!iso) return "—";
  try {
    const date = new Date(iso);
    const now = Date.now();
    const diffMs = now - date.getTime();

    if (diffMs < 60_000) return "just now";
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
    return date.toLocaleDateString();
  } catch {
    return "—";
  }
}
