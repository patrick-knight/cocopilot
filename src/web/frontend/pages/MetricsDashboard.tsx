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

interface MetricsData {
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
// Chart panel wrapper
// ---------------------------------------------------------------------------

function ChartPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-[#C68B3C]/20 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#7B3F00]">
        {title}
      </h2>
      <div className="h-64">{children}</div>
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
    <ResponsiveContainer width="100%" height="100%">
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
    <ResponsiveContainer width="100%" height="100%">
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
    <ResponsiveContainer width="100%" height="100%">
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
    <ResponsiveContainer width="100%" height="100%">
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
      <div className="flex items-center justify-center p-12">
        <span className="text-sm text-gray-400">Loading metrics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            Failed to load metrics: {error}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchMetrics();
            }}
            className="mt-2 rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return <div />;

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back to Factory Floor
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Metrics Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          System performance and analytics
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartPanel title="Worker Throughput (last 24h)">
          <WorkerThroughputChart data={data.workerThroughput} />
        </ChartPanel>

        <ChartPanel title="PR Cycle Time">
          <PRCycleTimeChart data={data.prCycleTime} />
        </ChartPanel>

        <ChartPanel title="CI Success Rate">
          <CISuccessRateChart data={data.ciSuccessRate} />
        </ChartPanel>

        <ChartPanel title="Token Usage by Model">
          <TokenUsageChart data={data.tokenUsage} />
        </ChartPanel>
      </div>
    </div>
  );
}

export default MetricsDashboard;
