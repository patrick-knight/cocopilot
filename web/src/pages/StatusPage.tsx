/**
 * StatusPage - System health and status dashboard
 */

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../../../src/web/components/ThemeToggle.js";

interface StatusData {
  daemon: {
    up: boolean;
    status: string;
    pid: number | null;
    uptimeSeconds: number | null;
    startedAt: string | null;
  };
  redis: {
    connected: boolean;
  };
  github: {
    authenticated: boolean;
    user: string | null;
    error: string | null;
  };
  copilot: {
    installed: boolean;
    version: string | null;
    error: string | null;
  };
  workers: {
    total: number;
    byStatus: Record<string, number>;
  };
  repositories: number;
  version: string;
}

function formatUptime(seconds: number | null): string {
  if (seconds === null) return "N/A";
  
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(" ");
}

export function StatusPage(): React.ReactElement {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/v1/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">🍫</div>
          <p className="text-muted-foreground text-lg">Checking system health...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar with theme toggle */}
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-8">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <Link to="/" className="hover:text-primary transition-colors flex items-center gap-1">
              <span>🍫</span>
              <span>Cocoa Board</span>
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">System Status</span>
          </div>

          {/* Title */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="text-4xl">🏥</div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">System Status</h1>
                <p className="text-muted-foreground">Health check and diagnostics</p>
              </div>
            </div>
            <button
              onClick={fetchStatus}
              className="inline-flex items-center gap-2 border border-border hover:border-primary text-foreground px-4 py-2 rounded-lg font-medium transition-colors"
            >
              🔄 Refresh
            </button>
          </div>

          {/* Last updated */}
          {lastUpdated && (
            <p className="mt-4 text-sm text-muted-foreground">
              Last updated: {lastUpdated.toLocaleTimeString()} (auto-refreshes every 5s)
            </p>
          )}
        </header>

        {error ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6 text-center">
            <div className="text-4xl mb-4">⚠️</div>
            <h2 className="text-xl font-bold text-destructive mb-2">Connection Error</h2>
            <p className="text-muted-foreground">{error}</p>
          </div>
        ) : status ? (
          <div className="space-y-6">
            {/* Overall Health Banner */}
            {(() => {
              const allGood = status.daemon.up && status.redis.connected && status.github?.authenticated && status.copilot?.installed;
              const hasWarnings = !status.github?.authenticated || !status.copilot?.installed;
              const hasCritical = !status.daemon.up || !status.redis.connected;
              
              return (
                <div className={`rounded-lg p-6 ${
                  allGood 
                    ? "bg-chart-2/10 border border-chart-2/20" 
                    : hasCritical 
                      ? "bg-destructive/10 border border-destructive/20"
                      : "bg-amber-500/10 border border-amber-500/20"
                }`}>
                  <div className="flex items-center gap-4">
                    <div className="text-5xl">
                      {allGood ? "✅" : hasCritical ? "❌" : "⚠️"}
                    </div>
                    <div>
                      <h2 className={`text-2xl font-bold ${
                        allGood 
                          ? "text-chart-2" 
                          : hasCritical 
                            ? "text-destructive"
                            : "text-amber-500"
                      }`}>
                        {allGood 
                          ? "All Systems Operational" 
                          : hasCritical 
                            ? "System Issues Detected"
                            : "Setup Incomplete"}
                      </h2>
                      <p className="text-muted-foreground">
                        CoCoPilot v{status.version || "0.1.0"}
                        {hasWarnings && !hasCritical && " · Some optional components need setup"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Status Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Daemon Status */}
              <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
                <div className="bg-muted/50 px-4 py-3 border-b border-border">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <span>🤖</span> Concher Daemon
                  </h3>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${status.daemon.up ? "bg-chart-2/20 text-chart-2" : "bg-destructive/20 text-destructive"}`}>
                      <span className={`inline-block h-2 w-2 rounded-full ${status.daemon.up ? "bg-chart-2" : "bg-destructive"}`} />
                      {status.daemon.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">PID</span>
                    <span className="font-mono text-foreground">{status.daemon.pid ?? "N/A"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Uptime</span>
                    <span className="font-mono text-foreground">{formatUptime(status.daemon.uptimeSeconds)}</span>
                  </div>
                  {status.daemon.startedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Started</span>
                      <span className="text-sm text-foreground">{new Date(status.daemon.startedAt).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Redis Status */}
              <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
                <div className="bg-muted/50 px-4 py-3 border-b border-border">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <span>🔴</span> Redis (Ganache Bus)
                  </h3>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Connection</span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${status.redis.connected ? "bg-chart-2/20 text-chart-2" : "bg-destructive/20 text-destructive"}`}>
                      <span className={`inline-block h-2 w-2 rounded-full ${status.redis.connected ? "bg-chart-2" : "bg-destructive"}`} />
                      {status.redis.connected ? "Connected" : "Disconnected"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Message broker for real-time agent communication
                  </p>
                </div>
              </div>

              {/* GitHub Auth Status */}
              <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
                <div className="bg-muted/50 px-4 py-3 border-b border-border">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <span>🐙</span> GitHub Authentication
                  </h3>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${status.github?.authenticated ? "bg-chart-2/20 text-chart-2" : "bg-amber-500/20 text-amber-500"}`}>
                      <span className={`inline-block h-2 w-2 rounded-full ${status.github?.authenticated ? "bg-chart-2" : "bg-amber-500"}`} />
                      {status.github?.authenticated ? "Authenticated" : "Not Logged In"}
                    </span>
                  </div>
                  {status.github?.authenticated && status.github.user && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">User</span>
                      <span className="font-mono text-foreground">{status.github.user}</span>
                    </div>
                  )}
                  {!status.github?.authenticated && (
                    <p className="text-sm text-amber-500">
                      Run <code className="bg-muted px-1 rounded">gh auth login</code> to authenticate
                    </p>
                  )}
                </div>
              </div>

              {/* CoCo CLI Status */}
              <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
                <div className="bg-muted/50 px-4 py-3 border-b border-border">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <span>🍫</span> CoCo CLI
                  </h3>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${status.copilot?.installed ? "bg-chart-2/20 text-chart-2" : "bg-amber-500/20 text-amber-500"}`}>
                      <span className={`inline-block h-2 w-2 rounded-full ${status.copilot?.installed ? "bg-chart-2" : "bg-amber-500"}`} />
                      {status.copilot?.installed ? "Installed" : "Not Found"}
                    </span>
                  </div>
                  {status.copilot?.installed && status.copilot.version && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Version</span>
                      <span className="font-mono text-foreground text-sm">{status.copilot.version}</span>
                    </div>
                  )}
                  {!status.copilot?.installed && (
                    <p className="text-sm text-amber-500">
                      Run <code className="bg-muted px-1 rounded">npm install -g cocopilot</code> to install
                    </p>
                  )}
                </div>
              </div>

              {/* Repositories */}
              <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
                <div className="bg-muted/50 px-4 py-3 border-b border-border">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <span>📦</span> Repositories
                  </h3>
                </div>
                <div className="p-4">
                  <div className="text-center">
                    <div className="text-4xl font-bold text-foreground">{status.repositories}</div>
                    <p className="text-sm text-muted-foreground mt-1">tracked repositories</p>
                  </div>
                  <Link
                    to="/"
                    className="mt-4 block text-center text-sm text-primary hover:underline"
                  >
                    View all →
                  </Link>
                </div>
              </div>
            </div>

            {/* Workers Section */}
            <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
              <div className="bg-muted/50 px-4 py-3 border-b border-border">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <span>🍬</span> Workers (Truffles)
                </h3>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-center gap-8 mb-6">
                  <div className="text-center">
                    <div className="text-5xl font-bold text-foreground">{status.workers.total}</div>
                    <p className="text-sm text-muted-foreground mt-1">total workers</p>
                  </div>
                </div>
                
                {Object.keys(status.workers.byStatus).length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {Object.entries(status.workers.byStatus).map(([workerStatus, count]) => {
                      const statusConfig: Record<string, { color: string; icon: string }> = {
                        working: { color: "text-chart-2 bg-chart-2/20", icon: "⚡" },
                        starting: { color: "text-chart-1 bg-chart-1/20", icon: "🚀" },
                        completed: { color: "text-chart-2 bg-chart-2/20", icon: "✅" },
                        failed: { color: "text-destructive bg-destructive/20", icon: "❌" },
                        stuck: { color: "text-chart-4 bg-chart-4/20", icon: "⚠️" },
                        terminated: { color: "text-muted-foreground bg-muted", icon: "🛑" },
                      };
                      const config = statusConfig[workerStatus] ?? { color: "text-muted-foreground bg-muted", icon: "❓" };
                      
                      return (
                        <div key={workerStatus} className={`rounded-lg p-3 ${config.color.split(" ")[1]}`}>
                          <div className="flex items-center gap-2">
                            <span>{config.icon}</span>
                            <span className={`font-semibold ${config.color.split(" ")[0]}`}>{count}</span>
                          </div>
                          <p className="text-xs text-muted-foreground capitalize mt-1">{workerStatus}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground">No workers have been spawned yet.</p>
                )}
              </div>
            </div>

            {/* Raw JSON (collapsible) */}
            <details className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
              <summary className="px-4 py-3 bg-muted/50 cursor-pointer hover:bg-muted transition-colors">
                <span className="text-lg font-semibold text-foreground">📋 Raw JSON Response</span>
              </summary>
              <div className="p-4">
                <pre className="bg-muted rounded-lg p-4 overflow-x-auto text-sm font-mono text-foreground">
                  {JSON.stringify(status, null, 2)}
                </pre>
              </div>
            </details>
          </div>
        ) : null}

        {/* Footer */}
        <footer className="mt-16 text-center text-muted-foreground text-sm">
          <p>CoCoPilot v0.1.0 · Collaborative Copilot Orchestration Platform</p>
          <p className="mt-1">
            <a
              href="https://github.com/patrick-knight/cocopilot"
              className="hover:text-primary underline"
              target="_blank"
              rel="noopener noreferrer"
            >
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
    </div>
  );
}

export default StatusPage;
