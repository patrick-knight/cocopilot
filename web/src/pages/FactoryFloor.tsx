/**
 * Factory Floor - Repository list homepage
 */

import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";

interface Repository {
  name: string;
  url: string;
  branch: string;
  workersActive: number;
  workersTotal: number;
}

type SortField = "name" | "branch" | "workersActive" | "workersTotal";
type SortDirection = "asc" | "desc";

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

const ITEMS_PER_PAGE = 20;

export function FactoryFloor() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "idle">("all");

  // Sorting state
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

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

  // Get unique branches for filter dropdown
  const uniqueBranches = useMemo(() => {
    return [...new Set(repos.map((r) => r.branch))].sort();
  }, [repos]);

  // Filtered and sorted repos
  const filteredRepos = useMemo(() => {
    let result = repos.filter((repo) => {
      // Search filter
      const matchesSearch =
        searchQuery === "" ||
        repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        repo.branch.toLowerCase().includes(searchQuery.toLowerCase());

      // Branch filter
      const matchesBranch = branchFilter === "" || repo.branch === branchFilter;

      // Status filter
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && repo.workersActive > 0) ||
        (statusFilter === "idle" && repo.workersActive === 0);

      return matchesSearch && matchesBranch && matchesStatus;
    });

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === "name" || sortField === "branch") {
        cmp = a[sortField].localeCompare(b[sortField]);
      } else {
        cmp = a[sortField] - b[sortField];
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return result;
  }, [repos, searchQuery, branchFilter, statusFilter, sortField, sortDirection]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredRepos.length / ITEMS_PER_PAGE);
  const paginatedRepos = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredRepos.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredRepos, currentPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, branchFilter, statusFilter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-muted-foreground/50 ml-1">↕</span>;
    return <span className="text-primary ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">🍫</div>
          <p className="text-muted-foreground text-lg">Loading chocolate factory...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center bg-card p-8 rounded-lg shadow-lg border border-border">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-destructive mb-2">Connection Error</h2>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-12 text-center">
          <div className="text-6xl mb-4">🍫</div>
          <h1 className="text-5xl font-bold text-foreground mb-2">
            Cocoa Board
          </h1>
          <p className="text-muted-foreground text-lg italic">
            "Good code, like good chocolate, requires the right blend of chaos and control."
          </p>
          <div className="mt-4 flex items-center justify-center gap-4">
            <div className="bg-chart-2/10 text-chart-2 px-4 py-2 rounded-full text-sm font-semibold">
              ✓ Concher Active
            </div>
            <div className="bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-semibold">
              ✓ Redis Connected
            </div>
          </div>
        </header>

        {/* Repository Grid */}
        {repos.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">📦</div>
            <h3 className="text-2xl font-bold text-foreground mb-2">No Repositories</h3>
            <p className="text-muted-foreground mb-6">
              Initialize a repository to get started:
            </p>
            <code className="bg-primary text-primary-foreground px-6 py-3 rounded-lg inline-block font-mono text-sm">
              coco init https://github.com/your-org/your-repo
            </code>
          </div>
        ) : (
          <>
            {/* Search and Filter Controls */}
            <div className="bg-card rounded-lg shadow-md p-4 mb-6 border border-border">
              <div className="flex flex-col md:flex-row gap-4">
                {/* Search Input */}
                <div className="flex-1">
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Search
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      🔍
                    </span>
                    <input
                      type="text"
                      placeholder="Search by name or branch..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-ring outline-none"
                    />
                  </div>
                </div>

                {/* Branch Filter */}
                <div className="md:w-48">
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Branch
                  </label>
                  <select
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-ring outline-none"
                  >
                    <option value="">All Branches</option>
                    {uniqueBranches.map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Filter */}
                <div className="md:w-40">
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Status
                  </label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "idle")}
                    className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-ring outline-none"
                  >
                    <option value="all">All Status</option>
                    <option value="active">Active Workers</option>
                    <option value="idle">Idle</option>
                  </select>
                </div>
              </div>

              {/* Results count */}
              <div className="mt-3 text-sm text-muted-foreground">
                Showing {paginatedRepos.length} of {filteredRepos.length} repositories
                {filteredRepos.length !== repos.length && (
                  <span> (filtered from {repos.length} total)</span>
                )}
              </div>
            </div>

            {/* Repository Table */}
            <div className="bg-card rounded-lg shadow-lg overflow-hidden border border-border">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted border-b border-border">
                    <tr>
                      <th
                        className="px-6 py-4 text-left text-sm font-semibold text-foreground cursor-pointer hover:bg-accent transition-colors"
                        onClick={() => handleSort("name")}
                      >
                        <div className="flex items-center">
                          Repository
                          <SortIcon field="name" />
                        </div>
                      </th>
                      <th
                        className="px-6 py-4 text-left text-sm font-semibold text-foreground cursor-pointer hover:bg-accent transition-colors"
                        onClick={() => handleSort("branch")}
                      >
                        <div className="flex items-center">
                          Branch
                          <SortIcon field="branch" />
                        </div>
                      </th>
                      <th
                        className="px-6 py-4 text-center text-sm font-semibold text-foreground cursor-pointer hover:bg-accent transition-colors"
                        onClick={() => handleSort("workersActive")}
                      >
                        <div className="flex items-center justify-center">
                          Active
                          <SortIcon field="workersActive" />
                        </div>
                      </th>
                      <th
                        className="px-6 py-4 text-center text-sm font-semibold text-foreground cursor-pointer hover:bg-accent transition-colors"
                        onClick={() => handleSort("workersTotal")}
                      >
                        <div className="flex items-center justify-center">
                          Total
                          <SortIcon field="workersTotal" />
                        </div>
                      </th>
                      <th className="px-6 py-4 text-center text-sm font-semibold text-foreground">
                        Status
                      </th>
                      <th className="px-6 py-4 text-right text-sm font-semibold text-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paginatedRepos.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                          <div className="text-3xl mb-2">🔍</div>
                          No repositories match your filters
                        </td>
                      </tr>
                    ) : (
                      paginatedRepos.map((repo) => (
                        <tr
                          key={repo.name}
                          className="hover:bg-accent transition-colors"
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <span className="text-2xl">🏭</span>
                              <div>
                                <div className="font-semibold text-foreground">
                                  {repo.name}
                                </div>
                                {repo.url && (
                                  <div className="text-xs text-muted-foreground truncate max-w-xs">
                                    {repo.url}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <code className="bg-muted text-foreground px-2 py-1 rounded text-sm font-mono">
                              {repo.branch}
                            </code>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`font-semibold ${repo.workersActive > 0 ? "text-chart-2" : "text-muted-foreground"}`}>
                              {repo.workersActive}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center text-muted-foreground">
                            {repo.workersTotal}
                          </td>
                          <td className="px-6 py-4 text-center">
                            {repo.workersActive > 0 ? (
                              <span className="inline-flex items-center gap-1 bg-chart-2/10 text-chart-2 px-3 py-1 rounded-full text-xs font-semibold">
                                <span className="w-2 h-2 bg-chart-2 rounded-full animate-pulse"></span>
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 bg-muted text-muted-foreground px-3 py-1 rounded-full text-xs font-semibold">
                                <span className="w-2 h-2 bg-muted-foreground rounded-full"></span>
                                Idle
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <Link
                              to={`/repos/${repo.name}`}
                              className="inline-flex items-center gap-1 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                            >
                              View
                              <span>→</span>
                            </Link>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-6 py-4 bg-muted border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      className="px-3 py-1 rounded border border-border text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent transition-colors"
                    >
                      ««
                    </button>
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 rounded border border-border text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent transition-colors"
                    >
                      «
                    </button>

                    {/* Page number buttons */}
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let page: number;
                      if (totalPages <= 5) {
                        page = i + 1;
                      } else if (currentPage <= 3) {
                        page = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        page = totalPages - 4 + i;
                      } else {
                        page = currentPage - 2 + i;
                      }
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                            currentPage === page
                              ? "bg-primary text-primary-foreground"
                              : "border border-border hover:bg-accent"
                          }`}
                        >
                          {page}
                        </button>
                      );
                    })}

                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 rounded border border-border text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent transition-colors"
                    >
                      »
                    </button>
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 rounded border border-border text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent transition-colors"
                    >
                      »»
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <footer className="mt-16 text-center text-muted-foreground text-sm">
          <p>CoCoPilot v0.1.0 · Collaborative Copilot Orchestration Platform</p>
          <p className="mt-1">
            <a href="https://github.com/patrick-knight/cocopilot" className="hover:text-primary underline">
              Documentation
            </a>
            {" · "}
            <a href="/api/v1/status" className="hover:text-primary underline">
              API Status
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
