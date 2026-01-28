/**
 * Factory Floor — the landing page of the Cocoa Board (web dashboard).
 *
 * Displays:
 *  - Repository cards with health indicators, worker counts, pending PRs,
 *    and last merge timestamps
 *  - A chronological activity feed of system events
 *  - Quick-action buttons: Initialize repo, spawn worker, view logs
 *
 * Uses Socket.IO for real-time updates and TailwindCSS with the cocoa theme:
 *  - Dark chocolate  #3B1F0B  (headers)
 *  - Cream           #FFF8E7  (backgrounds)
 *  - Caramel         #C68B3C  (accents)
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";
import type {
  RepositorySummary,
  ActivityEvent,
  SystemStatus,
  ServerToClientEvents,
  ClientToServerEvents,
} from "../types.js";
import { relativeTime, formatTime, healthBg, activityIcon } from "../helpers.js";

// Maximum number of activity events to display at once.
const MAX_ACTIVITY_EVENTS = 50;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface RepoCardProps {
  repo: RepositorySummary;
  onView: (repoId: string) => void;
  onSpawnWorker: (repoId: string) => void;
}

/** A single repository card on the Factory Floor. */
function RepoCard({ repo, onView, onSpawnWorker }: RepoCardProps) {
  const workerLabel =
    repo.activeWorkerCount === 1 ? "1 worker active" : `${repo.activeWorkerCount} workers active`;
  const stuckLabel =
    repo.stuckWorkerCount > 0
      ? ` (${repo.stuckWorkerCount} stuck)`
      : "";
  const prLabel =
    repo.pendingPRs === 1 ? "1 PR pending" : `${repo.pendingPRs} PRs pending`;
  const mergeLabel = repo.lastMerge
    ? `Last merge: ${relativeTime(repo.lastMerge)}`
    : "No merges yet";

  return (
    <div className="rounded-lg border border-[#C68B3C]/30 bg-white p-5 shadow-sm transition hover:shadow-md">
      {/* Header row: health dot + name */}
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`inline-block h-3 w-3 rounded-full ${healthBg(repo.health)}`}
          title={repo.health}
          data-testid={`health-${repo.id}`}
        />
        <h3 className="text-lg font-semibold text-[#3B1F0B]">{repo.name}</h3>
        {repo.status === "initializing" && (
          <span className="ml-auto text-xs text-gray-400">initializing...</span>
        )}
      </div>

      {/* Stats */}
      <ul className="mb-4 space-y-1 text-sm text-gray-600">
        <li>
          {workerLabel}
          {stuckLabel && (
            <span className="text-yellow-600">{stuckLabel}</span>
          )}
        </li>
        <li>{prLabel}</li>
        <li>{mergeLabel}</li>
      </ul>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onView(repo.id)}
          className="rounded bg-[#3B1F0B] px-3 py-1.5 text-sm font-medium text-[#FFF8E7] transition hover:bg-[#3B1F0B]/80"
        >
          View
        </button>
        <button
          type="button"
          onClick={() => onSpawnWorker(repo.id)}
          className="rounded border border-[#C68B3C] px-3 py-1.5 text-sm font-medium text-[#C68B3C] transition hover:bg-[#C68B3C]/10"
        >
          + Worker
        </button>
      </div>
    </div>
  );
}

interface InitRepoFormProps {
  onSubmit: (url: string, name?: string) => void;
  onCancel: () => void;
  submitting: boolean;
  error: string | null;
}

