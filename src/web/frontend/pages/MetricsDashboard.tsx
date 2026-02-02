/**
 * Metrics Dashboard — analytics page for the Cocoa Board.
 *
 * Displays four chart panels:
 *   (a) Worker Throughput — BarChart of tasks/hour over last 24h
 *   (b) PR Cycle Time — LineChart of avg open-to-merge time
 *   (c) CI Success Rate — PieChart pass vs fail
 *   (d) Token Usage — BarChart by model
 *
 * Fetches data from GET /api/v1/metrics on mount and auto-refreshes
 * every 30 seconds.
 *
 * TailwindCSS cocoa theme:
 *   Dark chocolate  #3B1F0B  (headings)
 *   Cream           #FFF8E7  (backgrounds)
 *   Caramel         #C68B3C  (accents, chart fills)
 *   Milk chocolate  #7B3F00  (section labels, chart strokes)
 */

import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../../components/ThemeToggle.js";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// ---------------------------------------------------------------------------
// Types (matching API response from /api/v1/metrics)
// ---------------------------------------------------------------------------

interface WorkerThroughputBucket {
  hour: string;
  count: number;
}

interface PRCycleTimePoint {
  date: string;
  avgHours: number;
}

interface CISuccessRateSlice {
  status: string;
  count: number;
}

interface TokenUsageBucket {
  model: string;
  tokens: number;
}

interface MetricsSummary {
  totalWorkers: number;
  activeWorkers: number;
  completedWorkers: number;
  failedWorkers: number;
  totalPRs: number;
  totalRepos: number;
  avgCompletionTimeHours: number | null;
  successRate: number;
}

interface MetricsData {
  summary: MetricsSummary;
  workerThroughput: WorkerThroughputBucket[];
  prCycleTime: PRCycleTimePoint[];
  ciSuccessRate: CISuccessRateSlice[];
  tokenUsage: TokenUsageBucket[];
}

// ---------------------------------------------------------------------------
// Constants — cocoa palette for charts
// ---------------------------------------------------------------------------

const COLORS = {
  darkChocolate: "#3B1F0B",
  cream: "#FFF8E7",
  caramel: "#C68B3C",
  milkChocolate: "#7B3F00",
};

const PIE_COLORS = ["#C68B3C", "#7B3F00"];

