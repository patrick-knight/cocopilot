/**
 * Batch Log — activity timeline page for the Cocoa Board.
 *
 * Displays a filterable, time-grouped list of system events with:
 *  - Event type icons (rocket for spawn, merge for PRs, check for CI, message for comms)
 *  - Agent badges color-coded by role (Chocolatier=gold, Temperer=silver, Truffle=brown)
 *  - Relative date grouping (Today, Yesterday, Earlier this week)
 *  - Filter bar: event type, agent name, date range picker
 *  - Export buttons: JSON and CSV download of filtered events
 *
 * Fetches initial events from /api/v1/events and subscribes to real-time
 * updates via Socket.IO `activity:new` events (prepended to list).
 *
 * TailwindCSS cocoa theme:
 *  - Dark chocolate  #3B1F0B  (headings)
 *  - Cream           #FFF8E7  (backgrounds)
 *  - Caramel         #C68B3C  (accents)
 *  - Milk chocolate  #7B3F00  (section labels)
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type {
  ActivityEvent,
  ActivityEventType,
  ServerToClientEvents,
  ClientToServerEvents,
} from "../types.js";
import { relativeTime, formatTime } from "../helpers.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENTS = 500;

/** Human-readable labels for each event type. */
const EVENT_TYPE_LABELS: Record<ActivityEventType, string> = {
  worker_spawned: "Worker Spawned",
  worker_completed: "Worker Completed",
  worker_failed: "Worker Failed",
  pr_created: "PR Created",
  pr_merged: "PR Merged",
  ci_failed: "CI Failed",
  repo_initialized: "Repo Initialized",
  nudge_sent: "Nudge Sent",
};

/** Icon character per event type (rocket=spawn, merge=PR, check=CI, message=comms). */
const EVENT_TYPE_ICONS: Record<ActivityEventType, string> = {
  worker_spawned: "\u{1F680}",    // 🚀 rocket
  worker_completed: "\u2713",      // ✓ check
  worker_failed: "\u2717",         // ✗ cross
  pr_created: "\u21E1",            // ⇡ up arrow
  pr_merged: "\u27F2",             // ⟲ merge
  ci_failed: "\u0021",             // ! warning
  repo_initialized: "\u2B50",      // ⭐ star
  nudge_sent: "\u2709",            // ✉ message
};

/** Tailwind classes for event type icon backgrounds. */
const EVENT_ICON_STYLES: Record<ActivityEventType, string> = {
  worker_spawned: "bg-blue-100 text-blue-700",
  worker_completed: "bg-green-100 text-green-700",
  worker_failed: "bg-red-100 text-red-700",
  pr_created: "bg-purple-100 text-purple-700",
  pr_merged: "bg-emerald-100 text-emerald-700",
  ci_failed: "bg-red-100 text-red-700",
  repo_initialized: "bg-amber-100 text-amber-700",
  nudge_sent: "bg-[#C68B3C]/10 text-[#C68B3C]",
};