/** Inline form for initializing a new repository. */
function InitRepoForm({ onSubmit, onCancel, submitting, error }: InitRepoFormProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onSubmit(url.trim(), name.trim() || undefined);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-[#C68B3C]/40 bg-white p-4 shadow-sm"
      data-testid="init-repo-form"
    >
      <h3 className="mb-3 text-sm font-semibold text-[#3B1F0B]">
        Initialize New Repository
      </h3>
      <div className="mb-2">
        <input
          type="text"
          placeholder="https://github.com/org/repo"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#C68B3C] focus:outline-none focus:ring-1 focus:ring-[#C68B3C]"
        />
      </div>
      <div className="mb-3">
        <input
          type="text"
          placeholder="Custom name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#C68B3C] focus:outline-none focus:ring-1 focus:ring-[#C68B3C]"
        />
      </div>
      {error && (
        <p className="mb-2 text-xs text-red-600" data-testid="init-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !url.trim()}
          className="rounded bg-[#C68B3C] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[#C68B3C]/80 disabled:opacity-50"
        >
          {submitting ? "Initializing..." : "Initialize"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-4 py-1.5 text-sm text-gray-500 transition hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface SpawnWorkerFormProps {
  repoId: string;
  repoName: string;
  onSubmit: (repoId: string, task: string) => void;
  onCancel: () => void;
  submitting: boolean;
  error: string | null;
}

/** Inline form for spawning a new worker. */
function SpawnWorkerForm({
  repoId,
  repoName,
  onSubmit,
  onCancel,
  submitting,
  error,
}: SpawnWorkerFormProps) {
  const [task, setTask] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) return;
    onSubmit(repoId, task.trim());
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-[#C68B3C]/40 bg-white p-4 shadow-sm"
      data-testid="spawn-worker-form"
    >
      <h3 className="mb-3 text-sm font-semibold text-[#3B1F0B]">
        Spawn Worker for {repoName}
      </h3>
      <div className="mb-3">
        <textarea
          placeholder="Describe the task for the new worker..."
          value={task}
          onChange={(e) => setTask(e.target.value)}
          required
          rows={3}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#C68B3C] focus:outline-none focus:ring-1 focus:ring-[#C68B3C]"
        />
      </div>
      {error && (
        <p className="mb-2 text-xs text-red-600" data-testid="spawn-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !task.trim()}
          className="rounded bg-[#C68B3C] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[#C68B3C]/80 disabled:opacity-50"
        >
          {submitting ? "Spawning..." : "Spawn"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-4 py-1.5 text-sm text-gray-500 transition hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface FactoryFloorProps {
  /** Socket.IO server URL. Defaults to window.location.origin. */
  serverUrl?: string;
  /** Callback when user clicks "View" on a repository card. */
  onNavigateToRepo?: (repoId: string) => void;
}

/**
 * Factory Floor — the CoCoPilot home page.
 *
 * Connects to the Socket.IO server for real-time repository and activity
 * updates. Renders repository cards, an activity feed, and quick-action
 * controls for initializing repositories and spawning workers.
 */
export function FactoryFloor({ serverUrl, onNavigateToRepo }: FactoryFloorProps) {
  // ---- State ----
  const [repos, setRepos] = useState<RepositorySummary[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);

  // Init repo form
  const [showInitForm, setShowInitForm] = useState(false);
  const [initSubmitting, setInitSubmitting] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Spawn worker form
  const [spawnTarget, setSpawnTarget] = useState<{
    repoId: string;
    repoName: string;
  } | null>(null);
  const [spawnSubmitting, setSpawnSubmitting] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);

  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);

  // ---- Socket.IO connection ----
  useEffect(() => {
    const url = serverUrl ?? window.location.origin;
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(url, {
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    // Real-time repo updates
    socket.on("repo:updated", (repo) => {
      setRepos((prev) =>
        prev.map((r) => (r.id === repo.id ? repo : r)),
      );
    });

    socket.on("repo:added", (repo) => {
      setRepos((prev) => {
        if (prev.some((r) => r.id === repo.id)) return prev;
        return [...prev, repo];
      });
    });

    socket.on("repo:removed", (repoId) => {
      setRepos((prev) => prev.filter((r) => r.id !== repoId));
    });

    // Real-time activity events
    socket.on("activity:new", (event) => {
      setActivities((prev) => {
        const next = [event, ...prev];
        return next.length > MAX_ACTIVITY_EVENTS
          ? next.slice(0, MAX_ACTIVITY_EVENTS)
          : next;
      });
    });

    // System status updates
    socket.on("system:status", (status) => {
      setSystemStatus(status);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverUrl]);

  // ---- Actions ----

  const handleView = useCallback(
    (repoId: string) => {
      onNavigateToRepo?.(repoId);
    },
    [onNavigateToRepo],
  );

  const handleOpenSpawnForm = useCallback(
    (repoId: string) => {
      const repo = repos.find((r) => r.id === repoId);
      if (repo) {
        setSpawnTarget({ repoId: repo.id, repoName: repo.name });
        setSpawnError(null);
      }
    },
    [repos],
  );

  const handleInitRepo = useCallback(
    (url: string, name?: string) => {
      const socket = socketRef.current;
      if (!socket) return;

      setInitSubmitting(true);
      setInitError(null);

      socket.emit("repo:init", { url, name }, (result) => {
        setInitSubmitting(false);
        if (result.success) {
          setShowInitForm(false);
        } else {
          setInitError(result.error ?? "Failed to initialize repository");
        }
      });
    },
    [],
  );

  const handleSpawnWorker = useCallback(
    (repoId: string, task: string) => {
      const socket = socketRef.current;
      if (!socket) return;

      setSpawnSubmitting(true);
      setSpawnError(null);

      socket.emit("worker:spawn", { repoId, task }, (result) => {
        setSpawnSubmitting(false);
        if (result.success) {
          setSpawnTarget(null);
        } else {
          setSpawnError(result.error ?? "Failed to spawn worker");
        }
      });
    },
    [],
  );

  // ---- Render ----

  /** Format uptime seconds to human-readable string. */
  const formatUptime = (seconds: number | null): string => {
    if (seconds === null) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div className="px-6 py-8">
      {/* Connection status indicator */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#3B1F0B]">Factory Floor</h1>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              connected ? "bg-green-400" : "bg-red-400"
            }`}
            title={connected ? "Connected" : "Disconnected"}
          />
          <span className="text-sm text-gray-500">
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* System Resource Utilization */}
      {systemStatus && (
        <section className="mb-8">
          <div className="rounded-lg border border-[#C68B3C]/30 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-[#3B1F0B]">
              System Status
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-center gap-3">
                <span
                  className={`inline-block h-3 w-3 rounded-full ${
                    systemStatus.daemonRunning ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <div>
                  <p className="text-xs text-gray-500">Daemon</p>
                  <p className="text-sm font-medium text-[#3B1F0B]">
                    {systemStatus.daemonRunning ? "Running" : "Stopped"}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500">Uptime</p>
                <p className="text-sm font-medium text-[#3B1F0B]">
                  {formatUptime(systemStatus.uptime)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Containers</p>
                <p className="text-sm font-medium text-[#3B1F0B]">
                  {systemStatus.totalContainers} running
                </p>
              </div>
              <div className="flex gap-6">
                {systemStatus.memoryUsage && (
                  <div>
                    <p className="text-xs text-gray-500">Memory</p>
                    <p className="text-sm font-medium text-[#3B1F0B]">
                      {systemStatus.memoryUsage}
                    </p>
                  </div>
                )}
                {systemStatus.cpuUsage && (
                  <div>
                    <p className="text-xs text-gray-500">CPU</p>
                    <p className="text-sm font-medium text-[#3B1F0B]">
                      {systemStatus.cpuUsage}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="mx-auto max-w-7xl">
        {/* Initialize repo action */}
        <section className="mb-8">
          {showInitForm ? (
            <InitRepoForm
              onSubmit={handleInitRepo}
              onCancel={() => {
                setShowInitForm(false);
                setInitError(null);
              }}
              submitting={initSubmitting}
              error={initError}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowInitForm(true)}
              className="w-full rounded-lg border-2 border-dashed border-[#C68B3C]/40 px-4 py-3 text-sm font-medium text-[#C68B3C] transition hover:border-[#C68B3C] hover:bg-[#C68B3C]/5"
              data-testid="init-repo-btn"
            >
              + Initialize New Repository
            </button>
          )}
        </section>

        {/* Spawn worker form (overlay) */}
        {spawnTarget && (
          <section className="mb-8">
            <SpawnWorkerForm
              repoId={spawnTarget.repoId}
              repoName={spawnTarget.repoName}
              onSubmit={handleSpawnWorker}
              onCancel={() => {
                setSpawnTarget(null);
                setSpawnError(null);
              }}
              submitting={spawnSubmitting}
              error={spawnError}
            />
          </section>
        )}

        {/* Active Repositories */}
        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold text-[#3B1F0B]">
            Active Repositories
          </h2>

          {repos.length === 0 ? (
            <p
              className="text-sm text-gray-400"
              data-testid="no-repos"
            >
              No repositories tracked yet. Initialize one to get started.
            </p>
          ) : (
            <div
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="repo-grid"
            >
              {repos.map((repo) => (
                <RepoCard
                  key={repo.id}
                  repo={repo}
                  onView={handleView}
                  onSpawnWorker={handleOpenSpawnForm}
                />
              ))}
            </div>
          )}
        </section>

        {/* Recent Activity */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-[#3B1F0B]">
            Recent Activity
          </h2>

          {activities.length === 0 ? (
            <p
              className="text-sm text-gray-400"
              data-testid="no-activity"
            >
              No recent activity.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="activity-feed">
              {activities.map((event) => (
                <li
                  key={event.id}
                  className="flex items-start gap-3 rounded-md bg-white px-4 py-2.5 text-sm shadow-sm"
                >
                  <span
                    className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#3B1F0B]/10 text-xs font-bold text-[#3B1F0B]"
                    aria-hidden="true"
                  >
                    {activityIcon(event.type)}
                  </span>
                  <span className="flex-1 text-gray-700">
                    {event.description}
                    <span className="ml-2 text-xs text-gray-400">
                      ({event.repository})
                    </span>
                  </span>
                  <time className="flex-shrink-0 text-xs text-gray-400">
                    {formatTime(event.timestamp)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export default FactoryFloor;
