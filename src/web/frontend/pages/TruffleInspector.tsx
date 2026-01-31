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
// Helper: Status Badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const statusConfig: Record<string, { color: string; bgColor: string; icon: string }> = {
    working: { color: "text-chart-2", bgColor: "bg-chart-2/20", icon: "⚡" },
    starting: { color: "text-chart-1", bgColor: "bg-chart-1/20", icon: "🚀" },
    completed: { color: "text-chart-2", bgColor: "bg-chart-2/20", icon: "✅" },
    failed: { color: "text-destructive", bgColor: "bg-destructive/20", icon: "❌" },
    stuck: { color: "text-chart-4", bgColor: "bg-chart-4/20", icon: "⚠️" },
    terminated: { color: "text-muted-foreground", bgColor: "bg-muted", icon: "🛑" },
  };
  const config = statusConfig[status] ?? { color: "text-muted-foreground", bgColor: "bg-muted", icon: "❓" };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full ${config.bgColor} px-3 py-1 text-sm font-medium ${config.color}`}>
      <span>{config.icon}</span>
      {status}
    </span>
  );
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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">🍫</div>
          <p className="text-muted-foreground text-lg">Loading worker details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center bg-card p-8 rounded-lg shadow-lg border border-border max-w-md">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-destructive mb-2">Error Loading Worker</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={onBack}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={fetchWorker}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors"
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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center bg-card p-8 rounded-lg shadow-lg border border-border">
          <div className="text-4xl mb-4">🔍</div>
          <h2 className="text-xl font-bold text-foreground mb-2">Worker Not Found</h2>
          <p className="text-muted-foreground mb-4">The worker "{workerName}" could not be found.</p>
          <button
            onClick={onBack}
            className="text-sm text-primary hover:underline"
          >
            ← Back to repository
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-8">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <button
              type="button"
              onClick={onBack}
              className="hover:text-primary transition-colors flex items-center gap-1"
            >
              <span>🍫</span>
              <span>Cocoa Board</span>
            </button>
            <span>/</span>
            <button
              type="button"
              onClick={onBack}
              className="hover:text-primary transition-colors"
            >
              {repoName}
            </button>
            <span>/</span>
            <span className="text-foreground font-medium">{worker.name}</span>
          </div>

          {/* Title and status */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="text-4xl">🔧</div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">{worker.name}</h1>
                <p className="text-muted-foreground">{worker.task || "Worker Details"}</p>
              </div>
              <StatusBadge status={worker.status} />
            </div>
            <button
              onClick={onBack}
              className="inline-flex items-center gap-2 border border-border hover:border-primary text-foreground px-4 py-2 rounded-lg font-medium transition-colors"
            >
              ← Back to Repository
            </button>
          </div>

          {/* Stats bar */}
          <div className="mt-6 flex flex-wrap items-center gap-4">
            {worker.branch && (
              <div className="bg-card border border-border rounded-lg px-4 py-2 flex items-center gap-2">
                <span className="text-2xl">🌿</span>
                <div>
                  <div className="text-sm text-muted-foreground">Branch</div>
                  <div className="font-semibold text-foreground font-mono text-sm">{worker.branch}</div>
                </div>
              </div>
            )}
            {/* Worktree path */}
            <div className="bg-card border border-border rounded-lg px-4 py-2 flex items-center gap-2">
              <span className="text-2xl">📁</span>
              <div>
                <div className="text-sm text-muted-foreground">Worktree</div>
                <div className="font-semibold text-foreground font-mono text-sm truncate max-w-xs" title={`~/.cocopilot/repos/${repoName}/worktrees/${worker.name}`}>
                  ~/.cocopilot/repos/{repoName}/worktrees/{worker.name}
                </div>
              </div>
            </div>
            {worker.prUrl && (
              <a
                href={worker.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-card border border-border rounded-lg px-4 py-2 flex items-center gap-2 hover:border-primary transition-colors"
              >
                <span className="text-2xl">🔗</span>
                <div>
                  <div className="text-sm text-muted-foreground">Pull Request</div>
                  <div className="font-semibold text-primary">View PR →</div>
                </div>
              </a>
            )}
            {worker.createdAt && (
              <div className="bg-card border border-border rounded-lg px-4 py-2 flex items-center gap-2">
                <span className="text-2xl">🕐</span>
                <div>
                  <div className="text-sm text-muted-foreground">Created</div>
                  <div className="font-semibold text-foreground text-sm">
                    {new Date(worker.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Main content grid: output + sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: Live output (2/3 width on large screens) */}
          <div className="lg:col-span-2 space-y-6">
            {/* Live Output */}
            <section className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
              <div className="bg-muted/50 px-4 py-3 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <span>📺</span> Live Output
                </h2>
              </div>
              <div className="p-4">
                <LiveOutput
                  workerName={worker.name}
                  socket={socket}
                />
              </div>
            </section>

            {/* Git Log */}
            <section className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
              <div className="bg-muted/50 px-4 py-3 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <span>📝</span> Git Activity
                </h2>
              </div>
              <div className="p-4">
                <GitLog
                  repoName={repoName}
                  workerName={worker.name}
                  apiBase={apiBase}
                />
              </div>
            </section>
          </div>

          {/* Right column: Controls, resources, messages (1/3 width) */}
          <div className="space-y-6">
            {/* Worker Controls */}
            <section className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
              <div className="bg-muted/50 px-4 py-3 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <span>🎮</span> Controls
                </h2>
              </div>
              <div className="p-4">
                <WorkerControls
                  workerName={worker.name}
                  status={worker.status}
                  repoName={repoName}
                  apiBase={apiBase}
                  onAction={handleAction}
                />
              </div>
            </section>

            {/* Resource Usage */}
            <section className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
              <div className="bg-muted/50 px-4 py-3 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <span>📊</span> Resources
                </h2>
              </div>
              <div className="p-4">
                <ResourceUsage
                  resources={worker.resources ?? null}
                  containerStatus={worker.containerStatus}
                />
              </div>
            </section>

            {/* Message Inspector */}
            <section className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
              <div className="bg-muted/50 px-4 py-3 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <span>💬</span> Messages
                </h2>
              </div>
              <div className="p-4">
                <MessageInspector
                  workerName={worker.name}
                  repoName={repoName}
                  apiBase={apiBase}
                />
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-16 text-center text-muted-foreground text-sm">
          <p>CoCoPilot v0.1.0 · Collaborative Copilot Orchestration Platform</p>
        </footer>
      </div>
    </div>
  );
};