/** Agent badge color mapping (by role keyword in agent name). */
const AGENT_BADGE_STYLES: Record<string, { bg: string; text: string }> = {
  chocolatier: { bg: "bg-amber-100", text: "text-amber-800" },
  supervisor: { bg: "bg-amber-100", text: "text-amber-800" },
  temperer: { bg: "bg-gray-200", text: "text-gray-600" },
  "merge-queue": { bg: "bg-gray-200", text: "text-gray-600" },
  enrober: { bg: "bg-yellow-100", text: "text-yellow-700" },
  "pr-shepherd": { bg: "bg-yellow-100", text: "text-yellow-700" },
  truffle: { bg: "bg-[#7B3F00]/10", text: "text-[#7B3F00]" },
  worker: { bg: "bg-[#7B3F00]/10", text: "text-[#7B3F00]" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Classify an ISO timestamp into a relative day group label. */
function dateGroup(iso: string): string {
  const now = new Date();
  const date = new Date(iso);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - todayStart.getDay());

  if (date >= todayStart) return "Today";
  if (date >= yesterdayStart) return "Yesterday";
  if (date >= weekStart) return "Earlier this week";
  return "Older";
}

/** Look up badge styles for an agent name by matching known role keywords. */
function agentBadgeStyle(agent: string): { bg: string; text: string } {
  const lower = agent.toLowerCase();
  for (const [key, style] of Object.entries(AGENT_BADGE_STYLES)) {
    if (lower.includes(key)) return style;
  }
  return { bg: "bg-stone-100", text: "text-stone-600" };
}

/** Convert an array of events to a CSV string. */
function eventsToCSV(events: ActivityEvent[]): string {
  const headers = [
    "id",
    "type",
    "repository",
    "description",
    "timestamp",
    "agent",
    "prNumber",
    "workerName",
  ];
  const rows = events.map((e) =>
    headers
      .map((h) => {
        const val = e[h as keyof ActivityEvent];
        if (val === undefined || val === null) return "";
        const str = String(val);
        // Escape CSV fields that contain commas, quotes, or newlines
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      })
      .join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}

/** Trigger a browser file download with the given content. */
function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface FilterBarProps {
  eventTypes: ActivityEventType[];
  agentNames: string[];
  selectedType: string;
  selectedAgent: string;
  dateFrom: string;
  dateTo: string;
  onTypeChange: (v: string) => void;
  onAgentChange: (v: string) => void;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
}

/** Filter bar with dropdowns for event type, agent name, and date range. */
function FilterBar({
  eventTypes,
  agentNames,
  selectedType,
  selectedAgent,
  dateFrom,
  dateTo,
  onTypeChange,
  onAgentChange,
  onDateFromChange,
  onDateToChange,
}: FilterBarProps) {
  const controlClass =
    "rounded border border-[#C68B3C]/30 bg-white px-3 py-1.5 text-sm text-[#3B1F0B] focus:border-[#C68B3C] focus:outline-none focus:ring-1 focus:ring-[#C68B3C]";

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Event type */}
      <select
        value={selectedType}
        onChange={(e) => onTypeChange(e.target.value)}
        className={controlClass}
      >
        <option value="">All Events</option>
        {eventTypes.map((t) => (
          <option key={t} value={t}>
            {EVENT_TYPE_LABELS[t]}
          </option>
        ))}
      </select>

      {/* Agent name */}
      <select
        value={selectedAgent}
        onChange={(e) => onAgentChange(e.target.value)}
        className={controlClass}
      >
        <option value="">All Agents</option>
        {agentNames.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      {/* Date range: from */}
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-gray-500">From</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => onDateFromChange(e.target.value)}
          className={controlClass}
        />
      </div>

      {/* Date range: to */}
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-gray-500">To</label>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => onDateToChange(e.target.value)}
          className={controlClass}
        />
      </div>
    </div>
  );
}

/** A single event row in the activity timeline. */
function EventRow({ event }: { event: ActivityEvent }) {
  const iconStyle =
    EVENT_ICON_STYLES[event.type] ?? "bg-gray-100 text-gray-600";
  const badge = event.agent ? agentBadgeStyle(event.agent) : null;

  return (
    <div className="flex items-start gap-3 rounded-lg bg-white px-4 py-3 shadow-sm transition hover:shadow-md">
      {/* Event type icon */}
      <span
        className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${iconStyle}`}
        aria-hidden="true"
        title={EVENT_TYPE_LABELS[event.type]}
      >
        {EVENT_TYPE_ICONS[event.type]}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[#3B1F0B]">
            {EVENT_TYPE_LABELS[event.type]}
          </span>
          {event.agent && badge && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}
            >
              {event.agent}
            </span>
          )}
          <span className="text-xs text-gray-400">{event.repository}</span>
        </div>
        <p className="mt-0.5 truncate text-sm text-gray-600">
          {event.description}
        </p>
      </div>

      {/* Timestamp */}
      <div className="flex-shrink-0 text-right">
        <time className="whitespace-nowrap text-xs text-gray-400">
          {formatTime(event.timestamp)}
        </time>
        <div className="text-xs text-gray-300">
          {relativeTime(event.timestamp)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Batch Log page — full activity timeline.
 *
 * Fetches from /api/v1/events on mount and subscribes to `activity:new`
 * Socket.IO events for real-time prepending of new events.
 */
export function BatchLog(): React.ReactElement {
  // ---- State ----
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filterType, setFilterType] = useState("");
  const [filterAgent, setFilterAgent] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const socketRef = useRef<Socket<
    ServerToClientEvents,
    ClientToServerEvents
  > | null>(null);

  // ---- Initial data fetch ----
  useEffect(() => {
    let cancelled = false;

    async function fetchEvents() {
      try {
        const res = await fetch("/api/v1/events");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ActivityEvent[] = await res.json();
        if (!cancelled) {
          setEvents(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load events",
          );
          setLoading(false);
        }
      }
    }

    fetchEvents();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Socket.IO real-time updates ----
  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
      window.location.origin,
      { transports: ["websocket", "polling"] },
    );
    socketRef.current = socket;

    socket.on("activity:new", (event: ActivityEvent) => {
      setEvents((prev) => {
        const next = [event, ...prev];
        return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // ---- Derived / memoized data ----

  const availableTypes = useMemo(() => {
    const set = new Set(events.map((e) => e.type));
    return Array.from(set).sort() as ActivityEventType[];
  }, [events]);

  const availableAgents = useMemo(() => {
    const set = new Set(
      events.filter((e) => e.agent).map((e) => e.agent as string),
    );
    return Array.from(set).sort();
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (filterType && e.type !== filterType) return false;
      if (filterAgent && e.agent !== filterAgent) return false;
      if (dateFrom) {
        const from = new Date(dateFrom);
        if (new Date(e.timestamp) < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        // Include the entire "to" day
        to.setDate(to.getDate() + 1);
        if (new Date(e.timestamp) >= to) return false;
      }
      return true;
    });
  }, [events, filterType, filterAgent, dateFrom, dateTo]);

  /** Group filtered events by relative date (Today / Yesterday / Earlier this week / Older). */
  const groupedEvents = useMemo(() => {
    const groupOrder = ["Today", "Yesterday", "Earlier this week", "Older"];
    const map = new Map<string, ActivityEvent[]>();

    for (const e of filteredEvents) {
      const group = dateGroup(e.timestamp);
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(e);
    }

    const groups: { label: string; events: ActivityEvent[] }[] = [];
    for (const label of groupOrder) {
      const evts = map.get(label);
      if (evts && evts.length > 0) {
        groups.push({ label, events: evts });
      }
    }
    return groups;
  }, [filteredEvents]);

  // ---- Export handlers ----

  const handleExportJSON = useCallback(() => {
    const json = JSON.stringify(filteredEvents, null, 2);
    downloadFile(json, "batch-log.json", "application/json");
  }, [filteredEvents]);

  const handleExportCSV = useCallback(() => {
    const csv = eventsToCSV(filteredEvents);
    downloadFile(csv, "batch-log.csv", "text/csv");
  }, [filteredEvents]);

  // ---- Render ----

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <span className="text-sm text-gray-400">Loading events...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            Failed to load events: {error}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header with title + export buttons */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#3B1F0B]">Batch Log</h1>
          <p className="mt-1 text-sm text-gray-500">
            Activity timeline &mdash; {filteredEvents.length} event
            {filteredEvents.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Export buttons (top-right) */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExportJSON}
            className="rounded border border-[#C68B3C] px-3 py-1.5 text-sm font-medium text-[#C68B3C] transition hover:bg-[#C68B3C]/10"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={handleExportCSV}
            className="rounded border border-[#C68B3C] px-3 py-1.5 text-sm font-medium text-[#C68B3C] transition hover:bg-[#C68B3C]/10"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mb-6 rounded-lg border border-[#C68B3C]/20 bg-white p-4 shadow-sm">
        <FilterBar
          eventTypes={availableTypes}
          agentNames={availableAgents}
          selectedType={filterType}
          selectedAgent={filterAgent}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onTypeChange={setFilterType}
          onAgentChange={setFilterAgent}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
        />
      </div>

      {/* Event list grouped by date */}
      {filteredEvents.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-400">
            {events.length === 0
              ? "No activity events recorded yet."
              : "No events match the current filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedEvents.map((group) => (
            <section key={group.label}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#7B3F00]">
                {group.label}
              </h3>
              <div className="space-y-2">
                {group.events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default BatchLog;
