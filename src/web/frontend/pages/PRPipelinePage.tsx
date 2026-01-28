/**
 * PRPipelinePage — Full-page PR pipeline view for a repository.
 *
 * Fetches PR data from /api/v1/repositories/:id/prs and subscribes
 * to real-time updates via Socket.IO `pr:status_changed` events.
 *
 * Route: /repo/:id/prs
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { PRPipeline } from "../components/PRPipeline.js";
import type { PRPipelineEntry, PRStage } from "../components/PRPipeline.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PRPipelinePageProps {
  /** Repository identifier (from route param). */
  repoId: string;
  /** Navigate back to the repository detail page. */
  onBack?: () => void;
}

interface PRStatusChangedEvent {
  number: number;
  stage: PRStage;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PRPipelinePage({
  repoId,
  onBack,
}: PRPipelinePageProps): React.ReactElement {
  const [prs, setPrs] = useState<PRPipelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // -----------------------------------------------------------------------
  // Fetch initial PR data
  // -----------------------------------------------------------------------

  const fetchPRs = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/repositories/${encodeURIComponent(repoId)}/prs`);
      if (!res.ok) {
        throw new Error(`Failed to fetch PRs: ${res.status} ${res.statusText}`);
      }
      const data: PRPipelineEntry[] = await res.json();
      setPrs(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load PRs");
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  // -----------------------------------------------------------------------
  // Socket.IO real-time updates
  // -----------------------------------------------------------------------

  useEffect(() => {
    fetchPRs();

    const socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    socketRef.current = socket;

    socket.on("pr:status_changed", (event: PRStatusChangedEvent) => {
      setPrs((prev) => {
        const idx = prev.findIndex((p) => p.number === event.number);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], stage: event.stage, updatedAt: event.updatedAt };
          return next;
        }
        // Unknown PR — refetch
        fetchPRs();
        return prev;
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [repoId, fetchPRs]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-2" aria-hidden="true">
            🍫
          </div>
          <p className="text-gray-600">Loading PR pipeline...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{error}</p>
          <button
            type="button"
            className="mt-2 text-sm text-[#C68B3C] hover:underline"
            onClick={() => {
              setLoading(true);
              fetchPRs();
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFF8E7]">
      {/* Header */}
      <header className="bg-[#3B1F0B] text-white px-6 py-4 shadow-md">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                type="button"
                className="text-gray-300 hover:text-white transition-colors text-sm"
                onClick={onBack}
              >
                &larr; Back
              </button>
            )}
            <h1 className="text-lg font-semibold">PR Pipeline</h1>
            <span className="text-sm text-gray-300">{repoId}</span>
          </div>
          <div className="text-sm text-gray-300">
            {prs.length} PR{prs.length !== 1 ? "s" : ""} tracked
          </div>
        </div>
      </header>

      {/* Pipeline content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        <PRPipeline prs={prs} />
      </main>
    </div>
  );
}

export default PRPipelinePage;
