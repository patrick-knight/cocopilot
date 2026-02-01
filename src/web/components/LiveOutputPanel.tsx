/**
 * LiveOutputPanel – Real-time streaming agent output viewer.
 *
 * Displays terminal-like output from the selected agent. Includes a dropdown
 * to switch between agents, pagination (20 lines visible), and formatted output.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import type { AgentOutputLine, AgentState, WorkerState } from "../types.js";
import { AGENT_DISPLAY } from "../types.js";

const VISIBLE_LINES = 20;

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
  const [viewOffset, setViewOffset] = useState(0);
  const [autoFollow, setAutoFollow] = useState(true);

  // Calculate visible window
  const totalLines = lines.length;
  const maxOffset = Math.max(0, totalLines - VISIBLE_LINES);
  
  // Auto-follow: when new lines arrive, jump to the end
  useEffect(() => {
    if (autoFollow) {
      setViewOffset(maxOffset);
    }
  }, [totalLines, autoFollow, maxOffset]);

  // Reset offset when agent changes
  useEffect(() => {
    setViewOffset(0);
    setAutoFollow(true);
  }, [selectedAgent]);

  // Get the visible slice of lines
  const visibleLines = lines.slice(viewOffset, viewOffset + VISIBLE_LINES);

  // Navigation handlers
  const pageUp = useCallback(() => {
    setAutoFollow(false);
    setViewOffset((prev) => Math.max(0, prev - VISIBLE_LINES));
  }, []);

  const pageDown = useCallback(() => {
    const newOffset = Math.min(maxOffset, viewOffset + VISIBLE_LINES);
    setViewOffset(newOffset);
    if (newOffset >= maxOffset) {
      setAutoFollow(true);
    }
  }, [maxOffset, viewOffset]);

  const jumpToEnd = useCallback(() => {
    setViewOffset(maxOffset);
    setAutoFollow(true);
  }, [maxOffset]);

  const jumpToStart = useCallback(() => {
    setAutoFollow(false);
    setViewOffset(0);
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "PageUp" || (e.key === "ArrowUp" && e.ctrlKey)) {
      e.preventDefault();
      pageUp();
    } else if (e.key === "PageDown" || (e.key === "ArrowDown" && e.ctrlKey)) {
      e.preventDefault();
      pageDown();
    } else if (e.key === "Home" && e.ctrlKey) {
      e.preventDefault();
      jumpToStart();
    } else if (e.key === "End" && e.ctrlKey) {
      e.preventDefault();
      jumpToEnd();
    }
  }, [pageUp, pageDown, jumpToStart, jumpToEnd]);

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

  const canPageUp = viewOffset > 0;
  const canPageDown = viewOffset < maxOffset;

  return (
    <section className="flex flex-col" aria-label="Live Output">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground dark:text-stone-100">
          Live Output{selectedAgent ? `: ${selectedAgent}` : ""}
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={selectedAgent ?? ""}
            onChange={(e) => onSelectAgent(e.target.value || null)}
            className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
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
            className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
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
        className="mt-2 rounded-lg border border-border bg-card overflow-hidden"
        role="log"
        aria-live="polite"
        aria-label="Agent output stream"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {/* Navigation bar */}
        {totalLines > VISIBLE_LINES && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border text-xs">
            <div className="flex items-center gap-1">
              <button
                onClick={jumpToStart}
                disabled={!canPageUp}
                className="px-1.5 py-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                title="Jump to start (Ctrl+Home)"
              >
                ⏮
              </button>
              <button
                onClick={pageUp}
                disabled={!canPageUp}
                className="px-1.5 py-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                title="Page up (PageUp)"
              >
                ▲
              </button>
              <button
                onClick={pageDown}
                disabled={!canPageDown}
                className="px-1.5 py-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                title="Page down (PageDown)"
              >
                ▼
              </button>
              <button
                onClick={jumpToEnd}
                disabled={!canPageDown}
                className="px-1.5 py-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                title="Jump to end (Ctrl+End)"
              >
                ⏭
              </button>
            </div>
            <div className="text-muted-foreground">
              Lines {viewOffset + 1}–{Math.min(viewOffset + VISIBLE_LINES, totalLines)} of {totalLines}
              {autoFollow && <span className="ml-2 text-primary">● Following</span>}
            </div>
          </div>
        )}

        {/* Output content */}
        <div className="p-3 font-mono text-sm min-h-[320px] max-h-[320px] overflow-hidden bg-stone-900 dark:bg-stone-950">
          {!selectedAgent && (
            <p className="text-stone-500 italic">Select an agent to view live output...</p>
          )}
          {selectedAgent && lines.length === 0 && (
            <div className="text-stone-500">
              <p className="italic mb-2">Waiting for output from {selectedAgent}...</p>
              <p className="text-xs">
                💡 New agents may take a moment to start producing output.
              </p>
            </div>
          )}
          {visibleLines.map((line, i) => (
            <OutputLine key={`${line.timestamp}-${viewOffset + i}`} line={line} />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Renders a single output line with formatting.
 */
function OutputLine({ line }: { line: AgentOutputLine }): React.ReactElement {
  const formatted = formatOutputText(line.text);
  const isError = line.stream === "stderr";
  
  return (
    <div className={`py-0.5 ${isError ? "text-red-400" : "text-stone-300"}`}>
      <span className="text-stone-600 select-none mr-2 text-xs">
        {formatTime(line.timestamp)}
      </span>
      {formatted}
    </div>
  );
}

/**
 * Format timestamp as HH:MM:SS.
 */
function formatTime(epoch: number): string {
  const d = new Date(epoch);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

/**
 * Format output text to be more human-readable.
 * - Parse JSON and pretty-print objects
 * - Highlight tool calls and results
 * - Format file paths and code blocks
 */
function formatOutputText(text: string): React.ReactNode {
  if (!text) return null;

  // Try to parse as JSON for pretty formatting
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return <FormattedJson data={parsed} />;
    } catch {
      // Not valid JSON, continue with text formatting
    }
  }

  // Detect tool calls: [tool_call] or similar patterns
  if (text.includes("tool_call") || text.includes("Tool:")) {
    return <span className="text-amber-400">{text}</span>;
  }

  // Detect tool results
  if (text.includes("tool_result") || text.includes("Result:")) {
    return <span className="text-emerald-400">{text}</span>;
  }

  // Detect file paths (starts with / or contains common extensions)
  const filePathMatch = text.match(/([\/\\][\w\-\.\/\\]+\.(ts|tsx|js|jsx|json|md|py|go|rs|java|rb|css|html))/);
  if (filePathMatch) {
    const parts = text.split(filePathMatch[1]);
    return (
      <>
        {parts[0]}
        <span className="text-cyan-400 underline">{filePathMatch[1]}</span>
        {parts.slice(1).join(filePathMatch[1])}
      </>
    );
  }

  // Default: return as-is with word wrap
  return <span className="whitespace-pre-wrap break-words">{text}</span>;
}

/**
 * Render formatted JSON with syntax highlighting.
 */
function FormattedJson({ data }: { data: unknown }): React.ReactElement {
  // For simple values, just stringify
  if (typeof data !== "object" || data === null) {
    return <span className="text-stone-300">{JSON.stringify(data)}</span>;
  }

  // For objects/arrays, show a condensed view
  const isArray = Array.isArray(data);
  const entries = isArray ? data : Object.entries(data);
  const count = isArray ? data.length : Object.keys(data).length;

  // If it's small, show inline
  if (count <= 3) {
    return (
      <span className="text-stone-300">
        {isArray ? "[" : "{"}
        {isArray
          ? (data as unknown[]).map((item, i) => (
              <span key={i}>
                {i > 0 && ", "}
                <JsonValue value={item} />
              </span>
            ))
          : Object.entries(data as Record<string, unknown>).map(([key, value], i) => (
              <span key={key}>
                {i > 0 && ", "}
                <span className="text-purple-400">{key}</span>
                <span className="text-stone-500">: </span>
                <JsonValue value={value} />
              </span>
            ))}
        {isArray ? "]" : "}"}
      </span>
    );
  }

  // For larger objects, show summary
  return (
    <span className="text-stone-400">
      {isArray ? `[Array(${count})]` : `{Object(${count} keys)}`}
    </span>
  );
}

function JsonValue({ value }: { value: unknown }): React.ReactElement {
  if (value === null) return <span className="text-stone-500">null</span>;
  if (typeof value === "boolean") return <span className="text-orange-400">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-blue-400">{value}</span>;
  if (typeof value === "string") {
    // Truncate long strings
    const display = value.length > 50 ? value.slice(0, 47) + "..." : value;
    return <span className="text-green-400">"{display}"</span>;
  }
  if (Array.isArray(value)) return <span className="text-stone-400">[{value.length}]</span>;
  if (typeof value === "object") return <span className="text-stone-400">{"{...}"}</span>;
  return <span>{String(value)}</span>;
}
