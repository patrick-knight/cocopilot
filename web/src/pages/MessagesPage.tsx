/**
 * Message Queue Inspector Page
 *
 * Displays inter-agent message traffic with real-time streaming,
 * filtering, and expandable payload inspection.
 */

import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../../../src/web/components/ThemeToggle.js";

interface Message {
  id: string;
  type: string;
  from: string;
  to: string;
  payload: unknown;
  priority?: number | string;
  timestamp: string;
  ack_required?: boolean;
  ack_received?: boolean;
}

const MESSAGE_ICONS: Record<string, string> = {
  TASK_ASSIGNED: "📋",
  TASK_COMPLETE: "✅",
  TASK_FAILED: "❌",
  STATUS_REQUEST: "❓",
  STATUS_RESPONSE: "💬",
  NUDGE: "👋",
  PR_CREATED: "🔀",
  PR_MERGED: "🎉",
  CI_FAILED: "🔴",
  SPAWN_FIXUP: "🔧",
  BROADCAST: "📢",
  REVIEW_COMPLETE: "📝",
  SPAWN_WORKER: "🍫",
  SECURITY_REVIEW_REQUEST: "🔒",
  SECURITY_REVIEW_PASSED: "🛡️",
  SECURITY_REVIEW_FAILED: "🚨",
  WORKER_ACTIVITY: "⚙️",
  CODE_REVIEW_REQUEST: "🔍",
  README_UPDATED: "📄",
  README_UPDATE_REQUEST: "📝",
  WORKER_CONTROL: "🎛️",
};

const MESSAGE_COLORS: Record<string, string> = {
  TASK_ASSIGNED: "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300",
  TASK_COMPLETE: "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300",
  TASK_FAILED: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300",
  PR_CREATED: "bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300",
  PR_MERGED: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300",
  CI_FAILED: "bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300",
  NUDGE: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300",
  BROADCAST: "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300",
  SPAWN_WORKER: "bg-pink-100 dark:bg-pink-900/30 text-pink-800 dark:text-pink-300",
  SECURITY_REVIEW_FAILED: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300",
};

const PRIORITY_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  high: { label: "High", icon: "⚡", color: "text-red-600 dark:text-red-400" },
  "1": { label: "High", icon: "⚡", color: "text-red-600 dark:text-red-400" },
  normal: { label: "Normal", icon: "●", color: "text-blue-600 dark:text-blue-400" },
  "2": { label: "Normal", icon: "●", color: "text-blue-600 dark:text-blue-400" },
  low: { label: "Low", icon: "○", color: "text-muted-foreground" },
  "3": { label: "Low", icon: "○", color: "text-muted-foreground" },
};

function getPriorityInfo(priority: number | string | undefined) {
  if (priority === undefined || priority === null) {
    return { label: "Normal", icon: "●", color: "text-blue-600 dark:text-blue-400" };
  }
  return PRIORITY_LABELS[String(priority)] ?? { label: String(priority), icon: "●", color: "text-muted-foreground" };
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleString();
}

