/**
 * Tests for the MetricsDashboard page component.
 *
 * @jest-environment jsdom
 */

import React from "react";

// ---------------------------------------------------------------------------
// Mock recharts before importing the component.
// Recharts relies on browser APIs (ResizeObserver, SVG) not available in
// jsdom, so we stub the components to simple div renderers.
// ---------------------------------------------------------------------------

jest.mock("recharts", () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => <div data-testid="bar" />,
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => <div data-testid="line" />,
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie">{children}</div>
  ),
  Cell: () => <div data-testid="cell" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
}));

// Import after mocking
import { MetricsDashboard } from "./MetricsDashboard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_METRICS = {
  workerThroughput: [
    { hour: "2026-01-15T10:00", count: 2 },
    { hour: "2026-01-15T11:00", count: 1 },
  ],
  prCycleTime: [{ date: "2026-01-15", avgHours: 3 }],
  ciSuccessRate: [
    { status: "pass", count: 5 },
    { status: "fail", count: 1 },
  ],
  tokenUsage: [
    { model: "claude-sonnet-4-5", tokens: 10 },
    { model: "claude-opus-4-5", tokens: 3 },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MetricsDashboard", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("renders loading state initially", () => {
    // fetch that never resolves
    global.fetch = jest.fn(
      () => new Promise<Response>(() => {}),
    ) as jest.Mock;

    // Use react-dom directly since we don't have @testing-library/react
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { createRoot } = require("react-dom/client");
    const root = createRoot(container);

    // Use act to handle state updates
    const { act } = require("react");
    act(() => {
      root.render(React.createElement(MetricsDashboard));
    });

    expect(container.textContent).toContain("Loading metrics");

    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("renders error state on fetch failure", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    const container = document.createElement("div");
    document.body.appendChild(container);

    const { createRoot } = require("react-dom/client");
    const root = createRoot(container);
    const { act } = require("react");

    await act(async () => {
      root.render(React.createElement(MetricsDashboard));
    });

    expect(container.textContent).toContain("Failed to load metrics");
    expect(container.textContent).toContain("Network error");

    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("renders all four chart panels on success", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_METRICS),
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    const { createRoot } = require("react-dom/client");
    const root = createRoot(container);
    const { act } = require("react");

    await act(async () => {
      root.render(React.createElement(MetricsDashboard));
    });

    expect(container.textContent).toContain("Metrics Dashboard");
    expect(container.textContent).toContain("Worker Throughput");
    expect(container.textContent).toContain("PR Cycle Time");
    expect(container.textContent).toContain("CI Success Rate");
    expect(container.textContent).toContain("Token Usage by Model");

    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("renders error state on non-ok HTTP response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    const { createRoot } = require("react-dom/client");
    const root = createRoot(container);
    const { act } = require("react");

    await act(async () => {
      root.render(React.createElement(MetricsDashboard));
    });

    expect(container.textContent).toContain("Failed to load metrics");
    expect(container.textContent).toContain("HTTP 500");

    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });
});
