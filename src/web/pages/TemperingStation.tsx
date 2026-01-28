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
import { AgentCard, WorkerCard } from "../components/AgentCard.js";
import { LiveOutputPanel } from "../components/LiveOutputPanel.js";
import { MessageQueueInspector } from "../components/MessageQueueInspector.js";
import { PRPipeline } from "../components/PRPipeline.js";
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
  const prs = usePRPipeline();
  const messages = useMessageQueue();
  const { socket } = useSocket();

  // Live output panel state
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const { lines, clear: clearOutput } = useAgentStream(selectedAgent);

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

  // ---------------------------------------------------------------------------
  // Loading / Error states
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream-50">
        <div className="text-center">
          <div className="text-4xl mb-2">🍫</div>
          <p className="text-stone-600">Loading {repoName}...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream-50">
        <div className="text-center">
          <p className="text-red-600">{error}</p>
          <button
            type="button"
            className="mt-2 text-sm text-caramel-600 hover:underline"
            onClick={onNavigateHome}
          >
            Back to Factory Floor
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
  const completedWorkers = workers.filter(
    (w) => w.status === "completed" || w.status === "failed" || w.status === "terminated",
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-cream-50">
      {/* Header */}
      <header className="bg-stone-800 text-white px-6 py-4 shadow-md">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-stone-300 hover:text-white transition-colors text-sm"
              onClick={onNavigateHome}
            >
              🍫 CoCoPilot
            </button>
            <span className="text-stone-500">&gt;</span>
            <h1 className="text-lg font-semibold">{repoName}</h1>
            {repo && (
              <StatusIndicator status={repo.status} />
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded bg-caramel-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-caramel-500 transition-colors"
              onClick={onSpawnWorker}
            >
              + New Truffle
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-8">
        {/* Agent Cards Section */}
        <section aria-label="Agents">
          <h2 className="text-lg font-semibold text-stone-800 mb-3">Agents</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* System agents */}
            {systemAgents.map((agent) => (
              <AgentCard key={agent.name} agent={agent} onView={handleViewAgent} />
            ))}
            {/* Active workers */}
            {activeWorkers.map((worker) => (
              <WorkerCard
                key={worker.name}
                worker={worker}
                onView={handleViewWorker}
                onStop={handleStopWorker}
              />
            ))}
          </div>

          {/* Completed workers (collapsible) */}
          {completedWorkers.length > 0 && (
            <CompletedWorkersSection
              workers={completedWorkers}
              onView={handleViewWorker}
            />
          )}
        </section>

        {/* Live Output Panel */}
        <LiveOutputPanel
          agents={agents}
          workers={workers}
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
          lines={lines}
          onClear={clearOutput}
        />

        {/* PR Pipeline */}
        <PRPipeline prs={prs} />

        {/* Message Queue Inspector */}
        <MessageQueueInspector messages={messages} />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusIndicator({ status }: { status: string }): React.ReactElement {
  const colors: Record<string, string> = {
    active: "bg-green-500",
    initializing: "bg-blue-400",
    paused: "bg-yellow-500",
    error: "bg-red-500",
  };
  const color = colors[status] ?? "bg-gray-400";

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-stone-700 px-2 py-0.5 text-xs">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden="true" />
      {status}
    </span>
  );
}

interface CompletedWorkersSectionProps {
  workers: import("../types.js").WorkerState[];
  onView: (name: string) => void;
}

function CompletedWorkersSection({
  workers,
  onView,
}: CompletedWorkersSectionProps): React.ReactElement {
  const [show, setShow] = useState(false);

  return (
    <div className="mt-4">
      <button
        type="button"
        className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
        onClick={() => setShow(!show)}
      >
        {show ? "▾" : "▸"} {workers.length} completed/stopped worker{workers.length !== 1 ? "s" : ""}
      </button>
      {show && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {workers.map((worker) => (
            <WorkerCard key={worker.name} worker={worker} onView={onView} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default TemperingStation;
