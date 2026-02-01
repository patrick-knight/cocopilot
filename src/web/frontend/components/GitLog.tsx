/**
 * GitLog — Shows recent git commits for the worker's worktree.
 *
 * Fetches the commit log from the API and displays a compact list
 * of commits with short hashes, messages, and timestamps.
 */

import React, { useEffect, useState, useCallback } from "react";
import type { GitCommit } from "../inspector-types.js";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface GitLogProps {
  /** Repository name. */
  repoName: string;
  /** Worker name. */
  workerName: string;
  /** Base API URL (e.g., "/api/v1"). */
  apiBase?: string;
  /** GitHub repository URL (e.g., "https://github.com/owner/repo"). Used to link commit hashes. */
  repoUrl?: string;
}

export const GitLog: React.FC<GitLogProps> = ({
  repoName,
  workerName,
  apiBase = "/api/v1",
  repoUrl,
}) => {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/repositories/${encodeURIComponent(repoName)}/workers/${encodeURIComponent(workerName)}/git-log`,
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as { commits: GitCommit[] };
      setCommits(data.commits);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase, repoName, workerName]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-stone-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
        <h2 className="text-sm font-semibold text-stone-700">Git Log</h2>
        <button
          onClick={fetchLog}
          className="text-xs px-2 py-1 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded"
        >
          Refresh
        </button>
      </div>

      <div className="p-4">
        {loading && commits.length === 0 && (
          <p className="text-sm text-stone-500">Loading commits...</p>
        )}

        {error && (
          <p className="text-sm text-red-600">
            Failed to load git log: {error}
          </p>
        )}

        {!loading && !error && commits.length === 0 && (
          <p className="text-sm text-stone-500">No commits yet.</p>
        )}

        {commits.length > 0 && (
          <ul className="space-y-2 overflow-hidden">
            {commits.map((commit) => (
              <li key={commit.hash} className="flex items-start gap-3 min-w-0">
                {repoUrl ? (
                  <a
                    href={`${repoUrl.replace(/\/+$/, "")}/commit/${commit.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded shrink-0 hover:bg-amber-100 hover:underline transition-colors"
                  >
                    {commit.shortHash}
                  </a>
                ) : (
                  <span className="font-mono text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded shrink-0">
                    {commit.shortHash}
                  </span>
                )}
                <div className="min-w-0 flex-1 overflow-hidden">
                  <p className="text-sm text-stone-800 truncate">
                    {commit.message}
                  </p>
                  <p className="text-xs text-stone-400 truncate">
                    {commit.author} &middot;{" "}
                    {new Date(commit.date).toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