const REFRESH_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Stat card component
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  icon,
  trend,
  className = "",
}: {
  label: string;
  value: string | number;
  icon: string;
  trend?: "up" | "down" | "neutral";
  className?: string;
}): React.ReactElement {
  const trendColors = {
    up: "text-green-600",
    down: "text-red-600",
    neutral: "text-muted-foreground",
  };

  return (
    <div className={`rounded-lg border border-border bg-card p-4 shadow-sm ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        {trend && (
          <span className={`text-sm ${trendColors[trend]}`}>
            {trend === "up" ? "↑" : trend === "down" ? "↓" : "—"}
          </span>
        )}
      </div>
      <div className="mt-2">
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart panel wrapper
// ---------------------------------------------------------------------------

function ChartPanel({
  title,
  children,
  isEmpty,
  emptyMessage = "No data available",
}: {
  title: string;
  children: React.ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="h-64">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="text-4xl mb-2 opacity-50">📊</div>
              <p className="text-muted-foreground text-sm">{emptyMessage}</p>
            </div>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual chart components
// ---------------------------------------------------------------------------

function WorkerThroughputChart({
  data,
}: {
  data: WorkerThroughputBucket[];
}): React.ReactElement {
  const formatted = data.map((d) => ({
    ...d,
    label: d.hour.slice(11, 16),
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={formatted}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: COLORS.darkChocolate }}
          interval="preserveStartEnd"
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: COLORS.darkChocolate }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: COLORS.cream,
            borderColor: COLORS.caramel,
          }}
        />
        <Bar dataKey="count" name="Tasks" fill={COLORS.caramel} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function PRCycleTimeChart({
  data,
}: {
  data: PRCycleTimePoint[];
}): React.ReactElement {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: COLORS.darkChocolate }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: COLORS.darkChocolate }}
          label={{
            value: "Hours",
            angle: -90,
            position: "insideLeft",
            style: { fontSize: 11, fill: COLORS.milkChocolate },
          }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: COLORS.cream,
            borderColor: COLORS.caramel,
          }}
        />
        <Line
          type="monotone"
          dataKey="avgHours"
          name="Avg Hours"
          stroke={COLORS.milkChocolate}
          strokeWidth={2}
          dot={{ fill: COLORS.caramel, r: 4 }}
          activeDot={{ r: 6, fill: COLORS.caramel }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function CISuccessRateChart({
  data,
}: {
  data: CISuccessRateSlice[];
}): React.ReactElement {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="status"
          cx="50%"
          cy="50%"
          outerRadius={90}
          label={(props: any) =>
            `${props.status}: ${props.count}`
          }
        >
          {data.map((_entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={PIE_COLORS[index % PIE_COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: COLORS.cream,
            borderColor: COLORS.caramel,
          }}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

function TokenUsageChart({
  data,
}: {
  data: TokenUsageBucket[];
}): React.ReactElement {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fontSize: 11, fill: COLORS.darkChocolate }}
        />
        <YAxis
          type="category"
          dataKey="model"
          tick={{ fontSize: 10, fill: COLORS.darkChocolate }}
          width={120}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: COLORS.cream,
            borderColor: COLORS.caramel,
          }}
        />
        <Bar
          dataKey="tokens"
          name="Tasks"
          fill={COLORS.milkChocolate}
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MetricsDashboard(): React.ReactElement {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/metrics");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: MetricsData = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">📊</div>
          <p className="text-muted-foreground text-lg">Loading metrics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <div className="absolute top-4 right-4 z-10">
          <ThemeToggle />
        </div>
        <div className="container mx-auto px-4 py-8">
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6 text-center">
            <div className="text-4xl mb-4">⚠️</div>
            <h2 className="text-xl font-bold text-destructive mb-2">Failed to Load Metrics</h2>
            <p className="text-muted-foreground mb-4">{error}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                fetchMetrics();
              }}
              className="inline-flex items-center gap-2 bg-destructive text-destructive-foreground px-4 py-2 rounded-lg font-medium hover:bg-destructive/90 transition-colors"
            >
              🔄 Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return <div />;

  const { summary } = data;
  const hasWorkerData = data.workerThroughput.some((d) => d.count > 0);
  const hasPRData = data.prCycleTime.length > 0;
  const hasCIData = data.ciSuccessRate.some((d) => d.count > 0);
  const hasTokenData = data.tokenUsage.length > 0;

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
            <span className="text-foreground font-medium">Metrics</span>
          </div>

          {/* Title */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="text-4xl">📊</div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Metrics Dashboard</h1>
                <p className="text-muted-foreground">System performance and analytics</p>
              </div>
            </div>
            <button
              onClick={() => {
                setLoading(true);
                fetchMetrics();
              }}
              className="inline-flex items-center gap-2 border border-border hover:border-primary text-foreground px-4 py-2 rounded-lg font-medium transition-colors"
            >
              🔄 Refresh
            </button>
          </div>

          {/* Auto-refresh note */}
          <p className="mt-4 text-sm text-muted-foreground">
            Auto-refreshes every 30 seconds
          </p>
        </header>

        {/* Summary Stats */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-4">Overview</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
            <StatCard
              label="Total Workers"
              value={summary.totalWorkers}
              icon="🍬"
            />
            <StatCard
              label="Active"
              value={summary.activeWorkers}
              icon="⚡"
              trend={summary.activeWorkers > 0 ? "up" : "neutral"}
            />
            <StatCard
              label="Completed"
              value={summary.completedWorkers}
              icon="✅"
              trend="up"
            />
            <StatCard
              label="Failed"
              value={summary.failedWorkers}
              icon="❌"
              trend={summary.failedWorkers > 0 ? "down" : "neutral"}
            />
            <StatCard
              label="PRs Created"
              value={summary.totalPRs}
              icon="🔀"
            />
            <StatCard
              label="Repositories"
              value={summary.totalRepos}
              icon="📦"
            />
            <StatCard
              label="Avg Time (hrs)"
              value={summary.avgCompletionTimeHours ?? "—"}
              icon="⏱️"
            />
            <StatCard
              label="Success Rate"
              value={`${summary.successRate}%`}
              icon="📈"
              trend={summary.successRate >= 80 ? "up" : summary.successRate >= 50 ? "neutral" : "down"}
            />
          </div>
        </section>

        {/* Charts Grid */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Charts</h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartPanel
              title="Worker Throughput (last 24h)"
              isEmpty={!hasWorkerData}
              emptyMessage="No completed tasks in the last 24 hours"
            >
              <WorkerThroughputChart data={data.workerThroughput} />
            </ChartPanel>

            <ChartPanel
              title="PR Cycle Time"
              isEmpty={!hasPRData}
              emptyMessage="No PR cycle time data available"
            >
              <PRCycleTimeChart data={data.prCycleTime} />
            </ChartPanel>

            <ChartPanel
              title="CI Success Rate"
              isEmpty={!hasCIData}
              emptyMessage="No completed or failed tasks yet"
            >
              <CISuccessRateChart data={data.ciSuccessRate} />
            </ChartPanel>

            <ChartPanel
              title="Tasks by Model"
              isEmpty={!hasTokenData}
              emptyMessage="No model usage data available"
            >
              <TokenUsageChart data={data.tokenUsage} />
            </ChartPanel>
          </div>
        </section>
      </div>
    </div>
  );
}

export default MetricsDashboard;
