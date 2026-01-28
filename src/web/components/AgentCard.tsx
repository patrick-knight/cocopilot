/**
 * AgentCard – Displays a single agent's status in the Tempering Station.
 *
 * Shows the agent icon, name, status indicator, current action, and
 * last activity timestamp. Supports Chocolatier (supervisor), Temperer
 * (merge-queue), Enrober (PR shepherd), and Truffle (worker) agent types.
 */

import React from "react";
import type { AgentState, WorkerState } from "../types.js";
import { AGENT_DISPLAY, STATUS_COLORS } from "../types.js";

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

  return (
    <div className="rounded-lg border border-stone-300 bg-cream-50 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl" role="img" aria-label={display.label}>
            {display.icon}
          </span>
          <h3 className="font-semibold text-stone-800">{display.label}</h3>
        </div>
        <StatusBadge status={agent.status} color={statusColor} />
      </div>

      <p className="mt-2 text-sm text-stone-600">{display.description}</p>

      <p className="mt-1 text-xs text-stone-400">Last activity: {lastActivity}</p>

      {agent.error && (
        <p className="mt-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1">{agent.error}</p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded bg-stone-700 px-3 py-1 text-xs text-white hover:bg-stone-600 transition-colors"
          onClick={() => onView?.(agent.name)}
        >
          View
        </button>
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
}

export function WorkerCard({ worker, onView, onStop }: WorkerCardProps): React.ReactElement {
  const display = AGENT_DISPLAY.worker;
  const statusColor = STATUS_COLORS[worker.status] ?? "bg-gray-400";
  const lastActivity = formatTimestamp(worker.updatedAt);
  const isActive = worker.status === "starting" || worker.status === "working";

  return (
    <div className="rounded-lg border border-stone-300 bg-cream-50 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl" role="img" aria-label="worker">
            {display.icon}
          </span>
          <h3 className="font-semibold text-stone-800">{worker.name}</h3>
        </div>
        <StatusBadge status={worker.status} color={statusColor} />
      </div>

      <p className="mt-2 text-sm text-stone-600 line-clamp-2" title={worker.task}>
        {worker.task}
      </p>

      <div className="mt-1 flex flex-col gap-0.5">
        <p className="text-xs text-stone-400">Branch: {worker.branch}</p>
        <p className="text-xs text-stone-400">Last activity: {lastActivity}</p>
        {worker.prUrl && (
          <a
            href={worker.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-caramel-600 hover:underline"
          >
            PR #{worker.prNumber}
          </a>
        )}
      </div>

      {worker.error && (
        <p className="mt-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1">{worker.error}</p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded bg-stone-700 px-3 py-1 text-xs text-white hover:bg-stone-600 transition-colors"
          onClick={() => onView?.(worker.name)}
        >
          View
        </button>
        {isActive && (
          <button
            type="button"
            className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-500 transition-colors"
            onClick={() => onStop?.(worker.name)}
          >
            Stop
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
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-stone-700 bg-stone-100">
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
