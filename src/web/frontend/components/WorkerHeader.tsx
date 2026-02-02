/**
 * WorkerHeader — Truffle Inspector header showing worker identity and task.
 *
 * Displays the worker name, task description, branch, status badge,
 * PR link, model, and timing information.
 */

import React from "react";
import type { WorkerDetail } from "../inspector-types.js";
import type { WorkerStatus } from "../../../state/index.js";

// ---------------------------------------------------------------------------
// Status badge configuration
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<WorkerStatus, { bg: string; text: string; label: string }> = {
  starting: { bg: "bg-blue-100", text: "text-blue-800", label: "Starting" },
  working: { bg: "bg-green-100", text: "text-green-800", label: "Working" },
  stuck: { bg: "bg-yellow-100", text: "text-yellow-800", label: "Stuck" },
  completed: { bg: "bg-emerald-100", text: "text-emerald-800", label: "Completed" },
  failed: { bg: "bg-red-100", text: "text-red-800", label: "Failed" },
  terminated: { bg: "bg-gray-100", text: "text-gray-800", label: "Terminated" },
  merged: { bg: "bg-purple-100", text: "text-purple-800", label: "Merged" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface WorkerHeaderProps {
  worker: WorkerDetail;
}

export const WorkerHeader: React.FC<WorkerHeaderProps> = ({ worker }) => {
  const status = STATUS_STYLES[worker.status] ?? STATUS_STYLES.starting;
  const createdDate = new Date(worker.createdAt).toLocaleString();
  const updatedDate = new Date(worker.updatedAt).toLocaleString();

  return (
    <div className="bg-white rounded-lg shadow-sm border border-stone-200 p-6">
      {/* Top row: name + status */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-stone-900">{worker.name}</h1>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.bg} ${status.text}`}
          >
            {status.label}
          </span>
        </div>
        {worker.containerId && (
          <span className="text-xs text-stone-400 font-mono">
            {worker.containerId.slice(0, 12)}
          </span>
        )}
      </div>

      {/* Task description */}
      <p className="text-stone-700 mb-4">{worker.task}</p>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          {worker.prUrl && worker.prNumber ? (
            <>
              <span className="text-stone-500">Pull Request</span>
              <p>
                <a
                  href={worker.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-700 hover:text-amber-900 font-medium"
                >
                  PR #{worker.prNumber} &rarr;
                </a>
              </p>
            </>
          ) : (
            <>
              <span className="text-stone-500">Pull Request</span>
              <p className="text-stone-400">—</p>
            </>
          )}
          <span className="text-stone-500 mt-2 block">Branch</span>
          <p className="font-mono text-stone-800">{worker.branch}</p>
        </div>
        <div>
          <span className="text-stone-500">Model</span>
          <p className="text-stone-800">{worker.model ?? "default"}</p>
        </div>
        <div>
          <span className="text-stone-500">Created</span>
          <p className="text-stone-800">{createdDate}</p>
        </div>
        <div>
          <span className="text-stone-500">Last Update</span>
          <p className="text-stone-800">{updatedDate}</p>
        </div>
      </div>

      {/* Error message */}
      {worker.error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-800 text-sm font-mono">{worker.error}</p>
        </div>
      )}
    </div>
  );
};
