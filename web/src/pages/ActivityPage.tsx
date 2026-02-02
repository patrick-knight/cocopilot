/**
 * Activity Timeline / Batch Log Page
 *
 * Displays a chronological timeline of all activity events across repositories.
 * Supports filtering by type, repository, and date range.
 */

import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../../../src/web/components/ThemeToggle.js";

interface ActivityEvent {
  id: string;
  type: string;
  repository: string;
  description: string;
  timestamp: string;
  agent?: string;
  prNumber?: number;
  workerName?: string;
}

const EVENT_ICONS: Record<string, string> = {
  worker_spawned: "🍫",
  worker_completed: "✅",
  worker_failed: "❌",
  pr_created: "🔀",
  pr_merged: "🎉",
  ci_failed: "🔴",
  repo_initialized: "📦",
  nudge_sent: "👋",
};

const EVENT_COLORS: Record<string, string> = {
  worker_spawned: "bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700",
  worker_completed: "bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700",
  worker_failed: "bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700",
  pr_created: "bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700",
  pr_merged: "bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700",
  ci_failed: "bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700",
  repo_initialized: "bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700",
  nudge_sent: "bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700",
};

export function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [repoFilter, setRepoFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Export format
  const [exportFormat, setExportFormat] = useState<"json" | "csv">("json");

  useEffect(() => {
    const params = new URLSearchParams();
    if (typeFilter) params.set("type", typeFilter);
    if (repoFilter) params.set("repository", repoFilter);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);

    fetch(`/api/v1/activity?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setEvents(Array.isArray(data) ? data : data.events || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [typeFilter, repoFilter, dateFrom, dateTo]);

  const uniqueTypes = useMemo(() => {
    const types = new Set(events.map((e) => e.type));
    return Array.from(types).sort();
  }, [events]);

  const uniqueRepos = useMemo(() => {
    const repos = new Set(events.map((e) => e.repository));
    return Array.from(repos).sort();
  }, [events]);

  const handleExport = () => {
    const params = new URLSearchParams();
    params.set("format", exportFormat);
    if (typeFilter) params.set("type", typeFilter);
    if (repoFilter) params.set("repository", repoFilter);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);

    window.open(`/api/v1/activity/export?${params}`, "_blank");
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatRelativeTime = (timestamp: string) => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-2xl font-bold">
              🍫 CoCoPilot
            </Link>
            <span className="text-muted-foreground">/ Activity Timeline</span>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Link
              to="/"
              className="px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-md"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-6xl mx-auto">
        {/* Filters */}
        <div className="bg-card border border-border rounded-lg p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium mb-1">Event Type</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
              >
                <option value="">All Types</option>
                {uniqueTypes.map((type) => (
                  <option key={type} value={type}>
                    {EVENT_ICONS[type] || "📌"} {type.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Repository</label>
              <select
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
              >
                <option value="">All Repositories</option>
                {uniqueRepos.map((repo) => (
                  <option key={repo} value={repo}>
                    {repo}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
              />
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-2">
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as "json" | "csv")}
                className="px-2 py-2 border border-border rounded-md bg-background text-foreground text-sm"
              >
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
              </select>
              <button
                onClick={handleExport}
                className="px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90"
              >
                📥 Export
              </button>
            </div>
          </div>
        </div>

        {/* Timeline */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
            <p className="mt-2 text-muted-foreground">Loading activity...</p>
          </div>
        ) : error ? (
          <div className="bg-destructive/10 border border-destructive rounded-lg p-4 text-center">
            <p className="text-destructive">Error: {error}</p>
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-4xl mb-4">📭</p>
            <p>No activity events found.</p>
            <p className="text-sm mt-2">
              Events will appear here when workers spawn, complete tasks, or create PRs.
            </p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-border" />

            {/* Events */}
            <div className="space-y-4">
              {events.map((event) => (
                <div key={event.id} className="relative flex gap-4">
                  {/* Timeline dot */}
                  <div className="relative z-10 w-16 flex-shrink-0 flex items-start justify-center pt-2">
                    <span className="text-2xl">{EVENT_ICONS[event.type] || "📌"}</span>
                  </div>

                  {/* Event card */}
                  <div
                    className={`flex-1 border rounded-lg p-4 ${
                      EVENT_COLORS[event.type] || "bg-muted border-border"
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-xs font-medium uppercase tracking-wide opacity-70">
                          {event.type.replace(/_/g, " ")}
                        </span>
                        <p className="font-medium mt-1">{event.description}</p>
                        <div className="flex gap-3 mt-2 text-sm text-muted-foreground">
                          <Link
                            to={`/repos/${event.repository}`}
                            className="hover:underline"
                          >
                            📦 {event.repository}
                          </Link>
                          {event.workerName && (
                            <Link
                              to={`/repos/${event.repository}/workers/${event.workerName}`}
                              className="hover:underline"
                            >
                              🍫 {event.workerName}
                            </Link>
                          )}
                          {event.prNumber && (
                            <span>🔀 PR #{event.prNumber}</span>
                          )}
                          {event.agent && <span>🤖 {event.agent}</span>}
                        </div>
                      </div>
                      <div className="text-right text-sm text-muted-foreground">
                        <div>{formatRelativeTime(event.timestamp)}</div>
                        <div className="text-xs opacity-70">{formatTime(event.timestamp)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default ActivityPage;
