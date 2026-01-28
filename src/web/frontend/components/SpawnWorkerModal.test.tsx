/**
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
// Mock fetch
// ---------------------------------------------------------------------------

const fetchMock = jest.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

// ---------------------------------------------------------------------------
// Lazy import so mocks are established first
// ---------------------------------------------------------------------------

let SpawnWorkerModal: typeof import("./SpawnWorkerModal").SpawnWorkerModal;

beforeAll(async () => {
  const mod = await import("./SpawnWorkerModal");
  SpawnWorkerModal = mod.SpawnWorkerModal;
});

afterEach(() => {
  fetchMock.mockReset();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SpawnWorkerModal", () => {
  const baseProps = {
    isOpen: true,
    onClose: jest.fn(),
    repositoryId: "repo-123",
    repositoryName: "my-app",
    socket: null,
  };

  it("renders nothing when isOpen is false", () => {
    const container = render(
      React.createElement(SpawnWorkerModal, { ...baseProps, isOpen: false }),
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders the modal when isOpen is true", () => {
    const container = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );
    expect(container.querySelector("[role='dialog']")).not.toBeNull();
    expect(container.textContent).toContain("Spawn Worker");
  });

  it("renders all form fields", () => {
    const container = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );
    expect(container.querySelector("#spawn-task")).not.toBeNull();
    expect(container.querySelector("#spawn-branch")).not.toBeNull();
    expect(container.querySelector("#spawn-model")).not.toBeNull();
    expect(container.querySelectorAll("input[name='spawn-priority']").length).toBe(3);
  });

  it("validates task textarea has required attributes", () => {
    const container = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );

    const textarea = container.querySelector("#spawn-task") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.required).toBe(true);
    expect(textarea.minLength).toBe(10);
  });

  it("populates branch dropdown with provided branches", () => {
    const branches = ["main", "develop", "feature/test"];
    const container = render(
      React.createElement(SpawnWorkerModal, { ...baseProps, branches }),
    );

    const select = container.querySelector("#spawn-branch") as HTMLSelectElement;
    const options = select.querySelectorAll("option");
    expect(options.length).toBe(3);
    expect(options[0].value).toBe("main");
    expect(options[1].value).toBe("develop");
    expect(options[2].value).toBe("feature/test");
  });

  it("defaults to main branch when no branches provided", () => {
    const container = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );

    const select = container.querySelector("#spawn-branch") as HTMLSelectElement;
    const options = select.querySelectorAll("option");
    expect(options.length).toBe(1);
    expect(options[0].value).toBe("main");
  });

  it("populates model dropdown with available models", () => {
    const container = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );

    const select = container.querySelector("#spawn-model") as HTMLSelectElement;
    const options = select.querySelectorAll("option");
    expect(options.length).toBe(4);
    expect(options[0].value).toBe("claude-sonnet-4-5");
  });

  it("has submit button with correct text", () => {
    const container = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );

    const submitBtn = container.querySelector(
      "button[type='submit']",
    ) as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();
    expect(submitBtn.textContent).toContain("Spawn Worker");
  });

  it("has cancel button", () => {
    const container = render(
      React.createElement(SpawnWorkerModal, { ...baseProps }),
    );

    const buttons = container.querySelectorAll("button[type='button']");
    const cancelBtn = Array.from(buttons).find(
      (b) => b.textContent === "Cancel",
    );
    expect(cancelBtn).not.toBeNull();
  });

  it("defaults branch to first in list", () => {
    const branches = ["develop", "main"];
    const container = render(
      React.createElement(SpawnWorkerModal, { ...baseProps, branches }),
    );

    const select = container.querySelector("#spawn-branch") as HTMLSelectElement;
    expect(select.value).toBe("develop");
  });

  it("renders character count indicator", () => {
    const container = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );
    expect(container.textContent).toContain("/10 min characters");
  });

  it("renders priority radio buttons for low, normal, high", () => {
    const container = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );
    expect(container.textContent).toContain("Low");
    expect(container.textContent).toContain("Normal");
    expect(container.textContent).toContain("High");
  });

  it("has aria-modal attribute on dialog", () => {
    const container = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );
    const dialog = container.querySelector("[role='dialog']") as HTMLElement;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("has accessible title via aria-labelledby", () => {
    const container = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );
    const dialog = container.querySelector("[role='dialog']") as HTMLElement;
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBe("spawn-modal-title");

    const title = container.querySelector(`#${labelId}`) as HTMLElement;
    expect(title.textContent).toBe("Spawn Worker");
  });
});
