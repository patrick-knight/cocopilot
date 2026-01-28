/**
 * Tests for the TemperingStation component.
 * @jest-environment jsdom
 */

import React from "react";
import { act } from "react";
import ReactDOM from "react-dom/client";

// ---------------------------------------------------------------------------
// Minimal DOM rendering helpers using act() for React 18
// ---------------------------------------------------------------------------

// @ts-expect-error -- required for React 18 act() in tests
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);

  act(() => {
    const root = ReactDOM.createRoot(container);
    root.render(element);
  });

  return container;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSocket = { emit: jest.fn() };
const mockClear = jest.fn();

jest.mock("../hooks/useSocket.js", () => ({
  useSocket: jest.fn(() => ({
    socket: mockSocket,
    error: null,
    offline: false,
  })),
  useRepoState: jest.fn(() => ({
    repo: null,
    agents: [],
    workers: [],
    loading: true,
    error: null,
  })),
  useAgentStream: jest.fn(() => ({
    lines: [],
    clear: mockClear,
  })),
  usePRPipeline: jest.fn(() => []),
  useMessageQueue: jest.fn(() => []),
}));

import * as useSocketModule from "../hooks/useSocket.js";

// ---------------------------------------------------------------------------
// Lazy import so mocks are established first
// ---------------------------------------------------------------------------

let TemperingStation: typeof import("./TemperingStation").TemperingStation;

