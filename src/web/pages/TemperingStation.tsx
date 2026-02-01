/**
 * TemperingStation – Repository detail page for the Cocoa Board.
 *
 * Provides a deep dive into a specific repository with:
 * - Agent cards (Chocolatier, Temperer, Enrober + active Truffles)
 * - Live streaming output panel with agent selector
 * - PR pipeline visualization
 * - Message queue inspector
 * - "+ New Truffle" spawn button
 *
 * Route: /repos/:repoName
 */

import React, { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { AgentCard, WorkerCard } from "../components/AgentCard.js";
import { LiveOutputPanel } from "../components/LiveOutputPanel.js";
import { MessageQueueInspector } from "../components/MessageQueueInspector.js";
import { PRPipeline } from "../components/PRPipeline.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import {
  useAgentStream,
  useMessageQueue,
  usePRPipeline,
  useRepoState,
} from "../hooks/useSocket.js";
import { useSocket } from "../hooks/useSocket.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TemperingStationProps {
  /** Repository name (from route param). */
  repoName: string;
  /** Navigate back to Factory Floor. */
  onNavigateHome?: () => void;
  /** Open the Truffle Inspector for a specific worker. */
  onNavigateWorker?: (workerName: string) => void;
  /** Open the spawn worker modal. */
  onSpawnWorker?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TemperingStation({
  repoName,
  onNavigateHome,
  onNavigateWorker,
  onSpawnWorker,
}: TemperingStationProps): React.ReactElement {
  const { repo, agents, workers, loading, error } = useRepoState(repoName);
  const prs = usePRPipeline(repoName);
  const messages = useMessageQueue(repoName, workers);
  const { socket } = useSocket();

  // Live output panel state - auto-select first available agent/worker
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const { lines, clear: clearOutput } = useAgentStream(selectedAgent, repoName);

  // Auto-select first agent or worker when available and none selected
  React.useEffect(() => {
    if (selectedAgent) return;
    if (agents.length > 0) {
      setSelectedAgent(agents[0].name);
    } else if (workers.length > 0) {
      setSelectedAgent(workers[0].name);
    }
  }, [selectedAgent, agents, workers]);

  // Collapsible section state
  const [showAgents, setShowAgents] = useState(true);
  const [showActiveWorkers, setShowActiveWorkers] = useState(true);

  // Handlers
  const handleViewAgent = useCallback(
    (name: string) => {
      setSelectedAgent(name);
    },
    [],
  );

  const handleViewWorker = useCallback(
    (name: string) => {
      if (onNavigateWorker) {
        onNavigateWorker(name);
      } else {
        // Fallback: show output in the live panel
        setSelectedAgent(name);
      }
    },
    [onNavigateWorker],
  );

  const handleStopWorker = useCallback(
    (name: string) => {
      socket?.emit("worker:stop", name);
    },
    [socket],
  );

  const handleDeleteWorker = useCallback(
    async (name: string) => {
      if (!confirm(`Delete worker "${name}"? This cannot be undone.`)) {
        return;
      }
      try {
        const response = await fetch(`/api/v1/workers/${encodeURIComponent(name)}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          const text = await response.text();
          alert(`Failed to delete worker: ${text || response.statusText}`);
        }
      } catch (err) {
        alert(`Failed to delete worker: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [],
  );

  const handleRestartWorker = useCallback(
    async (name: string) => {
      if (!confirm(`Restart worker "${name}"?`)) {
        return;
      }
      try {
        const response = await fetch(
          `/api/v1/repositories/${encodeURIComponent(repoName)}/workers/${encodeURIComponent(name)}/restart`,
          { method: "POST" }
        );
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          alert(`Failed to restart worker: ${data.error || data.message || response.statusText}`);
        }
      } catch (err) {
        alert(`Failed to restart worker: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [repoName],
  );

  // ---------------------------------------------------------------------------
  // Loading / Error states
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">🍫</div>
          <p className="text-muted-foreground text-lg">Loading {repoName}...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center bg-card p-8 rounded-lg shadow-lg border border-border">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-destructive mb-2">Connection Error</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={onNavigateHome}
          >
            ← Back to Factory Floor
          </button>
        </div>
      </div>
    );
  }

  // Separate system agents from worker agents
  const systemAgents = agents.filter((a) => a.type !== "worker");
  const activeWorkers = workers.filter(
    (w) => w.status === "starting" || w.status === "working" || w.status === "stuck",
  );
  const completedWorkers = workers
    .filter(
      (w) => w.status === "completed" || w.status === "failed" || w.status === "terminated",
    )
    .sort((a, b) => b.updatedAt - a.updatedAt); // Most recent activity first

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar with theme toggle */}
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-8">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <button
              type="button"
              onClick={onNavigateHome}
              className="hover:text-primary transition-colors flex items-center gap-1"
            >
              <span>🍫</span>
              <span>Cocoa Board</span>
            </button>
            <span>/</span>
            <span className="text-foreground font-medium">{repoName}</span>
          </div>

          {/* Title and actions */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="text-4xl">🏭</div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">{repoName}</h1>
                <p className="text-muted-foreground">Repository Dashboard</p>
              </div>
              {repo && <StatusIndicator status={repo.status} />}
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white px-5 py-2.5 rounded-lg font-semibold transition-all shadow-lg hover:shadow-xl hover:scale-105"
              onClick={onSpawnWorker}
            >
              <span>🍬</span>
              <span>Spawn Truffle</span>
            </button>
          </div>

          {/* Stats bar */}
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => document.getElementById('section-agents')?.scrollIntoView({ behavior: 'smooth' })}
              className="bg-card border border-border rounded-lg px-4 py-2 flex items-center gap-2 hover:border-primary hover:shadow-md transition-all cursor-pointer"
            >
              <span className="text-2xl">👥</span>
              <div className="text-left">
                <div className="text-sm text-muted-foreground">Agents</div>
                <div className="font-semibold text-foreground">{systemAgents.length}</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => document.getElementById('section-active-workers')?.scrollIntoView({ behavior: 'smooth' })}
              className="bg-card border border-border rounded-lg px-4 py-2 flex items-center gap-2 hover:border-primary hover:shadow-md transition-all cursor-pointer"
            >
              <span className="text-2xl">⚡</span>
              <div className="text-left">
                <div className="text-sm text-muted-foreground">Active Workers</div>
                <div className="font-semibold text-chart-2">{activeWorkers.length}</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => document.getElementById('section-completed')?.scrollIntoView({ behavior: 'smooth' })}
              className="bg-card border border-border rounded-lg px-4 py-2 flex items-center gap-2 hover:border-primary hover:shadow-md transition-all cursor-pointer"
            >
              <span className="text-2xl">✅</span>
              <div className="text-left">
                <div className="text-sm text-muted-foreground">Completed</div>
                <div className="font-semibold text-foreground">{completedWorkers.length}</div>
              </div>
            </button>
          </div>
        </header>

        {/* Main content */}
        <main className="flex flex-col gap-10">
          {/* Agent Cards Section */}
          <section id="section-agents" aria-label="Agents" className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted transition-colors"
              onClick={() => setShowAgents(!showAgents)}
            >
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <span>🤖</span> System Agents
                <span className="bg-primary/20 text-primary text-sm px-2 py-0.5 rounded-full">
                  {systemAgents.length}
                </span>
              </h2>
              <span className="text-muted-foreground text-xl">{showAgents ? "▾" : "▸"}</span>
            </button>
            {showAgents && (
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {systemAgents.map((agent) => (
                  <AgentCard key={agent.name} agent={agent} onView={handleViewAgent} />
                ))}
                {systemAgents.length === 0 && (
                  <div className="col-span-full text-center py-4 text-muted-foreground">
                    No agents configured.
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Active Workers Section */}
          <section id="section-active-workers" aria-label="Active Workers" className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted transition-colors"
              onClick={() => setShowActiveWorkers(!showActiveWorkers)}
            >
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <span>⚡</span> Active Workers
                <span className="bg-chart-2/20 text-chart-2 text-sm px-2 py-0.5 rounded-full">
                  {activeWorkers.length}
                </span>
              </h2>
              <span className="text-muted-foreground text-xl">{showActiveWorkers ? "▾" : "▸"}</span>
            </button>
            {showActiveWorkers && (
              <div className="p-4">
                {activeWorkers.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {activeWorkers.map((worker) => (
                      <WorkerCard
                        key={worker.name}
                        worker={worker}
                        onView={handleViewWorker}
                        onStop={handleStopWorker}
                        onDelete={handleDeleteWorker}
                        onRestart={handleRestartWorker}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
                    <span className="text-3xl block mb-2">😴</span>
                    No active workers. Click "Spawn Truffle" to start one!
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Completed workers (collapsible) */}
          {completedWorkers.length > 0 && (
            <CompletedWorkersSection
              workers={completedWorkers}
              onView={handleViewWorker}
              onDelete={handleDeleteWorker}
              onRestart={handleRestartWorker}
            />
          )}

          {/* Live Output Panel */}
          <section className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
            <div className="bg-muted/50 px-4 py-3 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <span>📺</span> Live Output
              </h2>
            </div>
            <div className="p-4">
              <LiveOutputPanel
                agents={agents}
                workers={workers}
                selectedAgent={selectedAgent}
                onSelectAgent={setSelectedAgent}
                lines={lines}
                onClear={clearOutput}
              />
            </div>
          </section>

          {/* PR Pipeline */}
          <section className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
            <div className="bg-muted/50 px-4 py-3 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <span>🔀</span> PR Pipeline
              </h2>
            </div>
            <div className="p-4">
              <PRPipeline prs={prs} />
            </div>
          </section>

          {/* Message Queue Inspector */}
          <section className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
            <div className="bg-muted/50 px-4 py-3 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <span>💬</span> Message Queue
              </h2>
            </div>
            <div className="p-4">
              <MessageQueueInspector messages={messages} />
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer className="mt-16 text-center text-muted-foreground text-sm">
          <p>CoCoPilot v0.1.0 · Collaborative Copilot Orchestration Platform</p>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusIndicator({ status }: { status: string }): React.ReactElement {
  const statusConfig: Record<string, { color: string; bgColor: string; label: string }> = {
    active: { color: "text-chart-2", bgColor: "bg-chart-2/20", label: "Active" },
    initializing: { color: "text-chart-1", bgColor: "bg-chart-1/20", label: "Initializing" },
    paused: { color: "text-chart-4", bgColor: "bg-chart-4/20", label: "Paused" },
    error: { color: "text-destructive", bgColor: "bg-destructive/20", label: "Error" },
  };
  const config = statusConfig[status] ?? { color: "text-muted-foreground", bgColor: "bg-muted", label: status };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full ${config.bgColor} px-3 py-1 text-sm font-medium ${config.color}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${config.color.replace('text-', 'bg-')}`} />
      {config.label}
    </span>
  );
}

interface CompletedWorkersSectionProps {
  workers: import("../types.js").WorkerState[];
  onView: (name: string) => void;
  onDelete: (name: string) => void;
  onRestart?: (name: string) => void;
}

function CompletedWorkersSection({
  workers,
  onView,
  onDelete,
  onRestart,
}: CompletedWorkersSectionProps): React.ReactElement {
  const [show, setShow] = useState(false);

  return (
    <section id="section-completed" aria-label="Completed Workers" className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted transition-colors"
        onClick={() => setShow(!show)}
      >
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <span>📋</span> Completed Workers
          <span className="bg-muted text-muted-foreground text-sm px-2 py-0.5 rounded-full">
            {workers.length}
          </span>
        </h2>
        <span className="text-muted-foreground text-xl">{show ? "▾" : "▸"}</span>
      </button>
      {show && (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {workers.map((worker) => (
            <WorkerCard key={worker.name} worker={worker} onView={onView} onDelete={onDelete} onRestart={onRestart} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default TemperingStation;
