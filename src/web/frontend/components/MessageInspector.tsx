/**
 * MessageInspector — Shows messages to/from a worker.
 *
 * Displays the inter-agent message history for a specific worker
 * in a table format with type badges, priority indicators, and 
 * expandable payload details.
 */

import React, { useEffect, useState, useCallback } from "react";
import type { AgentMessage } from "../inspector-types.js";

// ---------------------------------------------------------------------------
// Message type display config
// ---------------------------------------------------------------------------

const TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  TASK_ASSIGNED: { bg: "bg-blue-100", text: "text-blue-800" },
  TASK_COMPLETE: { bg: "bg-emerald-100", text: "text-emerald-800" },
  TASK_FAILED: { bg: "bg-red-100", text: "text-red-800" },
  STATUS_REQUEST: { bg: "bg-stone-100", text: "text-stone-700" },
  STATUS_RESPONSE: { bg: "bg-stone-100", text: "text-stone-700" },
  NUDGE: { bg: "bg-amber-100", text: "text-amber-800" },
  PR_CREATED: { bg: "bg-purple-100", text: "text-purple-800" },
  PR_MERGED: { bg: "bg-emerald-100", text: "text-emerald-800" },
  CI_FAILED: { bg: "bg-red-100", text: "text-red-800" },
  SPAWN_FIXUP: { bg: "bg-orange-100", text: "text-orange-800" },
  BROADCAST: { bg: "bg-indigo-100", text: "text-indigo-800" },
};

const PRIORITY_BADGE: Record<string, { bg: string; text: string }> = {
  high: { bg: "bg-red-100", text: "text-red-700" },
  normal: { bg: "bg-stone-100", text: "text-stone-600" },
  low: { bg: "bg-stone-50", text: "text-stone-400" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface MessageInspectorProps {
  /** Worker name. */
  workerName: string;
  /** Repository name. */
  repoName: string;
  /** Base API URL (e.g., "/api/v1"). */
  apiBase?: string;
}

export const MessageInspector: React.FC<MessageInspectorProps> = ({
  workerName,
  repoName,
  apiBase = "/api/v1",
}) => {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/repositories/${encodeURIComponent(repoName)}/workers/${encodeURIComponent(workerName)}/messages`,
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as { messages: AgentMessage[] };
      setMessages(data.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase, repoName, workerName]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-stone-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
        <h2 className="text-sm font-semibold text-stone-700">Messages</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-400">
            {messages.length} message{messages.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={fetchMessages}
            className="text-xs px-2 py-1 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="p-4">
        {loading && messages.length === 0 && (
          <p className="text-sm text-stone-500">Loading messages...</p>
        )}

        {error && (
          <p className="text-sm text-red-600">
            Failed to load messages: {error}
          </p>
        )}

        {!loading && !error && messages.length === 0 && (
          <p className="text-sm text-stone-500">No messages yet.</p>
        )}

        {messages.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200">
                  <th className="text-left py-2 px-2 text-xs font-medium text-stone-500 w-8"></th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-stone-500">Type</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-stone-500">From/To</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-stone-500">Priority</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-stone-500">Time</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-stone-500 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {messages.map((msg) => {
                  const typeStyle = TYPE_STYLES[msg.type] ?? {
                    bg: "bg-stone-100",
                    text: "text-stone-700",
                  };
                  const priorityStyle = PRIORITY_BADGE[msg.priority] ?? PRIORITY_BADGE.normal;
                  const isExpanded = expandedId === msg.id;
                  const direction = msg.to === workerName ? "inbound" : "outbound";

                  return (
                    <React.Fragment key={msg.id}>
                      <tr 
                        className={`border-b border-stone-100 hover:bg-stone-50 cursor-pointer ${isExpanded ? "bg-stone-50" : ""}`}
                        onClick={() => setExpandedId(isExpanded ? null : msg.id)}
                      >
                        {/* Direction */}
                        <td className="py-2 px-2">
                          <span
                            className={`text-sm ${
                              direction === "inbound"
                                ? "text-blue-500"
                                : "text-stone-400"
                            }`}
                            title={direction === "inbound" ? "Received" : "Sent"}
                          >
                            {direction === "inbound" ? "←" : "→"}
                          </span>
                        </td>

                        {/* Type badge */}
                        <td className="py-2 px-2">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${typeStyle.bg} ${typeStyle.text}`}
                          >
                            {msg.type}
                          </span>
                        </td>

                        {/* From/To */}
                        <td className="py-2 px-2 text-xs text-stone-600 truncate max-w-[120px]">
                          {direction === "inbound" ? msg.from : msg.to}
                        </td>

                        {/* Priority */}
                        <td className="py-2 px-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${priorityStyle.bg} ${priorityStyle.text}`}>
                            {msg.priority}
                          </span>
                        </td>

                        {/* Timestamp */}
                        <td className="py-2 px-2 text-xs text-stone-400 whitespace-nowrap">
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </td>

                        {/* Expand indicator */}
                        <td className="py-2 px-2 text-xs text-stone-400">
                          {isExpanded ? "▼" : "▶"}
                        </td>
                      </tr>

                      {/* Expanded payload row */}
                      {isExpanded && (
                        <tr className="bg-stone-50">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="space-y-2">
                              <div className="text-xs text-stone-500">
                                <strong>ID:</strong> {msg.id}
                              </div>
                              {msg.ack_required && (
                                <div className="text-xs text-stone-500">
                                  <strong>ACK:</strong>{" "}
                                  {msg.ack_received
                                    ? new Date(msg.ack_received).toLocaleTimeString()
                                    : "pending"}
                                </div>
                              )}
                              <div>
                                <div className="text-xs text-stone-500 mb-1"><strong>Payload:</strong></div>
                                <pre className="text-xs font-mono text-stone-600 bg-white p-2 rounded border border-stone-200 overflow-x-auto max-h-40">
                                  {JSON.stringify(msg.payload, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
