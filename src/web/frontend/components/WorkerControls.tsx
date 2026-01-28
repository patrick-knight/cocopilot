/**
 * WorkerControls — Manual intervention controls for a worker.
 *
 * Provides buttons to pause, resume, terminate, and nudge a worker.
 * Includes a confirmation dialog for destructive actions.
 */

import React, { useState, useCallback } from "react";
import type { WorkerStatus } from "../../../state/index.js";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface WorkerControlsProps {
  /** Worker name. */
  workerName: string;
  /** Current worker status. */
  status: WorkerStatus;
  /** Repository name. */
  repoName: string;
  /** Base API URL (e.g., "/api/v1"). */
  apiBase?: string;
  /** Callback invoked after a control action succeeds. */
  onAction?: (action: string) => void;
}

export const WorkerControls: React.FC<WorkerControlsProps> = ({
  workerName,
  status,
  repoName,
  apiBase = "/api/v1",
  onAction,
}) => {
  const [nudgeText, setNudgeText] = useState("");
  const [showNudge, setShowNudge] = useState(false);
  const [confirmTerminate, setConfirmTerminate] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isActive = status === "starting" || status === "working" || status === "stuck";
  const baseUrl = `${apiBase}/repositories/${encodeURIComponent(repoName)}/workers/${encodeURIComponent(workerName)}`;

  const doAction = useCallback(
    async (action: string, body?: object) => {
      setLoading(action);
      setError(null);
      try {
        const res = await fetch(`${baseUrl}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        onAction?.(action);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(null);
      }
    },
    [baseUrl, onAction],
  );

  const handleNudge = useCallback(async () => {
    if (!nudgeText.trim()) return;
    await doAction("nudge", { message: nudgeText.trim() });
    setNudgeText("");
    setShowNudge(false);
  }, [doAction, nudgeText]);

  const handleTerminate = useCallback(async () => {
    await doAction("terminate");
    setConfirmTerminate(false);
  }, [doAction]);

  const handlePause = useCallback(() => doAction("pause"), [doAction]);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-stone-200">
      <div className="px-4 py-3 border-b border-stone-200">
        <h2 className="text-sm font-semibold text-stone-700">Controls</h2>
      </div>

      <div className="p-4 space-y-3">
        {/* Error display */}
        {error && (
          <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {isActive && (
            <>
              <button
                onClick={() => setShowNudge(!showNudge)}
                disabled={loading !== null}
                className="px-3 py-1.5 text-sm bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-md font-medium disabled:opacity-50"
              >
                Nudge
              </button>
              <button
                onClick={handlePause}
                disabled={loading !== null}
                className="px-3 py-1.5 text-sm bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-md font-medium disabled:opacity-50"
              >
                {loading === "pause" ? "Pausing..." : "Pause"}
              </button>
              <button
                onClick={() => setConfirmTerminate(true)}
                disabled={loading !== null}
                className="px-3 py-1.5 text-sm bg-red-100 hover:bg-red-200 text-red-800 rounded-md font-medium disabled:opacity-50"
              >
                Terminate
              </button>
            </>
          )}

          {!isActive && (
            <p className="text-sm text-stone-500">
              Worker is {status}. No actions available.
            </p>
          )}
        </div>

        {/* Nudge input */}
        {showNudge && (
          <div className="flex gap-2">
            <input
              type="text"
              value={nudgeText}
              onChange={(e) => setNudgeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNudge();
              }}
              placeholder="Send a helpful hint to this worker..."
              className="flex-1 px-3 py-1.5 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button
              onClick={handleNudge}
              disabled={loading !== null || !nudgeText.trim()}
              className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-md font-medium disabled:opacity-50"
            >
              {loading === "nudge" ? "Sending..." : "Send"}
            </button>
          </div>
        )}

        {/* Terminate confirmation */}
        {confirmTerminate && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-800 mb-2">
              Are you sure you want to terminate <strong>{workerName}</strong>?
              This will stop the container and cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleTerminate}
                disabled={loading !== null}
                className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-md font-medium disabled:opacity-50"
              >
                {loading === "terminate" ? "Terminating..." : "Confirm Terminate"}
              </button>
              <button
                onClick={() => setConfirmTerminate(false)}
                className="px-3 py-1.5 text-sm bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-md font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
