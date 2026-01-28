/**
 * MessageQueueInspector – Displays inter-agent messages.
 *
 * Shows recent messages flowing through the Ganache Bus with type,
 * sender, receiver, priority, and acknowledgement status.
 */

import React, { useState } from "react";
import type { MessageEntry } from "../types.js";

export interface MessageQueueInspectorProps {
  /** Recent messages from the queue. */
  messages: MessageEntry[];
}

export function MessageQueueInspector({
  messages,
}: MessageQueueInspectorProps): React.ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <section aria-label="Message Queue">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-800">Message Queue</h2>
        <span className="text-xs text-stone-400">{messages.length} messages</span>
      </div>

      {messages.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500 italic">No messages in the queue.</p>
      ) : (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-stone-300 bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-stone-100 text-left text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">From</th>
                <th className="px-3 py-2 font-medium">To</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">ACK</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {messages.map((msg) => (
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
                    <td className="px-3 py-2 text-stone-700">{msg.from}</td>
                    <td className="px-3 py-2 text-stone-700">{msg.to === "*" ? "broadcast" : msg.to}</td>
                    <td className="px-3 py-2">
                      <PriorityBadge priority={msg.priority} />
                    </td>
                    <td className="px-3 py-2 text-stone-500 text-xs">{formatTime(msg.timestamp)}</td>
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
                        <p className="font-mono text-xs text-stone-600 whitespace-pre-wrap">
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
