/**
 * MessageInspector — Shows messages to/from a worker.
 *
 * Displays the inter-agent message history for a specific worker,
 * including type badges, priority indicators, and payload details.
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

const PRIORITY_STYLES: Record<string, string> = {
  high: "text-red-600",
  normal: "text-stone-500",
  low: "text-stone-400",
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
          <ul className="space-y-2">
            {messages.map((msg) => {
              const typeStyle = TYPE_STYLES[msg.type] ?? {
                bg: "bg-stone-100",
                text: "text-stone-700",
              };
              const isExpanded = expandedId === msg.id;
              const direction = msg.to === workerName ? "inbound" : "outbound";

              return (
                <li
                  key={msg.id}
                  className="border border-stone-100 rounded-md overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : msg.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-50"
                  >
                    {/* Direction indicator */}
                    <span
                      className={`text-xs ${
                        direction === "inbound"
                          ? "text-blue-500"
                          : "text-stone-400"
                      }`}
                    >
                      {direction === "inbound" ? "\u2190" : "\u2192"}
                    </span>

                    {/* Type badge */}
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${typeStyle.bg} ${typeStyle.text}`}
                    >
                      {msg.type}
                    </span>

                    {/* From/To */}
                    <span className="text-xs text-stone-500 truncate">
                      {direction === "inbound"
                        ? `from ${msg.from}`
                        : `to ${msg.to}`}
                    </span>

                    {/* Priority */}
                    <span
                      className={`text-xs ml-auto ${
                        PRIORITY_STYLES[msg.priority] ?? ""
                      }`}
                    >
                      {msg.priority !== "normal" ? msg.priority : ""}
                    </span>

                    {/* Timestamp */}
                    <span className="text-xs text-stone-400 shrink-0">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </button>

                  {/* Expanded payload */}
                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-stone-100">
                      <pre className="mt-2 text-xs font-mono text-stone-600 bg-stone-50 p-2 rounded overflow-x-auto">
                        {JSON.stringify(msg.payload, null, 2)}
                      </pre>
                      <div className="mt-2 flex items-center gap-3 text-xs text-stone-400">
                        <span>ID: {msg.id}</span>
                        {msg.ack_required && (
                          <span>
                            ACK:{" "}
                            {msg.ack_received
                              ? new Date(msg.ack_received).toLocaleTimeString()
                              : "pending"}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
