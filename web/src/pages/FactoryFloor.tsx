/**
 * Factory Floor - Repository list homepage
 */

import React, { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { ThemeToggle } from "../../../src/web/components/ThemeToggle.js";

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
  const navigate = useNavigate();
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

  // Init repo state
  const [initRepoUrl, setInitRepoUrl] = useState("");
  const [initLoading, setInitLoading] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Action feedback state (for delete/repair operations)
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // repoName being acted on

  // Onboard modal state
  const [showOnboardModal, setShowOnboardModal] = useState(false);

  // System status state
  const [systemStatus, setSystemStatus] = useState<{
    daemon: { up: boolean };
    redis: { connected: boolean };
    github: { authenticated: boolean; user: string | null; error: string | null };
    copilot: { installed: boolean; version: string | null; error: string | null };
  } | null>(null);

  // Clear action feedback after 5 seconds
  useEffect(() => {
    if (actionFeedback) {
      const timer = setTimeout(() => setActionFeedback(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [actionFeedback]);

  const fetchRepos = () => {
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
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  };

  const fetchStatus = () => {
    fetch("/api/v1/status")
      .then((res) => res.json())
      .then((data) => setSystemStatus(data))
      .catch((err) => {
        // Log status fetch errors but don't block the UI
        console.warn("[FactoryFloor] Failed to fetch status:", err instanceof Error ? err.message : String(err));
        // Set a minimal status to indicate connectivity issue
        setSystemStatus({
          daemon: { up: false },
          redis: { connected: false },
          github: { authenticated: false, user: null, error: "Failed to fetch status" },
          copilot: { installed: false, version: null, error: "Failed to fetch status" },
        });
      });
  };

  useEffect(() => {
    fetchRepos();
    fetchStatus();
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

  const handleInitRepo = async () => {
    if (!initRepoUrl.trim() || initLoading) return;
    
    setInitLoading(true);
    setInitError(null);
    
    try {
      const res = await fetch("/api/v1/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: initRepoUrl.trim() }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || data.message || `HTTP ${res.status}`);
      }
      
      // Success - refresh repos and clear input
      setInitRepoUrl("");
      fetchRepos();
    } catch (err) {
      setInitError(err instanceof Error ? err.message : "Failed to initialize repository");
    } finally {
      setInitLoading(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleDeleteRepo = async (repoName: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click navigation
    if (!confirm(`Are you sure you want to remove "${repoName}" from CoCoPilot?`)) {
      return;
    }
    setActionLoading(repoName);
    setActionFeedback(null);
    try {
      const res = await fetch(`/api/v1/repositories/${encodeURIComponent(repoName)}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setActionFeedback({ type: "success", message: `Repository "${repoName}" removed successfully` });
      fetchRepos();
    } catch (err) {
      setActionFeedback({ type: "error", message: `Failed to delete repository: ${err instanceof Error ? err.message : err}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRepairRepo = async (repoName: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click navigation
    if (!confirm(`Clean up orphaned workers for "${repoName}"?`)) {
      return;
    }
    setActionLoading(repoName);
    setActionFeedback(null);
    try {
      const res = await fetch(`/api/v1/repositories/${encodeURIComponent(repoName)}/repair`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setActionFeedback({ type: "success", message: data.message || "Repair completed" });
      fetchRepos();
    } catch (err) {
      setActionFeedback({ type: "error", message: `Failed to repair repository: ${err instanceof Error ? err.message : err}` });
    } finally {
      setActionLoading(null);
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
      {/* Top bar with theme toggle */}
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

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
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {/* Concher Status */}
            <div className={`px-4 py-2 rounded-full text-sm font-semibold ${
              systemStatus?.daemon?.up 
                ? "bg-chart-2/10 text-chart-2" 
                : "bg-destructive/10 text-destructive"
            }`}>
              {systemStatus?.daemon?.up ? "✓" : "✗"} Concher {systemStatus?.daemon?.up ? "Active" : "Inactive"}
            </div>
            {/* Redis Status */}
            <div className={`px-4 py-2 rounded-full text-sm font-semibold ${
              systemStatus?.redis?.connected 
                ? "bg-chart-2/10 text-chart-2" 
                : "bg-destructive/10 text-destructive"
            }`}>
              {systemStatus?.redis?.connected ? "✓" : "✗"} Redis {systemStatus?.redis?.connected ? "Connected" : "Disconnected"}
            </div>
            {/* GitHub Auth Status */}
            <div className={`px-4 py-2 rounded-full text-sm font-semibold ${
              systemStatus?.github?.authenticated 
                ? "bg-chart-2/10 text-chart-2" 
                : "bg-amber-500/10 text-amber-500"
            }`}>
              {systemStatus?.github?.authenticated ? "✓" : "⚠"} GitHub {
                systemStatus?.github?.authenticated 
                  ? (systemStatus.github.user ? `(${systemStatus.github.user})` : "Logged In")
                  : "Not Logged In"
              }
            </div>
            {/* Copilot CLI Status */}
            <div className={`px-4 py-2 rounded-full text-sm font-semibold ${
              systemStatus?.copilot?.installed 
                ? "bg-chart-2/10 text-chart-2" 
                : "bg-amber-500/10 text-amber-500"
            }`}>
              {systemStatus?.copilot?.installed ? "✓" : "⚠"} Copilot CLI {
                systemStatus?.copilot?.installed ? "Installed" : "Not Found"
              }
            </div>
          </div>
        </header>

        {/* Action feedback toast */}
        {actionFeedback && (
          <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 ${
            actionFeedback.type === "success"
              ? "bg-chart-2/90 text-white"
              : "bg-destructive/90 text-white"
          }`}>
            <span>{actionFeedback.type === "success" ? "✓" : "✗"}</span>
            <span>{actionFeedback.message}</span>
            <button
              onClick={() => setActionFeedback(null)}
              className="ml-2 hover:opacity-70"
              aria-label="Close notification"
            >
              ×
            </button>
          </div>
        )}

        {/* Repository Grid */}
        {repos.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">📦</div>
            <h3 className="text-2xl font-bold text-foreground mb-2">No Repositories</h3>
            <p className="text-muted-foreground mb-6">
              Enter a repository URL to get started:
            </p>
            <div className="max-w-lg mx-auto">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  placeholder="https://github.com/your-org/your-repo"
                  value={initRepoUrl}
                  onChange={(e) => {
                    setInitRepoUrl(e.target.value);
                    setInitError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && initRepoUrl.trim() && !initLoading) {
                      handleInitRepo();
                    }
                  }}
                  disabled={initLoading}
                  className="flex-1 px-4 py-3 rounded-lg border border-border bg-card text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                />
                {initRepoUrl.trim() && (
                  <button
                    onClick={handleInitRepo}
                    disabled={initLoading}
                    className="p-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Initialize repository"
                  >
                    {initLoading ? (
                      <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
              {initError && (
                <p className="mt-3 text-sm text-red-500">{initError}</p>
              )}
            </div>
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
                        className="px-6 py-4 text-left text-sm font-semibold text-foreground"
                      >
                        <div className="flex items-center gap-3">
                          <button
                            className="flex items-center cursor-pointer hover:text-primary transition-colors"
                            onClick={() => handleSort("name")}
                          >
                            Repository
                            <SortIcon field="name" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowOnboardModal(true)}
                            className="inline-flex items-center gap-1 bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white px-2 py-1 rounded text-xs font-medium transition-all"
                          >
                            <span>+</span> Onboard
                          </button>
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
                          className="hover:bg-accent transition-colors cursor-pointer"
                          onClick={() => navigate(`/repos/${repo.name}`)}
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
                            <div className="inline-flex items-center gap-2">
                              <button
                                onClick={(e) => handleRepairRepo(repo.name, e)}
                                disabled={actionLoading === repo.name}
                                className="p-1.5 rounded hover:bg-amber-500/10 text-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Repair - clean up orphaned workers"
                              >
                                {actionLoading === repo.name ? (
                                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                  </svg>
                                ) : (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                                  </svg>
                                )}
                              </button>
                              <button
                                onClick={(e) => handleDeleteRepo(repo.name, e)}
                                disabled={actionLoading === repo.name}
                                className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Remove repository"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 6h18"/>
                                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                                  <line x1="10" y1="11" x2="10" y2="17"/>
                                  <line x1="14" y1="11" x2="14" y2="17"/>
                                </svg>
                              </button>
                            </div>
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
            <Link to="/metrics" className="hover:text-primary underline">
              Metrics
            </Link>
            {" · "}
            <Link to="/status" className="hover:text-primary underline">
              System Status
            </Link>
          </p>
        </footer>
      </div>

      {/* Onboard Repository Modal */}
      {showOnboardModal && (
        <OnboardRepoModal
          onClose={() => setShowOnboardModal(false)}
          onSuccess={() => {
            setShowOnboardModal(false);
            fetchRepos();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboard Repository Modal
// ---------------------------------------------------------------------------

interface OnboardRepoModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function OnboardRepoModal({ onClose, onSuccess }: OnboardRepoModalProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!repoUrl.trim()) {
      setError("Please enter a repository URL");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: repoUrl.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to onboard repository");
    } finally {
      setIsSubmitting(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}
      onClick={() => !isSubmitting && onClose()}
      role="presentation"
    >
      <div
        className="relative w-full max-w-md rounded-xl border border-border bg-card shadow-2xl mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-xl bg-gradient-to-r from-amber-600 to-orange-500 px-6 py-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <span>📦</span> Onboard Repository
          </h2>
          <button
            type="button"
            className="text-white/70 hover:text-white transition-colors disabled:opacity-40"
            onClick={onClose}
            disabled={isSubmitting}
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="repo-url" className="block text-sm font-medium text-foreground mb-1">
              Repository URL
            </label>
            <input
              id="repo-url"
              type="text"
              placeholder="https://github.com/org/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              disabled={isSubmitting || success}
              className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground placeholder-muted-foreground focus:ring-2 focus:ring-ring focus:border-ring outline-none disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Enter the full URL to a GitHub repository
            </p>
          </div>

          {/* Status messages */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm bg-destructive/10 text-destructive">
              <span>❌</span>
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm bg-chart-2/10 text-chart-2">
              <span>✅</span>
              <span>Repository onboarded successfully!</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            {success ? (
              <button
                type="button"
                className="rounded-lg bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 px-5 py-2 text-sm font-medium text-white transition-all"
                onClick={onSuccess}
              >
                Done
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors disabled:opacity-40"
                  onClick={onClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 px-5 py-2 text-sm font-medium text-white transition-all disabled:opacity-50 flex items-center gap-2"
                  disabled={isSubmitting || !repoUrl.trim()}
                >
                  {isSubmitting && (
                    <svg className="animate-spin" style={{ width: '16px', height: '16px' }} viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {isSubmitting ? "Onboarding..." : "🚀 Onboard"}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
