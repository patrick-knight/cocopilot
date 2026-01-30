/**
 * TruffleInspector — Worker Detail Page
 *
 * Full observability into a single Truffle worker's operation.
 * Composes all worker-related components into a cohesive detail view:
 *
 *   - Worker header (task, status, branch, PR link)
 *   - Live streaming output
 *   - Git log for the worktree
 *   - Container resource usage
 *   - Manual intervention controls (nudge, pause, terminate)
 *   - Inter-agent message inspector
 *
 * Route: /repos/:repoName/workers/:workerName
 */

import React, { useEffect, useState, useCallback } from "react";
import type { WorkerDetail } from "../inspector-types.js";
import { WorkerHeader } from "../components/WorkerHeader.js";
import { LiveOutput } from "../components/LiveOutput.js";
import { GitLog } from "../components/GitLog.js";
import { ResourceUsage } from "../components/ResourceUsage.js";
import { WorkerControls } from "../components/WorkerControls.js";
import { MessageInspector } from "../components/MessageInspector.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TruffleInspectorProps {
  /** Repository name from route params. */
  repoName: string;
  /** Worker name from route params. */
  workerName: string;
  /** Socket.IO socket instance for real-time updates. */
  socket: {
    emit: (event: string, ...args: unknown[]) => void;
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    off: (event: string, handler: (...args: unknown[]) => void) => void;
  } | null;
  /** Base API URL. */
  apiBase?: string;
  /** Callback to navigate back to the repository view. */
  onBack?: () => void;
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export const TruffleInspector: React.FC<TruffleInspectorProps> = ({
  repoName,
  workerName,
  socket,
  apiBase = "/api/v1",
  onBack,
}) => {
  const [worker, setWorker] = useState<WorkerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Fetch worker details
  // -----------------------------------------------------------------------

  const fetchWorker = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/repositories/${encodeURIComponent(repoName)}/workers/${encodeURIComponent(workerName)}`,
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as WorkerDetail;
      setWorker(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase, repoName, workerName]);

  useEffect(() => {
    fetchWorker();
  }, [fetchWorker]);

  // -----------------------------------------------------------------------
  // Listen for real-time status updates
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!socket) return;

    const handleStatus = (event: unknown) => {
      const statusEvent = event as {
        workerName: string;
        status: string;
        error?: string;
      };
      if (statusEvent.workerName !== workerName) return;

      setWorker((prev) =>
        prev
          ? {
              ...prev,
              status: statusEvent.status as WorkerDetail["status"],
              error: statusEvent.error ?? prev.error,
              updatedAt: new Date().toISOString(),
            }
          : prev,
      );
    };

    const handleCompleted = (event: unknown) => {
      const completionEvent = event as {
        workerName: string;
        summary: string;
        prUrl?: string;
      };
      if (completionEvent.workerName !== workerName) return;

      setWorker((prev) =>
        prev
          ? {
              ...prev,
              status: "completed" as const,
              prUrl: completionEvent.prUrl ?? prev.prUrl,
              completedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : prev,
      );
    };

    socket.on("worker:status", handleStatus);
    socket.on("worker:completed", handleCompleted);

    return () => {
      socket.off("worker:status", handleStatus);
      socket.off("worker:completed", handleCompleted);
    };
  }, [socket, workerName]);

  // -----------------------------------------------------------------------
  // Control action handler — refresh worker data after actions
  // -----------------------------------------------------------------------

  const handleAction = useCallback(() => {
    fetchWorker();
  }, [fetchWorker]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading worker details...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            &larr; Back to repository
          </button>
          <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-lg">
            <h1 className="text-lg font-bold text-destructive mb-2">
              Error Loading Worker
            </h1>
            <p className="text-destructive/90">{error}</p>
            <button
              onClick={fetchWorker}
              className="mt-4 px-4 py-2 bg-destructive/20 hover:bg-destructive/30 text-destructive rounded-md text-sm font-medium"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!worker) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            &larr; Back to repository
          </button>
          <p className="text-muted-foreground">Worker not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation breadcrumb */}
      <div className="bg-primary text-primary-foreground/80 px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-2 text-sm">
          <button
            onClick={onBack}
            className="hover:text-primary-foreground"
          >
            CoCoPilot
          </button>
          <span className="text-primary-foreground/50">/</span>
          <button
            onClick={onBack}
            className="hover:text-primary-foreground"
          >
            {repoName}
          </button>
          <span className="text-primary-foreground/50">/</span>
          <span className="text-chart-4 font-medium">{worker.name}</span>
        </div>
      </div>

      {/* Page content */}
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Worker header */}
        <WorkerHeader worker={worker} />

        {/* Main content grid: output + sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: Live output (2/3 width on large screens) */}
          <div className="lg:col-span-2 space-y-6">
            <LiveOutput
              workerName={worker.name}
              socket={socket}
            />
            <GitLog
              repoName={repoName}
              workerName={worker.name}
              apiBase={apiBase}
            />
          </div>

          {/* Right column: Controls, resources, messages (1/3 width) */}
          <div className="space-y-6">
            <WorkerControls
              workerName={worker.name}
              status={worker.status}
              repoName={repoName}
              apiBase={apiBase}
              onAction={handleAction}
            />
            <ResourceUsage
              resources={worker.resources ?? null}
              containerStatus={worker.containerStatus}
            />
            <MessageInspector
              workerName={worker.name}
              repoName={repoName}
              apiBase={apiBase}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