function formatRelativeTime(timestamp: string) {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function payloadPreview(payload: unknown): string {
  if (payload === null || payload === undefined) return "—";
  const str = typeof payload === "string" ? payload : JSON.stringify(payload);
  return str.length > 80 ? str.slice(0, 80) + "…" : str;
}

export function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [repoFilter, setRepoFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Real-time
  const [streaming, setStreaming] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const tableEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch initial messages
  useEffect(() => {
    const params = new URLSearchParams();
    if (repoFilter) params.set("repo", repoFilter);
    params.set("limit", "100");

    fetch(`/api/v1/messages/recent?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setMessages(data.messages || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [repoFilter]);

  // SSE streaming
  useEffect(() => {
    if (!streaming) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return;
    }

    const params = new URLSearchParams();
    if (repoFilter) params.set("repo", repoFilter);

    const es = new EventSource(`/api/v1/messages/stream?${params}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const msg: Message = JSON.parse(event.data);
        setMessages((prev) => [...prev, msg]);
      } catch {
        // ignore malformed
      }
    };

    es.onerror = () => {
      // EventSource will auto-reconnect
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [streaming, repoFilter]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && streaming) {
      tableEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, autoScroll, streaming]);

  // Derived data
  const uniqueTypes = useMemo(() => {
    const types = new Set(messages.map((m) => m.type));
    return Array.from(types).sort();
  }, [messages]);

  const uniqueFromAgents = useMemo(() => {
    const agents = new Set(messages.map((m) => m.from));
    return Array.from(agents).sort();
  }, [messages]);

  const uniqueToAgents = useMemo(() => {
    const agents = new Set(messages.map((m) => m.to));
    return Array.from(agents).sort();
  }, [messages]);

  const filteredMessages = useMemo(() => {
    return messages.filter((m) => {
      if (typeFilter && m.type !== typeFilter) return false;
      if (fromFilter && m.from !== fromFilter) return false;
      if (toFilter && m.to !== toFilter) return false;
      if (priorityFilter && String(m.priority ?? "normal") !== priorityFilter) return false;
      if (dateFrom && m.timestamp < new Date(dateFrom).toISOString()) return false;
      if (dateTo && m.timestamp > new Date(dateTo + "T23:59:59").toISOString()) return false;
      return true;
    });
  }, [messages, typeFilter, fromFilter, toFilter, priorityFilter, dateFrom, dateTo]);

  const stats = useMemo(() => {
    const byType: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const m of filteredMessages) {
      byType[m.type] = (byType[m.type] || 0) + 1;
      const pKey = String(m.priority ?? "normal");
      byPriority[pKey] = (byPriority[pKey] || 0) + 1;
    }
    return { total: filteredMessages.length, byType, byPriority };
  }, [filteredMessages]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-2xl font-bold">
              🍫 CoCoPilot
            </Link>
            <span className="text-muted-foreground">/ Message Queue Inspector</span>
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

      <main className="p-6 max-w-7xl mx-auto">
        {/* Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-card border border-border rounded-lg p-4 text-center">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-sm text-muted-foreground">Total Messages</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 text-center">
            <div className="text-2xl font-bold">{Object.keys(stats.byType).length}</div>
            <div className="text-sm text-muted-foreground">Message Types</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 text-center">
            <div className="text-2xl font-bold">{stats.byPriority["high"] || stats.byPriority["1"] || 0}</div>
            <div className="text-sm text-muted-foreground">⚡ High Priority</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${streaming ? "bg-green-500 animate-pulse" : "bg-muted-foreground"}`} />
              <span className="text-2xl font-bold">{streaming ? "Live" : "Paused"}</span>
            </div>
            <div className="text-sm text-muted-foreground">Stream Status</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-lg p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium mb-1">Message Type</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
              >
                <option value="">All Types</option>
                {uniqueTypes.map((type) => (
                  <option key={type} value={type}>
                    {MESSAGE_ICONS[type] || "📨"} {type}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">From Agent</label>
              <select
                value={fromFilter}
                onChange={(e) => setFromFilter(e.target.value)}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
              >
                <option value="">All Sources</option>
                {uniqueFromAgents.map((agent) => (
                  <option key={agent} value={agent}>{agent}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">To Agent</label>
              <select
                value={toFilter}
                onChange={(e) => setToFilter(e.target.value)}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
              >
                <option value="">All Targets</option>
                {uniqueToAgents.map((agent) => (
                  <option key={agent} value={agent}>{agent}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Repository</label>
              <input
                type="text"
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
                placeholder="Filter by repo…"
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Priority</label>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
              >
                <option value="">All Priorities</option>
                <option value="high">⚡ High</option>
                <option value="normal">● Normal</option>
                <option value="low">○ Low</option>
                <option value="1">1 (High)</option>
                <option value="2">2 (Normal)</option>
                <option value="3">3 (Low)</option>
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

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="rounded"
                />
                Auto-scroll
              </label>
              <button
                onClick={() => setStreaming((s) => !s)}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  streaming
                    ? "bg-red-600 hover:bg-red-700 text-white"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                {streaming ? "⏸ Stop Stream" : "▶ Start Stream"}
              </button>
            </div>
          </div>
        </div>

        {/* Messages Table */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
            <p className="mt-2 text-muted-foreground">Loading messages...</p>
          </div>
        ) : error ? (
          <div className="bg-destructive/10 border border-destructive rounded-lg p-4 text-center">
            <p className="text-destructive">Error: {error}</p>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-4xl mb-4">📭</p>
            <p>No messages found.</p>
            <p className="text-sm mt-2">
              Messages will appear here as agents communicate. Try starting the stream for real-time updates.
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium">Time</th>
                    <th className="text-left px-4 py-3 font-medium">Type</th>
                    <th className="text-left px-4 py-3 font-medium">From → To</th>
                    <th className="text-left px-4 py-3 font-medium">Priority</th>
                    <th className="text-left px-4 py-3 font-medium">ACK</th>
                    <th className="text-left px-4 py-3 font-medium">Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMessages.map((msg) => {
                    const prioInfo = getPriorityInfo(msg.priority);
                    const isExpanded = expandedId === msg.id;
                    return (
                      <React.Fragment key={msg.id}>
                        <tr
                          className="border-b border-border hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => toggleExpand(msg.id)}
                        >
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="text-xs">{formatRelativeTime(msg.timestamp)}</div>
                            <div className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                                MESSAGE_COLORS[msg.type] || "bg-muted text-muted-foreground"
                              }`}
                            >
                              {MESSAGE_ICONS[msg.type] || "📨"} {msg.type}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs">
                              {msg.from} <span className="text-muted-foreground">→</span> {msg.to}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium ${prioInfo.color}`}>
                              {prioInfo.icon} {prioInfo.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {msg.ack_required ? (
                              msg.ack_received ? (
                                <span className="text-green-600 dark:text-green-400">✓ ACK</span>
                              ) : (
                                <span className="text-yellow-600 dark:text-yellow-400">⏳ Pending</span>
                              )
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground font-mono max-w-xs truncate">
                            {payloadPreview(msg.payload)}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-border">
                            <td colSpan={6} className="px-4 py-4 bg-muted/20">
                              <div className="text-xs font-medium mb-2 text-muted-foreground">
                                Full Payload — ID: {msg.id}
                              </div>
                              <pre className="bg-background border border-border rounded-md p-3 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto">
                                {JSON.stringify(msg.payload, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div ref={tableEndRef} />
          </div>
        )}
      </main>
    </div>
  );
}

export default MessagesPage;
