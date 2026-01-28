/**
 * Tests for the FactoryFloor page component.
 *
 * @jest-environment jsdom
 */

import React from "react";
import type { RepositorySummary, ActivityEvent } from "../types.js";

// ---------------------------------------------------------------------------
// Mock socket.io-client before importing the component.
// ---------------------------------------------------------------------------

type SocketCallback = (...args: unknown[]) => void;

const mockSocket = {
  on: jest.fn(),
  emit: jest.fn(),
  disconnect: jest.fn(),
};

jest.mock("socket.io-client", () => ({
  io: jest.fn(() => mockSocket),
}));

// Import after mocking
import { FactoryFloor } from "./FactoryFloor.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockRepo(overrides: Partial<RepositorySummary> = {}): RepositorySummary {
  return {
    id: "repo-1",
    name: "my-app",
    url: "https://github.com/org/my-app",
    health: "healthy",
    status: "active",
    activeWorkerCount: 2,
    stuckWorkerCount: 0,
    pendingPRs: 1,
    lastMerge: new Date().toISOString(),
    ...overrides,
  };
}

function createMockActivity(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "evt-1",
    type: "worker_spawned",
    repository: "my-app",
    description: "Snickers started working on 'Add tests'",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function getSocketHandler(event: string): SocketCallback | undefined {
  const call = mockSocket.on.mock.calls.find(
    (c: [string, SocketCallback]) => c[0] === event,
  );
  return call ? call[1] : undefined;
}

/**
 * Helper to set value on a React controlled input.
 * Native DOM events don't trigger React state updates for controlled inputs,
 * so we need to use the native value setter and dispatch an input event.
 */
function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    input.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype,
    "value",
  )?.set;
  nativeInputValueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderComponent(props: React.ComponentProps<typeof FactoryFloor> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const { createRoot } = require("react-dom/client");
  const root = createRoot(container);
  const { act } = require("react");

  act(() => {
    root.render(React.createElement(FactoryFloor, props));
  });

  return {
    container,
    root,
    act,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FactoryFloor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock socket handlers
    mockSocket.on.mockClear();
    mockSocket.emit.mockClear();
    mockSocket.disconnect.mockClear();
  });

  describe("initial render", () => {
    it("renders the header with CoCoPilot title", () => {
      const { container, cleanup } = renderComponent();

      expect(container.textContent).toContain("CoCoPilot");
      cleanup();
    });

    it("shows disconnected status initially", () => {
      const { container, cleanup } = renderComponent();

      expect(container.textContent).toContain("Disconnected");
      cleanup();
    });

    it("renders 'No repositories' message when empty", () => {
      const { container, cleanup } = renderComponent();

      expect(container.textContent).toContain(
        "No repositories tracked yet. Initialize one to get started.",
      );
      cleanup();
    });

    it("renders 'No recent activity' message when empty", () => {
      const { container, cleanup } = renderComponent();

      expect(container.textContent).toContain("No recent activity.");
      cleanup();
    });

    it("renders initialize repository button", () => {
      const { container, cleanup } = renderComponent();

      const initBtn = container.querySelector('[data-testid="init-repo-btn"]');
      expect(initBtn).not.toBeNull();
      expect(initBtn?.textContent).toContain("Initialize New Repository");
      cleanup();
    });
  });

  describe("socket connection", () => {
    it("shows connected status when socket connects", () => {
      const { container, act, cleanup } = renderComponent();

      const connectHandler = getSocketHandler("connect");
      expect(connectHandler).toBeDefined();

      act(() => {
        connectHandler?.();
      });

      expect(container.textContent).toContain("Connected");
      cleanup();
    });

    it("shows disconnected status when socket disconnects", () => {
      const { container, act, cleanup } = renderComponent();

      // First connect
      const connectHandler = getSocketHandler("connect");
      act(() => {
        connectHandler?.();
      });
      expect(container.textContent).toContain("Connected");

      // Then disconnect
      const disconnectHandler = getSocketHandler("disconnect");
      act(() => {
        disconnectHandler?.();
      });

      expect(container.textContent).toContain("Disconnected");
      cleanup();
    });

    it("disconnects socket on unmount", () => {
      const { cleanup } = renderComponent();

      cleanup();

      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe("repository display", () => {
    it("renders repo cards when repos are added", () => {
      const { container, act, cleanup } = renderComponent();

      const addHandler = getSocketHandler("repo:added");
      const repo = createMockRepo();

      act(() => {
        addHandler?.(repo);
      });

      expect(container.textContent).toContain("my-app");
      expect(container.textContent).toContain("2 workers active");
      expect(container.textContent).toContain("1 PR pending");
      cleanup();
    });

    it("displays singular worker text for 1 worker", () => {
      const { container, act, cleanup } = renderComponent();

      const addHandler = getSocketHandler("repo:added");
      const repo = createMockRepo({ activeWorkerCount: 1 });

      act(() => {
        addHandler?.(repo);
      });

      expect(container.textContent).toContain("1 worker active");
      cleanup();
    });

    it("displays stuck worker count when present", () => {
      const { container, act, cleanup } = renderComponent();

      const addHandler = getSocketHandler("repo:added");
      const repo = createMockRepo({ stuckWorkerCount: 2 });

      act(() => {
        addHandler?.(repo);
      });

      expect(container.textContent).toContain("(2 stuck)");
      cleanup();
    });

    it("shows initializing status for repos being initialized", () => {
      const { container, act, cleanup } = renderComponent();

      const addHandler = getSocketHandler("repo:added");
      const repo = createMockRepo({ status: "initializing" });

      act(() => {
        addHandler?.(repo);
      });

      expect(container.textContent).toContain("initializing...");
      cleanup();
    });

    it("updates repo when repo:updated is received", () => {
      const { container, act, cleanup } = renderComponent();

      const addHandler = getSocketHandler("repo:added");
      const updateHandler = getSocketHandler("repo:updated");
      const repo = createMockRepo();

      act(() => {
        addHandler?.(repo);
      });

      expect(container.textContent).toContain("2 workers active");

      act(() => {
        updateHandler?.({ ...repo, activeWorkerCount: 5 });
      });

      expect(container.textContent).toContain("5 workers active");
      cleanup();
    });

    it("removes repo when repo:removed is received", () => {
      const { container, act, cleanup } = renderComponent();

      const addHandler = getSocketHandler("repo:added");
      const removeHandler = getSocketHandler("repo:removed");
      const repo = createMockRepo();

      act(() => {
        addHandler?.(repo);
      });

      expect(container.textContent).toContain("my-app");

      act(() => {
        removeHandler?.(repo.id);
      });

      expect(container.textContent).not.toContain("my-app");
      expect(container.textContent).toContain("No repositories tracked yet");
      cleanup();
    });

    it("does not add duplicate repos", () => {
      const { container, act, cleanup } = renderComponent();

      const addHandler = getSocketHandler("repo:added");
      const repo = createMockRepo();

      act(() => {
        addHandler?.(repo);
        addHandler?.(repo); // Add same repo twice
      });

      const grid = container.querySelector('[data-testid="repo-grid"]');
      const cards = grid?.children.length ?? 0;
      expect(cards).toBe(1);
      cleanup();
    });
  });

  describe("activity feed", () => {
    it("displays activity events when received", () => {
      const { container, act, cleanup } = renderComponent();

      const activityHandler = getSocketHandler("activity:new");
      const event = createMockActivity();

      act(() => {
        activityHandler?.(event);
      });

      expect(container.textContent).toContain("Snickers started working on 'Add tests'");
      expect(container.textContent).toContain("(my-app)");
      cleanup();
    });

    it("prepends new activity events", () => {
      const { container, act, cleanup } = renderComponent();

      const activityHandler = getSocketHandler("activity:new");
      const event1 = createMockActivity({ id: "evt-1", description: "First event" });
      const event2 = createMockActivity({ id: "evt-2", description: "Second event" });

      act(() => {
        activityHandler?.(event1);
        activityHandler?.(event2);
      });

      const feed = container.querySelector('[data-testid="activity-feed"]');
      const items = feed?.querySelectorAll("li") ?? [];
      expect(items.length).toBe(2);
      // Second event should be first (prepended)
      expect(items[0]?.textContent).toContain("Second event");
      cleanup();
    });

    it("limits activity events to MAX_ACTIVITY_EVENTS", () => {
      const { container, act, cleanup } = renderComponent();

      const activityHandler = getSocketHandler("activity:new");

      // Add 60 events (MAX is 50)
      act(() => {
        for (let i = 0; i < 60; i++) {
          activityHandler?.(createMockActivity({ id: `evt-${i}` }));
        }
      });

      const feed = container.querySelector('[data-testid="activity-feed"]');
      const items = feed?.querySelectorAll("li") ?? [];
      expect(items.length).toBe(50);
      cleanup();
    });
  });

  describe("init repo form", () => {
    it("shows init form when button is clicked", () => {
      const { container, act, cleanup } = renderComponent();

      const initBtn = container.querySelector('[data-testid="init-repo-btn"]');

      act(() => {
        initBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const form = container.querySelector('[data-testid="init-repo-form"]');
      expect(form).not.toBeNull();
      expect(container.textContent).toContain("Initialize New Repository");
      cleanup();
    });

    it("hides init form when cancel is clicked", () => {
      const { container, act, cleanup } = renderComponent();

      // Open form
      const initBtn = container.querySelector('[data-testid="init-repo-btn"]');
      act(() => {
        initBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      // Click cancel
      const cancelBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Cancel",
      );
      act(() => {
        cancelBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const form = container.querySelector('[data-testid="init-repo-form"]');
      expect(form).toBeNull();
      cleanup();
    });

    it("emits repo:init event on form submit", () => {
      const { container, act, cleanup } = renderComponent();

      // Open form
      const initBtn = container.querySelector('[data-testid="init-repo-btn"]');
      act(() => {
        initBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      // Fill URL using helper for React controlled inputs
      const urlInput = container.querySelector(
        'input[placeholder="https://github.com/org/repo"]',
      ) as HTMLInputElement;
      act(() => {
        setInputValue(urlInput, "https://github.com/test/repo");
      });

      // Submit
      const form = container.querySelector('[data-testid="init-repo-form"]');
      act(() => {
        form?.dispatchEvent(new Event("submit", { bubbles: true }));
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        "repo:init",
        expect.objectContaining({ url: "https://github.com/test/repo" }),
        expect.any(Function),
      );
      cleanup();
    });

    it("shows error message on failed init", () => {
      const { container, act, cleanup } = renderComponent();

      // Open form
      const initBtn = container.querySelector('[data-testid="init-repo-btn"]');
      act(() => {
        initBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      // Fill and submit
      const urlInput = container.querySelector(
        'input[placeholder="https://github.com/org/repo"]',
      ) as HTMLInputElement;
      act(() => {
        setInputValue(urlInput, "https://github.com/test/repo");
      });

      const form = container.querySelector('[data-testid="init-repo-form"]');
      act(() => {
        form?.dispatchEvent(new Event("submit", { bubbles: true }));
      });

      // Simulate failure callback
      const emitCall = mockSocket.emit.mock.calls.find(
        (c: [string, unknown, unknown]) => c[0] === "repo:init",
      );
      const callback = emitCall?.[2] as (result: {
        success: boolean;
        error?: string;
      }) => void;

      act(() => {
        callback?.({ success: false, error: "Repository not found" });
      });

      expect(container.textContent).toContain("Repository not found");
      cleanup();
    });

    it("closes form on successful init", () => {
      const { container, act, cleanup } = renderComponent();

      // Open form
      const initBtn = container.querySelector('[data-testid="init-repo-btn"]');
      act(() => {
        initBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      // Fill and submit
      const urlInput = container.querySelector(
        'input[placeholder="https://github.com/org/repo"]',
      ) as HTMLInputElement;
      act(() => {
        setInputValue(urlInput, "https://github.com/test/repo");
      });

      const formEl = container.querySelector('[data-testid="init-repo-form"]');
      act(() => {
        formEl?.dispatchEvent(new Event("submit", { bubbles: true }));
      });

      // Simulate success callback
      const emitCall = mockSocket.emit.mock.calls.find(
        (c: [string, unknown, unknown]) => c[0] === "repo:init",
      );
      const callback = emitCall?.[2] as (result: { success: boolean }) => void;

      act(() => {
        callback?.({ success: true });
      });

      const form = container.querySelector('[data-testid="init-repo-form"]');
      expect(form).toBeNull();
      cleanup();
    });
  });

  describe("spawn worker form", () => {
    it("shows spawn form when + Worker button is clicked", () => {
      const { container, act, cleanup } = renderComponent();

      // Add a repo first
      const addHandler = getSocketHandler("repo:added");
      const repo = createMockRepo();
      act(() => {
        addHandler?.(repo);
      });

      // Click + Worker button
      const workerBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "+ Worker",
      );
      act(() => {
        workerBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const form = container.querySelector('[data-testid="spawn-worker-form"]');
      expect(form).not.toBeNull();
      expect(container.textContent).toContain("Spawn Worker for my-app");
      cleanup();
    });

    it("emits worker:spawn event on form submit", () => {
      const { container, act, cleanup } = renderComponent();

      // Add a repo
      const addHandler = getSocketHandler("repo:added");
      const repo = createMockRepo();
      act(() => {
        addHandler?.(repo);
      });

      // Open spawn form
      const workerBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "+ Worker",
      );
      act(() => {
        workerBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      // Fill task
      const taskInput = container.querySelector("textarea") as HTMLTextAreaElement;
      act(() => {
        setInputValue(taskInput, "Add unit tests");
      });

      // Submit
      const form = container.querySelector('[data-testid="spawn-worker-form"]');
      act(() => {
        form?.dispatchEvent(new Event("submit", { bubbles: true }));
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        "worker:spawn",
        expect.objectContaining({
          repoId: "repo-1",
          task: "Add unit tests",
        }),
        expect.any(Function),
      );
      cleanup();
    });

    it("shows error message on spawn failure", () => {
      const { container, act, cleanup } = renderComponent();

      // Add a repo
      const addHandler = getSocketHandler("repo:added");
      const repo = createMockRepo();
      act(() => {
        addHandler?.(repo);
      });

      // Open spawn form
      const workerBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "+ Worker",
      );
      act(() => {
        workerBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      // Fill and submit
      const taskInput = container.querySelector("textarea") as HTMLTextAreaElement;
      act(() => {
        setInputValue(taskInput, "Add tests");
      });

      const form = container.querySelector('[data-testid="spawn-worker-form"]');
      act(() => {
        form?.dispatchEvent(new Event("submit", { bubbles: true }));
      });

      // Simulate failure callback
      const emitCall = mockSocket.emit.mock.calls.find(
        (c: [string, unknown, unknown]) => c[0] === "worker:spawn",
      );
      const callback = emitCall?.[2] as (result: {
        success: boolean;
        error?: string;
      }) => void;

      act(() => {
        callback?.({ success: false, error: "Max workers reached" });
      });

      expect(container.textContent).toContain("Max workers reached");
      cleanup();
    });
  });

  describe("navigation", () => {
    it("calls onNavigateToRepo when View button is clicked", () => {
      const onNavigate = jest.fn();
      const { container, act, cleanup } = renderComponent({
        onNavigateToRepo: onNavigate,
      });

      // Add a repo
      const addHandler = getSocketHandler("repo:added");
      const repo = createMockRepo();
      act(() => {
        addHandler?.(repo);
      });

      // Click View button
      const viewBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "View",
      );
      act(() => {
        viewBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(onNavigate).toHaveBeenCalledWith("repo-1");
      cleanup();
    });
  });

  describe("health indicators", () => {
    it("renders green dot for healthy repos", () => {
      const { container, act, cleanup } = renderComponent();

      const addHandler = getSocketHandler("repo:added");
      const repo = createMockRepo({ health: "healthy" });

      act(() => {
        addHandler?.(repo);
      });

      const healthDot = container.querySelector('[data-testid="health-repo-1"]');
      expect(healthDot?.className).toContain("bg-green-500");
      cleanup();
    });

    it("renders yellow dot for warning repos", () => {
      const { container, act, cleanup } = renderComponent();

      const addHandler = getSocketHandler("repo:added");
      const repo = createMockRepo({ health: "warning" });

      act(() => {
        addHandler?.(repo);
      });

      const healthDot = container.querySelector('[data-testid="health-repo-1"]');
      expect(healthDot?.className).toContain("bg-yellow-500");
      cleanup();
    });

    it("renders red dot for error repos", () => {
      const { container, act, cleanup } = renderComponent();

      const addHandler = getSocketHandler("repo:added");
      const repo = createMockRepo({ health: "error" });

      act(() => {
        addHandler?.(repo);
      });

      const healthDot = container.querySelector('[data-testid="health-repo-1"]');
      expect(healthDot?.className).toContain("bg-red-500");
      cleanup();
    });
  });
});
