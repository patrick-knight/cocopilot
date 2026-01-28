/**
 * Wave Report Page — displays wave completion reports.
 *
 * Follows MetricsDashboard pattern:
 *   - useState for data/loading/error + wave selector state
 *   - useEffect to fetch from /api/v1/waves/reports
 *   - Summary cards, charts via Recharts, recommendations list
 *   - Generate report button (POST)
 *
 * TailwindCSS cocoa theme:
 *   Dark chocolate  #3B1F0B  (headings)
 *   Cream           #FFF8E7  (backgrounds)
 *   Caramel         #C68B3C  (accents, chart fills)
 *   Milk chocolate  #7B3F00  (section labels, chart strokes)
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ---------------------------------------------------------------------------
// Types (matching API response)
// ---------------------------------------------------------------------------

interface WaveReportSummary {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalPRs: number;
  mergedPRs: number;
}

interface WaveTaskSummary {
  workerName: string;
  task: string;
  status: string;
  durationMs?: number;
}

interface WaveTimeSummary {
  totalDurationMs: number;
  workerSecondsTotal: number;
  avgTaskDurationMs: number;
  peakConcurrency: number;
}

interface TestCoverageDelta {
  beforePercent: number;
  afterPercent: number;
  deltaPercent: number;
  newTestFiles: number;
  newTestCases: number;
}

interface SecurityPostureChange {
  scansRun: number;
  newVulnerabilities: number;
  resolvedVulnerabilities: number;
  netChange: number;
  auditPassed: boolean;
}

interface WaveRecommendation {
  id: string;
  severity: "info" | "warning" | "critical";
  category: string;
  title: string;
  description: string;
}

interface WaveReport {
  id: string;
  waveId: string;
  waveName: string;
  generatedAt: string;
  status: string;
  summary: WaveReportSummary;
  tasks: WaveTaskSummary[];
  testCoverage: TestCoverageDelta;
  security: SecurityPostureChange;
  time: WaveTimeSummary;
  recommendations: WaveRecommendation[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLORS = {
  darkChocolate: "#3B1F0B",
  cream: "#FFF8E7",
  caramel: "#C68B3C",
  milkChocolate: "#7B3F00",
};

const STATUS_COLORS: Record<string, string> = {
  completed: "#16a34a",
  failed: "#dc2626",
  working: "#C68B3C",
  starting: "#6b7280",
};

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  info: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  warning: { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200" },
  critical: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
};

const WAVE_IDS = ["wave-1", "wave-2", "wave-3", "wave-4", "wave-5", "wave-6"];

const REFRESH_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-[#C68B3C]/20 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-[#7B3F00]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-[#3B1F0B]">{value}</p>
      {detail && (
        <p className="mt-0.5 text-xs text-gray-500">{detail}</p>
      )}
    </div>
  );
}

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

function TaskOutcomesChart({
  tasks,
}: {
  tasks: WaveTaskSummary[];
}): React.ReactElement {
  const statusCounts: Record<string, number> = {};
  for (const t of tasks) {
    statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
  }
  const data = Object.entries(statusCounts).map(([status, count]) => ({
    status,
    count,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis
          dataKey="status"
          tick={{ fontSize: 11, fill: COLORS.darkChocolate }}
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
        <Bar dataKey="count" name="Tasks" radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={STATUS_COLORS[entry.status] ?? COLORS.caramel}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function TimeBreakdownChart({
  time,
}: {
  time: WaveTimeSummary;
}): React.ReactElement {
  const data = [
    {
      label: "Total Duration",
      minutes: Math.round(time.totalDurationMs / 60_000),
    },
    {
      label: "Worker Time",
      minutes: Math.round(time.workerSecondsTotal / 60),
    },
    {
      label: "Avg Task",
      minutes: Math.round(time.avgTaskDurationMs / 60_000),
    },
  ];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: COLORS.darkChocolate }}
          label={{
            value: "Minutes",
            position: "insideBottom",
            offset: -5,
            style: { fontSize: 11, fill: COLORS.milkChocolate },
          }}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 11, fill: COLORS.darkChocolate }}
          width={120}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: COLORS.cream,
            borderColor: COLORS.caramel,
          }}
        />
        <Bar
          dataKey="minutes"
          name="Minutes"
          fill={COLORS.milkChocolate}
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function RecommendationsList({
  recommendations,
}: {
  recommendations: WaveRecommendation[];
}): React.ReactElement {
  if (recommendations.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No recommendations — everything looks good.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {recommendations.map((rec) => {
        const style = SEVERITY_STYLES[rec.severity] ?? SEVERITY_STYLES.info;
        return (
          <li
            key={rec.id}
            className={`rounded-lg border p-3 ${style.bg} ${style.border}`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase ${style.text}`}
              >
                {rec.severity}
              </span>
              <span className="text-xs text-gray-500">{rec.category}</span>
            </div>
            <p className={`mt-1 text-sm font-medium ${style.text}`}>
              {rec.title}
            </p>
            <p className="mt-0.5 text-sm text-gray-600">{rec.description}</p>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WaveReportPage(): React.ReactElement {
  const [reports, setReports] = useState<WaveReport[]>([]);
  const [selectedWave, setSelectedWave] = useState<string>("wave-1");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/waves/reports");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: WaveReport[] = await res.json();
      setReports(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
    const interval = setInterval(fetchReports, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchReports]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/v1/waves/${selectedWave}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchReports();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate report",
      );
    } finally {
      setGenerating(false);
    }
  };

  // Find report for selected wave
  const activeReport = reports.find((r) => r.waveId === selectedWave);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <span className="text-sm text-gray-400">Loading wave reports...</span>
      </div>
    );
  }

  if (error && reports.length === 0) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            Failed to load wave reports: {error}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchReports();
            }}
            className="mt-2 rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#3B1F0B]">Wave Reports</h1>
          <p className="mt-1 text-sm text-gray-500">
            Comprehensive wave completion analysis
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedWave}
            onChange={(e) => setSelectedWave(e.target.value)}
            className="rounded border border-[#C68B3C]/30 bg-white px-3 py-2 text-sm text-[#3B1F0B] focus:border-[#C68B3C] focus:outline-none"
          >
            {WAVE_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="rounded bg-[#C68B3C] px-4 py-2 text-sm font-medium text-white hover:bg-[#7B3F00] disabled:opacity-50"
          >
            {generating ? "Generating..." : "Generate Report"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {!activeReport ? (
        <div className="rounded-lg border border-[#C68B3C]/20 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">
            No report found for {selectedWave}. Click &quot;Generate Report&quot; to create one.
          </p>
        </div>
      ) : (
        <>
          {/* Status + wave name */}
          <div className="mb-6 flex items-center gap-3">
            <h2 className="text-lg font-semibold text-[#3B1F0B]">
              {activeReport.waveName}
            </h2>
            <span
              className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${
                activeReport.status === "completed"
                  ? "bg-green-100 text-green-700"
                  : activeReport.status === "failed"
                    ? "bg-red-100 text-red-700"
                    : activeReport.status === "partial"
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-gray-100 text-gray-700"
              }`}
            >
              {activeReport.status}
            </span>
            <span className="text-xs text-gray-400">
              Generated {new Date(activeReport.generatedAt).toLocaleString()}
            </span>
          </div>

          {/* Summary cards */}
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryCard
              label="Tasks"
              value={`${activeReport.summary.completedTasks}/${activeReport.summary.totalTasks}`}
              detail={`${activeReport.summary.failedTasks} failed`}
            />
            <SummaryCard
              label="Pull Requests"
              value={`${activeReport.summary.mergedPRs}/${activeReport.summary.totalPRs}`}
              detail="merged"
            />
            <SummaryCard
              label="Coverage Delta"
              value={`${activeReport.testCoverage.deltaPercent >= 0 ? "+" : ""}${activeReport.testCoverage.deltaPercent}%`}
              detail={`${activeReport.testCoverage.beforePercent}% → ${activeReport.testCoverage.afterPercent}%`}
            />
            <SummaryCard
              label="Security"
              value={activeReport.security.auditPassed ? "Passed" : "Failed"}
              detail={`${activeReport.security.scansRun} scans, net ${activeReport.security.netChange >= 0 ? "+" : ""}${activeReport.security.netChange}`}
            />
          </div>

          {/* Charts */}
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartPanel title="Task Outcomes">
              <TaskOutcomesChart tasks={activeReport.tasks} />
            </ChartPanel>
            <ChartPanel title="Time Breakdown">
              <TimeBreakdownChart time={activeReport.time} />
            </ChartPanel>
          </div>

          {/* Recommendations */}
          <div className="rounded-lg border border-[#C68B3C]/20 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#7B3F00]">
              Recommendations
            </h2>
            <RecommendationsList
              recommendations={activeReport.recommendations}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default WaveReportPage;
