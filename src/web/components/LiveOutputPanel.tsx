/**
 * LiveOutputPanel – Real-time streaming agent output viewer.
 *
 * Displays terminal-like output from the selected agent. Includes a dropdown
 * to switch between agents and auto-scrolls to the latest output.
 */

import React, { useEffect, useRef } from "react";
import type { AgentOutputLine, AgentState, WorkerState } from "../types.js";
import { AGENT_DISPLAY } from "../types.js";

export interface LiveOutputPanelProps {
  /** System agents (Chocolatier, Temperer, etc.). */
  agents: AgentState[];
  /** Worker agents (Truffles). */
  workers: WorkerState[];
  /** Currently selected agent name. */
  selectedAgent: string | null;
  /** Called when user changes the agent selector. */
  onSelectAgent: (agentName: string | null) => void;
  /** Buffered output lines from the selected agent. */
  lines: AgentOutputLine[];
  /** Clear the output buffer. */
  onClear: () => void;
}

export function LiveOutputPanel({
  agents,
  workers,
  selectedAgent,
  onSelectAgent,
  lines,
  onClear,
}: LiveOutputPanelProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  // Build the options for the agent selector dropdown
  const agentOptions = [
    ...agents.map((a) => ({
      value: a.name,
      label: `${AGENT_DISPLAY[a.type]?.icon ?? "🔧"} ${AGENT_DISPLAY[a.type]?.label ?? a.name} (${a.name})`,
    })),
    ...workers.map((w) => ({
      value: w.name,
      label: `🫘 ${w.name}`,
    })),
  ];

  return (
    <section className="flex flex-col" aria-label="Live Output">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-800">
          Live Output{selectedAgent ? `: ${selectedAgent}` : ""}
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={selectedAgent ?? ""}
            onChange={(e) => onSelectAgent(e.target.value || null)}
            className="rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-caramel-400"
            aria-label="Select agent"
          >
            <option value="">Select agent...</option>
            {agentOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-100 transition-colors"
            onClick={onClear}
            title="Clear output"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Output area */}
      <div
        ref={scrollRef}
        className="mt-2 h-72 overflow-y-auto rounded-lg border border-stone-300 bg-stone-900 p-3 font-mono text-sm text-green-400"
        role="log"
        aria-live="polite"
        aria-label="Agent output stream"
      >
        {!selectedAgent && (
          <p className="text-stone-500 italic">Select an agent to view live output...</p>
        )}
        {selectedAgent && lines.length === 0 && (
          <p className="text-stone-500 italic">Waiting for output from {selectedAgent}...</p>
        )}
        {lines.map((line, i) => (
          <div
            key={`${line.timestamp}-${i}`}
            className={`whitespace-pre-wrap break-all ${line.stream === "stderr" ? "text-red-400" : "text-green-400"}`}
          >
            <span className="text-stone-500 select-none mr-2">
              {formatTime(line.timestamp)}
            </span>
            {line.text}
          </div>
        ))}
      </div>
    </section>
  );
}

function formatTime(epoch: number): string {
  const d = new Date(epoch);
  return d.toLocaleTimeString("en-US", { hour12: false });
}
