/**
 * LiveOutput — Real-time streaming output from a worker.
 *
 * Connects to Socket.IO to stream worker output and displays it
 * in a scrollable terminal-style panel. Supports output, tool calls,
 * tool results, and error types.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import type { WorkerOutputEvent } from "../inspector-types.js";

// ---------------------------------------------------------------------------
// Output line styling by type
// ---------------------------------------------------------------------------

const TYPE_STYLES: Record<WorkerOutputEvent["type"], string> = {
  output: "text-stone-300",
  tool_call: "text-amber-400",
  tool_result: "text-emerald-400",
  error: "text-red-400",
};

const TYPE_PREFIX: Record<WorkerOutputEvent["type"], string> = {
  output: "> ",
  tool_call: "[tool] ",
  tool_result: "[result] ",
  error: "[error] ",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface LiveOutputProps {
  /** Worker name to stream output from. */
  workerName: string;
  /** Socket.IO socket instance. */
  socket: {
    emit: (event: string, ...args: unknown[]) => void;
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    off: (event: string, handler: (...args: unknown[]) => void) => void;
  } | null;
  /** Maximum number of output lines to keep in the buffer. */
  maxLines?: number;
}

export const LiveOutput: React.FC<LiveOutputProps> = ({
  workerName,
  socket,
  maxLines = 500,
}) => {
  const [lines, setLines] = useState<WorkerOutputEvent[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Join/leave the worker stream room
  useEffect(() => {
    if (!socket || !workerName) return;

    socket.emit("worker:join", workerName);

    return () => {
      socket.emit("worker:leave", workerName);
    };
  }, [socket, workerName]);

  // Listen for output events
  const handleOutput = useCallback(
    (event: unknown) => {
      const outputEvent = event as WorkerOutputEvent;
      if (outputEvent.workerName !== workerName) return;

      setLines((prev) => {
        const next = [...prev, outputEvent];
        // Trim to maxLines to avoid memory buildup
        return next.length > maxLines ? next.slice(-maxLines) : next;
      });
    },
    [workerName, maxLines],
  );

  useEffect(() => {
    if (!socket) return;

    socket.on("worker:output", handleOutput);
    return () => {
      socket.off("worker:output", handleOutput);
    };
  }, [socket, handleOutput]);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  }, []);

  const clearOutput = useCallback(() => {
    setLines([]);
  }, []);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-stone-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
        <h2 className="text-sm font-semibold text-stone-700">Live Output</h2>
        <div className="flex items-center gap-2">
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                endRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
              className="text-xs px-2 py-1 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded"
            >
              Scroll to bottom
            </button>
          )}
          <button
            onClick={clearOutput}
            className="text-xs px-2 py-1 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded"
          >
            Clear
          </button>
          <span className="text-xs text-stone-400">{lines.length} lines</span>
        </div>
      </div>

      {/* Terminal output */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="bg-stone-900 text-stone-300 font-mono text-xs p-4 overflow-y-auto"
        style={{ height: "400px" }}
      >
        {lines.length === 0 ? (
          <p className="text-stone-600 italic">
            Waiting for output from {workerName}...
          </p>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap ${TYPE_STYLES[line.type]}`}>
              <span className="text-stone-600 select-none">
                {TYPE_PREFIX[line.type]}
              </span>
              {line.content}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
};
