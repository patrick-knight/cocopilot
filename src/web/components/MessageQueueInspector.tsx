/**
 * MessageQueueInspector – Displays inter-agent messages.
 *
 * Shows recent messages flowing through the Ganache Bus with type,
 * sender, receiver, priority, and acknowledgement status.
 * Features: scrollable list, sortable columns, filters.
 */

import React, { useState, useMemo } from "react";
import type { MessageEntry } from "../types.js";

export interface MessageQueueInspectorProps {
  /** Recent messages from the queue. */
  messages: MessageEntry[];
}

type SortField = "type" | "from" | "to" | "priority" | "timestamp" | "acked";
type SortDir = "asc" | "desc";

export function MessageQueueInspector({
  messages,
}: MessageQueueInspectorProps): React.ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [fromFilter, setFromFilter] = useState<string>("");

  // Get unique types and senders for filter dropdowns
  const uniqueTypes = useMemo(() => {
    const types = new Set(messages.map((m) => m.type));
    return Array.from(types).sort();
  }, [messages]);

  const uniqueSenders = useMemo(() => {
    const senders = new Set(messages.map((m) => m.from));
    return Array.from(senders).sort();
  }, [messages]);

  // Filter and sort messages
  const filteredMessages = useMemo(() => {
    let result = [...messages];

    // Apply filters
    if (typeFilter) {
      result = result.filter((m) => m.type === typeFilter);
    }
    if (fromFilter) {
      result = result.filter((m) => m.from === fromFilter);
    }

    // Apply sorting
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "type":
          cmp = a.type.localeCompare(b.type);
          break;
        case "from":
          cmp = a.from.localeCompare(b.from);
          break;
        case "to":
          cmp = (a.to === "*" ? "broadcast" : a.to).localeCompare(b.to === "*" ? "broadcast" : b.to);
          break;
        case "priority": {
          const order = { high: 0, normal: 1, low: 2 };
          cmp = (order[a.priority as keyof typeof order] ?? 1) - (order[b.priority as keyof typeof order] ?? 1);
          break;
        }
        case "timestamp":
          cmp = a.timestamp - b.timestamp;
          break;
        case "acked":
          cmp = (a.acked ? 1 : 0) - (b.acked ? 1 : 0);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [messages, typeFilter, fromFilter, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-stone-300 ml-1">↕</span>;
    return <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <section aria-label="Message Queue">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          <label htmlFor="type-filter" className="text-xs text-stone-500">Type:</label>
          <select
            id="type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-xs border border-stone-300 rounded px-2 py-1 bg-white text-stone-700 focus:outline-none focus:ring-1 focus:ring-amber-500"
          >
            <option value="">All</option>
            {uniqueTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="from-filter" className="text-xs text-stone-500">From:</label>
          <select
            id="from-filter"
            value={fromFilter}
            onChange={(e) => setFromFilter(e.target.value)}
            className="text-xs border border-stone-300 rounded px-2 py-1 bg-white text-stone-700 focus:outline-none focus:ring-1 focus:ring-amber-500"
          >
            <option value="">All</option>
            {uniqueSenders.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <span className="text-xs text-stone-400 ml-auto">
          {filteredMessages.length} of {messages.length} messages
        </span>
      </div>

      {messages.length === 0 ? (
        <div className="text-sm text-stone-500">
          <p className="italic">No messages in the queue.</p>
          <p className="text-xs mt-1">
            💡 Messages appear when agents communicate. Start a worker to see task assignments, nudges, and status updates.
          </p>
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-stone-300 bg-white">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="sticky top-0 bg-stone-100 text-left text-xs text-stone-500">
              <tr>
                <th
                  className="px-3 py-2 font-medium cursor-pointer hover:bg-stone-200 select-none"
                  onClick={() => handleSort("type")}
                >
                  Type <SortIndicator field="type" />
                </th>
                <th
                  className="px-3 py-2 font-medium cursor-pointer hover:bg-stone-200 select-none"
                  onClick={() => handleSort("from")}
                >
                  From <SortIndicator field="from" />
                </th>
                <th
                  className="px-3 py-2 font-medium cursor-pointer hover:bg-stone-200 select-none"
                  onClick={() => handleSort("to")}
                >
                  To <SortIndicator field="to" />
                </th>
                <th
                  className="px-3 py-2 font-medium cursor-pointer hover:bg-stone-200 select-none hidden sm:table-cell"
                  onClick={() => handleSort("priority")}
                >
                  Priority <SortIndicator field="priority" />
                </th>
                <th
                  className="px-3 py-2 font-medium cursor-pointer hover:bg-stone-200 select-none hidden md:table-cell"
                  onClick={() => handleSort("timestamp")}
                >
                  Time <SortIndicator field="timestamp" />
                </th>
                <th
                  className="px-3 py-2 font-medium cursor-pointer hover:bg-stone-200 select-none"
                  onClick={() => handleSort("acked")}
                >
                  ACK <SortIndicator field="acked" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredMessages.map((msg) => (
                <React.Fragment key={msg.id}>
                  <tr
                    className="cursor-pointer hover:bg-stone-50 transition-colors"
                    onClick={() => setExpanded(expanded === msg.id ? null : msg.id)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={expanded === msg.id}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setExpanded(expanded === msg.id ? null : msg.id);
                      }
                    }}
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      <MessageTypeBadge type={msg.type} />
                    </td>
                    <td className="px-3 py-2 text-stone-700 truncate max-w-[120px]">{msg.from}</td>
                    <td className="px-3 py-2 text-stone-700 truncate max-w-[120px]">{msg.to === "*" ? "broadcast" : msg.to}</td>
                    <td className="px-3 py-2 hidden sm:table-cell">
                      <PriorityBadge priority={msg.priority} />
                    </td>
                    <td className="px-3 py-2 text-stone-500 text-xs hidden md:table-cell">{formatTime(msg.timestamp)}</td>
                    <td className="px-3 py-2 text-center">
                      {msg.acked ? (
                        <span className="text-green-600" title="Acknowledged">✓</span>
                      ) : (
                        <span className="text-stone-300" title="Pending">○</span>
                      )}
                    </td>
                  </tr>
                  {expanded === msg.id && (
                    <tr>
                      <td colSpan={6} className="bg-stone-50 px-3 py-2">
                        <p className="font-mono text-xs text-stone-600 whitespace-pre-wrap break-words">
                          {msg.payloadPreview}
                        </p>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MessageTypeBadge({ type }: { type: string }): React.ReactElement {
  const colors: Record<string, string> = {
    TASK_ASSIGNED: "bg-blue-100 text-blue-700",
    TASK_COMPLETE: "bg-green-100 text-green-700",
    TASK_FAILED: "bg-red-100 text-red-700",
    NUDGE: "bg-yellow-100 text-yellow-700",
    PR_CREATED: "bg-purple-100 text-purple-700",
    PR_MERGED: "bg-green-100 text-green-700",
    CI_FAILED: "bg-red-100 text-red-700",
    SPAWN_FIXUP: "bg-orange-100 text-orange-700",
    BROADCAST: "bg-stone-100 text-stone-700",
  };

  const cls = colors[type] ?? "bg-stone-100 text-stone-600";

  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {type}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }): React.ReactElement {
  const cls =
    priority === "high"
      ? "text-red-600 font-semibold"
      : priority === "low"
        ? "text-stone-400"
        : "text-stone-600";

  return <span className={`text-xs ${cls}`}>{priority}</span>;
}

function formatTime(epoch: number): string {
  const d = new Date(epoch);
  return d.toLocaleTimeString("en-US", { hour12: false });
}
