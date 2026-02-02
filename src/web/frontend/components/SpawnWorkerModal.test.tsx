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

  // The modal uses createPortal to render into document.body,
  // so queries should use document.body rather than container.
  return document.body;
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
    const body = render(
      React.createElement(SpawnWorkerModal, { ...baseProps, isOpen: false }),
    );
    expect(body.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders the modal when isOpen is true", () => {
    const body = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );
    expect(body.querySelector("[role='dialog']")).not.toBeNull();
    expect(body.textContent).toContain("Spawn Truffle");
  });

  it("renders all form fields", () => {
    const body = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );
    expect(body.querySelector("#spawn-task")).not.toBeNull();
    expect(body.querySelector("#spawn-branch")).not.toBeNull();
    expect(body.querySelector("#spawn-model")).not.toBeNull();
    expect(body.querySelectorAll("input[name='spawn-priority']").length).toBe(3);
  });

  it("validates task textarea has required attributes", () => {
    const body = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );

    const textarea = body.querySelector("#spawn-task") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.required).toBe(true);
    expect(textarea.minLength).toBe(10);
  });

  it("populates branch dropdown with provided branches", () => {
    const branches = ["main", "develop", "feature/test"];
    const body = render(
      React.createElement(SpawnWorkerModal, { ...baseProps, branches }),
    );

    const select = body.querySelector("#spawn-branch") as HTMLSelectElement;
    const options = select.querySelectorAll("option");
    expect(options.length).toBe(3);
    expect(options[0].value).toBe("main");
    expect(options[1].value).toBe("develop");
    expect(options[2].value).toBe("feature/test");
  });

  it("defaults to main branch when no branches provided", () => {
    const body = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );

    const select = body.querySelector("#spawn-branch") as HTMLSelectElement;
    const options = select.querySelectorAll("option");
    expect(options.length).toBe(1);
    expect(options[0].value).toBe("main");
  });

  it("populates model dropdown with available models", () => {
    const body = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );

    const select = body.querySelector("#spawn-model") as HTMLSelectElement;
    const options = select.querySelectorAll("option");
    expect(options.length).toBe(14);
    expect(options[0].value).toBe("claude-sonnet-4.5");
  });

  it("has submit button with correct text", () => {
    const body = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );

    const submitBtn = body.querySelector(
      "button[type='submit']",
    ) as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();
    expect(submitBtn.textContent).toContain("Spawn Truffle");
  });

  it("has cancel button", () => {
    const body = render(
      React.createElement(SpawnWorkerModal, { ...baseProps }),
    );

    const buttons = body.querySelectorAll("button[type='button']");
    const cancelBtn = Array.from(buttons).find(
      (b) => b.textContent === "Cancel",
    );
    expect(cancelBtn).not.toBeNull();
  });

  it("defaults branch to first in list", () => {
    const branches = ["develop", "main"];
    const body = render(
      React.createElement(SpawnWorkerModal, { ...baseProps, branches }),
    );

    const select = body.querySelector("#spawn-branch") as HTMLSelectElement;
    expect(select.value).toBe("develop");
  });

  it("renders character count indicator", () => {
    const body = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );
    expect(body.textContent).toContain("/10 min characters");
  });

  it("renders priority radio buttons for low, normal, high", () => {
    const body = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );
    expect(body.textContent).toContain("Low");
    expect(body.textContent).toContain("Normal");
    expect(body.textContent).toContain("High");
  });

  it("has aria-modal attribute on dialog", () => {
    const body = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );
    const dialog = body.querySelector("[role='dialog']") as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("has accessible title via aria-labelledby", () => {
    const body = render(
      React.createElement(SpawnWorkerModal, baseProps),
    );
    const dialog = body.querySelector("[role='dialog']") as HTMLElement;
    expect(dialog).not.toBeNull();
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBe("spawn-modal-title");

    const title = body.querySelector(`#${labelId}`) as HTMLElement;
    expect(title).not.toBeNull();
    expect(title.textContent).toContain("Spawn Truffle");
  });
});