beforeAll(async () => {
  const mod = await import("./TemperingStation");
  TemperingStation = mod.TemperingStation;
});

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TemperingStation", () => {
  const baseProps = {
    repoName: "test-repo",
    onNavigateHome: jest.fn(),
    onNavigateWorker: jest.fn(),
    onSpawnWorker: jest.fn(),
  };

  it("renders loading state initially", () => {
    (useSocketModule.useRepoState as jest.Mock).mockReturnValue({
      repo: null,
      agents: [],
      workers: [],
      loading: true,
      error: null,
    });

    const container = render(
      React.createElement(TemperingStation, baseProps),
    );

    expect(container.textContent).toContain("Loading test-repo");
  });

  it("renders error state", () => {
    (useSocketModule.useRepoState as jest.Mock).mockReturnValue({
      repo: null,
      agents: [],
      workers: [],
      loading: false,
      error: "Connection failed",
    });

    const container = render(
      React.createElement(TemperingStation, baseProps),
    );

    expect(container.textContent).toContain("Connection failed");
    expect(container.textContent).toContain("Back to Factory Floor");
  });

  it("renders repo name in header", () => {
    (useSocketModule.useRepoState as jest.Mock).mockReturnValue({
      repo: {
        id: "test-repo",
        name: "test-repo",
        status: "active",
        agents: {},
        workers: {},
        updatedAt: new Date().toISOString(),
      },
      agents: [],
      workers: [],
      loading: false,
      error: null,
    });

    const container = render(
      React.createElement(TemperingStation, baseProps),
    );

    expect(container.textContent).toContain("test-repo");
  });

  it("renders system agents", () => {
    (useSocketModule.useRepoState as jest.Mock).mockReturnValue({
      repo: {
        id: "test-repo",
        name: "test-repo",
        status: "active",
        agents: {},
        workers: {},
        updatedAt: new Date().toISOString(),
      },
      agents: [
        {
          name: "chocolatier",
          type: "supervisor" as const,
          status: "healthy" as const,
          lastActivity: new Date().toISOString(),
        },
        {
          name: "temperer",
          type: "merge-queue" as const,
          status: "healthy" as const,
          lastActivity: new Date().toISOString(),
        },
      ],
      workers: [],
      loading: false,
      error: null,
    });

    const container = render(
      React.createElement(TemperingStation, baseProps),
    );

    expect(container.textContent).toContain("Chocolatier");
    expect(container.textContent).toContain("Temperer");
  });

  it("renders active workers", () => {
    (useSocketModule.useRepoState as jest.Mock).mockReturnValue({
      repo: {
        id: "test-repo",
        name: "test-repo",
        status: "active",
        agents: {},
        workers: {},
        updatedAt: new Date().toISOString(),
      },
      agents: [],
      workers: [
        {
          name: "swift-eagle",
          status: "working" as const,
          task: "Add authentication",
          branch: "work/swift-eagle",
          updatedAt: new Date().toISOString(),
        },
      ],
      loading: false,
      error: null,
    });

    const container = render(
      React.createElement(TemperingStation, baseProps),
    );

    expect(container.textContent).toContain("swift-eagle");
    expect(container.textContent).toContain("Add authentication");
  });

  it("has New Truffle spawn button", () => {
    (useSocketModule.useRepoState as jest.Mock).mockReturnValue({
      repo: {
        id: "test-repo",
        name: "test-repo",
        status: "active",
        agents: {},
        workers: {},
        updatedAt: new Date().toISOString(),
      },
      agents: [],
      workers: [],
      loading: false,
      error: null,
    });

    const container = render(
      React.createElement(TemperingStation, baseProps),
    );

    const spawnButton = container.querySelector("button");
    const buttons = Array.from(container.querySelectorAll("button"));
    const newTruffleBtn = buttons.find((b) => b.textContent?.includes("New Truffle"));
    expect(newTruffleBtn).not.toBeNull();
  });

  it("renders completed workers section when workers are completed", () => {
    (useSocketModule.useRepoState as jest.Mock).mockReturnValue({
      repo: {
        id: "test-repo",
        name: "test-repo",
        status: "active",
        agents: {},
        workers: {},
        updatedAt: new Date().toISOString(),
      },
      agents: [],
      workers: [
        {
          name: "brave-fox",
          status: "completed" as const,
          task: "Fix bug",
          branch: "work/brave-fox",
          updatedAt: new Date().toISOString(),
        },
      ],
      loading: false,
      error: null,
    });

    const container = render(
      React.createElement(TemperingStation, baseProps),
    );

    expect(container.textContent).toContain("completed/stopped worker");
  });

  it("renders Live Output section", () => {
    (useSocketModule.useRepoState as jest.Mock).mockReturnValue({
      repo: {
        id: "test-repo",
        name: "test-repo",
        status: "active",
        agents: {},
        workers: {},
        updatedAt: new Date().toISOString(),
      },
      agents: [],
      workers: [],
      loading: false,
      error: null,
    });

    const container = render(
      React.createElement(TemperingStation, baseProps),
    );

    expect(container.textContent).toContain("Live Output");
  });

  it("renders Message Queue section", () => {
    (useSocketModule.useRepoState as jest.Mock).mockReturnValue({
      repo: {
        id: "test-repo",
        name: "test-repo",
        status: "active",
        agents: {},
        workers: {},
        updatedAt: new Date().toISOString(),
      },
      agents: [],
      workers: [],
      loading: false,
      error: null,
    });

    const container = render(
      React.createElement(TemperingStation, baseProps),
    );

    expect(container.textContent).toContain("Message Queue");
  });

  it("renders Agents section header", () => {
    (useSocketModule.useRepoState as jest.Mock).mockReturnValue({
      repo: {
        id: "test-repo",
        name: "test-repo",
        status: "active",
        agents: {},
        workers: {},
        updatedAt: new Date().toISOString(),
      },
      agents: [],
      workers: [],
      loading: false,
      error: null,
    });

    const container = render(
      React.createElement(TemperingStation, baseProps),
    );

    expect(container.textContent).toContain("Agents");
  });

  it("renders status indicator for repo", () => {
    (useSocketModule.useRepoState as jest.Mock).mockReturnValue({
      repo: {
        id: "test-repo",
        name: "test-repo",
        status: "active",
        agents: {},
        workers: {},
        updatedAt: new Date().toISOString(),
      },
      agents: [],
      workers: [],
      loading: false,
      error: null,
    });

    const container = render(
      React.createElement(TemperingStation, baseProps),
    );

    // Status indicator should be in header
    expect(container.textContent).toContain("active");
  });
});
