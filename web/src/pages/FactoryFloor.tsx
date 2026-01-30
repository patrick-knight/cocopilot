/**
 * Factory Floor - Repository list homepage
 */

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface Repository {
  name: string;
  url: string;
  branch: string;
  workersActive: number;
  workersTotal: number;
}

function normalizeRepos(data: unknown): Repository[] {
  const raw = Array.isArray(data)
    ? data
    : (data as { repositories?: unknown[] })?.repositories ?? [];

  return (raw as any[]).map((repo) => {
    const workers = repo?.workers && typeof repo.workers === "object" ? repo.workers : {};
    const workerList = Object.values(workers);
    const workersActive = workerList.filter(
      (worker: any) => worker?.status === "running" || worker?.status === "active",
    ).length;

    return {
      name: repo?.name ?? "unknown",
      url: repo?.url ?? "",
      branch: repo?.defaultBranch ?? repo?.branch ?? "main",
      workersActive,
      workersTotal: workerList.length,
    };
  });
}

export function FactoryFloor() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/repositories")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setRepos(normalizeRepos(data));
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-amber-50 to-orange-100">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">🍫</div>
          <p className="text-stone-700 text-lg">Loading chocolate factory...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-amber-50 to-orange-100">
        <div className="text-center bg-white p-8 rounded-lg shadow-lg">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-red-600 mb-2">Connection Error</h2>
          <p className="text-stone-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-12 text-center">
          <div className="text-6xl mb-4">🍫</div>
          <h1 className="text-5xl font-bold text-stone-800 mb-2">
            Cocoa Board
          </h1>
          <p className="text-stone-600 text-lg italic">
            "Good code, like good chocolate, requires the right blend of chaos and control."
          </p>
          <div className="mt-4 flex items-center justify-center gap-4">
            <div className="bg-green-100 text-green-800 px-4 py-2 rounded-full text-sm font-semibold">
              ✓ Concher Active
            </div>
            <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded-full text-sm font-semibold">
              ✓ Redis Connected
            </div>
          </div>
        </header>

        {/* Repository Grid */}
        {repos.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">📦</div>
            <h3 className="text-2xl font-bold text-stone-700 mb-2">No Repositories</h3>
            <p className="text-stone-600 mb-6">
              Initialize a repository to get started:
            </p>
            <code className="bg-stone-800 text-green-400 px-6 py-3 rounded-lg inline-block font-mono text-sm">
              coco init https://github.com/your-org/your-repo
            </code>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {repos.map((repo) => (
              <Link
                key={repo.name}
                to={`/repos/${repo.name}`}
                className="block bg-white rounded-lg shadow-lg hover:shadow-xl transition-shadow p-6 border-2 border-transparent hover:border-amber-500"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-stone-800 mb-1">
                      {repo.name}
                    </h3>
                    <p className="text-sm text-stone-500 font-mono">
                      {repo.branch}
                    </p>
                  </div>
                  <div className="text-3xl">🏭</div>
                </div>
                
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-stone-700">
                      {repo.workersActive} active
                    </span>
                  </div>
                  <div className="text-stone-500">
                    {repo.workersTotal} total
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-stone-200">
                  <span className="text-amber-600 font-semibold text-sm">
                    View Tempering Station →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 text-center text-stone-500 text-sm">
          <p>CoCoPilot v0.1.0 · Collaborative Copilot Orchestration Platform</p>
          <p className="mt-1">
            <a href="https://github.com/patrick-knight/cocopilot" className="hover:text-amber-600 underline">
              Documentation
            </a>
            {" · "}
            <a href="/api/v1/status" className="hover:text-amber-600 underline">
              API Status
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
