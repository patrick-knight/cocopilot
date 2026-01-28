/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react";
import ReactDOM from "react-dom/client";
import type { PRPipelineEntry, PRStage } from "../types.js";

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

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Lazy imports
// ---------------------------------------------------------------------------

let PRPipeline: typeof import("./PRPipeline").PRPipeline;
let PIPELINE_STAGES: typeof import("./PRPipeline").PIPELINE_STAGES;
let STAGE_ORDER: typeof import("./PRPipeline").STAGE_ORDER;
let relativeTime: typeof import("./PRPipeline").relativeTime;

beforeAll(async () => {
  const mod = await import("./PRPipeline");
  PRPipeline = mod.PRPipeline;
  PIPELINE_STAGES = mod.PIPELINE_STAGES;
  STAGE_ORDER = mod.STAGE_ORDER;
  relativeTime = mod.relativeTime;
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makePR(overrides: Partial<PRPipelineEntry> = {}): PRPipelineEntry {
  return {
    number: 42,
    title: "feat: add authentication",
    url: "https://github.com/org/repo/pull/42",
    branch: "work/Snickers",
    author: "Snickers",
    stage: "ci_running",
    workerName: "Snickers",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

describe("PIPELINE_STAGES", () => {
  it("defines the 5 main pipeline stages in order", () => {
    expect(PIPELINE_STAGES).toEqual(["draft", "ready", "ci_running", "ci_passed", "merged"]);
  });

  it("does not include ci_failed (it is a branch, not a main stage)", () => {
    expect(PIPELINE_STAGES).not.toContain("ci_failed");
  });
});

describe("STAGE_ORDER", () => {
  it("assigns increasing indices through the main pipeline", () => {
    expect(STAGE_ORDER.draft).toBeLessThan(STAGE_ORDER.ready);
    expect(STAGE_ORDER.ready).toBeLessThan(STAGE_ORDER.ci_running);
    expect(STAGE_ORDER.ci_running).toBeLessThan(STAGE_ORDER.ci_passed);
    expect(STAGE_ORDER.ci_passed).toBeLessThan(STAGE_ORDER.merged);
  });

  it("places ci_failed at the same index as ci_running", () => {
    expect(STAGE_ORDER.ci_failed).toBe(STAGE_ORDER.ci_running);
  });
});

// ---------------------------------------------------------------------------
// relativeTime
// ---------------------------------------------------------------------------

describe("relativeTime", () => {
  it("returns 'just now' for future timestamps", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(relativeTime(future)).toBe("just now");
  });

  it("returns seconds ago for < 60s", () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(relativeTime(recent)).toBe("30s ago");
  });

  it("returns minutes ago for < 60min", () => {
    const ago = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTime(ago)).toBe("5m ago");
  });

  it("returns hours ago for < 24h", () => {
    const ago = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(relativeTime(ago)).toBe("3h ago");
  });

  it("returns days ago for >= 24h", () => {
    const ago = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(relativeTime(ago)).toBe("2d ago");
  });
});

// ---------------------------------------------------------------------------
// PRPipeline component
// ---------------------------------------------------------------------------

describe("PRPipeline", () => {
  describe("empty state", () => {
    it("renders an empty message when no PRs are provided", () => {
      const container = render(React.createElement(PRPipeline, { prs: [] }));
      expect(container.textContent).toContain("No pull requests in the pipeline.");
    });

    it("has accessible section label", () => {
      const container = render(React.createElement(PRPipeline, { prs: [] }));
      const section = container.querySelector("[aria-label='PR Pipeline']");
      expect(section).not.toBeNull();
    });

    it("renders the section heading", () => {
      const container = render(React.createElement(PRPipeline, { prs: [] }));
      const heading = container.querySelector("h2");
      expect(heading?.textContent).toBe("PR Pipeline");
    });
  });

  describe("active PRs", () => {
    it("renders active PR rows", () => {
      const prs = [
        makePR({ number: 10, stage: "draft" }),
        makePR({ number: 11, stage: "ci_running" }),
      ];
      const container = render(React.createElement(PRPipeline, { prs }));
      expect(container.querySelector("[data-testid='pr-row-10']")).not.toBeNull();
      expect(container.querySelector("[data-testid='pr-row-11']")).not.toBeNull();
    });

    it("sorts active PRs by number descending (newest first)", () => {
      const prs = [
        makePR({ number: 5, stage: "draft" }),
        makePR({ number: 15, stage: "ready" }),
        makePR({ number: 10, stage: "ci_running" }),
      ];
      const container = render(React.createElement(PRPipeline, { prs }));
      const rows = container.querySelectorAll("[data-testid^='pr-row-']");
      expect(rows[0].getAttribute("data-testid")).toBe("pr-row-15");
      expect(rows[1].getAttribute("data-testid")).toBe("pr-row-10");
      expect(rows[2].getAttribute("data-testid")).toBe("pr-row-5");
    });

    it("displays PR number as a link", () => {
      const pr = makePR({ number: 42, url: "https://github.com/org/repo/pull/42" });
      const container = render(React.createElement(PRPipeline, { prs: [pr] }));
      const link = container.querySelector("a[href='https://github.com/org/repo/pull/42']") as HTMLAnchorElement;
      expect(link).not.toBeNull();
      expect(link.textContent).toBe("#42");
      expect(link.target).toBe("_blank");
      expect(link.rel).toContain("noopener");
    });

    it("displays PR title", () => {
      const pr = makePR({ title: "feat: add auth middleware" });
      const container = render(React.createElement(PRPipeline, { prs: [pr] }));
      expect(container.textContent).toContain("feat: add auth middleware");
    });

    it("displays branch name", () => {
      const pr = makePR({ branch: "work/Truffle-42" });
      const container = render(React.createElement(PRPipeline, { prs: [pr] }));
      expect(container.textContent).toContain("work/Truffle-42");
    });

    it("displays author name", () => {
      const pr = makePR({ author: "KitKat" });
      const container = render(React.createElement(PRPipeline, { prs: [pr] }));
      expect(container.textContent).toContain("by KitKat");
    });

    it("displays worker name when provided", () => {
      const pr = makePR({ workerName: "Snickers" });
      const container = render(React.createElement(PRPipeline, { prs: [pr] }));
      expect(container.textContent).toContain("worker: Snickers");
    });

    it("does not display worker label when workerName is undefined", () => {
      const pr = makePR({ workerName: undefined });
      const container = render(React.createElement(PRPipeline, { prs: [pr] }));
      expect(container.textContent).not.toContain("worker:");
    });
  });

  describe("stage indicator", () => {
    it("renders 5 stage dots for an active PR", () => {
      const pr = makePR({ stage: "ci_running" });
      const container = render(React.createElement(PRPipeline, { prs: [pr] }));
      const stageDots = container.querySelectorAll("[data-testid^='stage-']");
      expect(stageDots.length).toBe(5);
    });

    it("renders stage labels for all 5 pipeline stages", () => {
      const pr = makePR({ stage: "ready" });
      const container = render(React.createElement(PRPipeline, { prs: [pr] }));
      expect(container.textContent).toContain("Draft");
      expect(container.textContent).toContain("Ready");
      expect(container.textContent).toContain("CI Running");
      expect(container.textContent).toContain("CI Passed");
      expect(container.textContent).toContain("Merged");
    });

    it("renders connector lines between stages", () => {
      const pr = makePR({ stage: "ci_passed" });
      const container = render(React.createElement(PRPipeline, { prs: [pr] }));
      // 4 connectors between 5 stages
      const connectors = container.querySelectorAll("[data-testid^='connector-']");
      expect(connectors.length).toBe(4);
    });

    it("marks the current stage with aria-current=step", () => {
      const pr = makePR({ stage: "ready" });
      const container = render(React.createElement(PRPipeline, { prs: [pr] }));
      const currentDot = container.querySelector("[aria-current='step']");
      expect(currentDot).not.toBeNull();
      expect(currentDot?.getAttribute("title")).toBe("Ready");
    });

    it("shows CI Failed label on the ci_running dot when stage is ci_failed", () => {
      const pr = makePR({ stage: "ci_failed" });
      const container = render(React.createElement(PRPipeline, { prs: [pr] }));
      expect(container.textContent).toContain("CI Failed");
    });

    it("does not mark any dot as aria-current when stage is ci_failed", () => {
      const pr = makePR({ stage: "ci_failed" });
      const container = render(React.createElement(PRPipeline, { prs: [pr] }));
      const currentDot = container.querySelector("[aria-current='step']");
      expect(currentDot).toBeNull();
    });

    it("has an accessible group label with the current stage", () => {
      const pr = makePR({ stage: "ci_passed" });
      const container = render(React.createElement(PRPipeline, { prs: [pr] }));
      const group = container.querySelector("[role='group']");
      expect(group?.getAttribute("aria-label")).toBe("Pipeline stage: CI Passed");
    });
  });

  describe("merged PRs section", () => {
    it("does not show merged section when there are no merged PRs", () => {
      const prs = [makePR({ number: 1, stage: "draft" })];
      const container = render(React.createElement(PRPipeline, { prs }));
      expect(container.querySelector("[data-testid='merged-section']")).toBeNull();
    });

    it("shows merged section with correct count", () => {
      const prs = [
        makePR({ number: 1, stage: "merged" }),
        makePR({ number: 2, stage: "merged" }),
      ];
      const container = render(React.createElement(PRPipeline, { prs }));
      const section = container.querySelector("[data-testid='merged-section']");
      expect(section).not.toBeNull();
      expect(section?.textContent).toContain("2 merged PRs");
    });

    it("uses singular form for 1 merged PR", () => {
      const prs = [makePR({ number: 1, stage: "merged" })];
      const container = render(React.createElement(PRPipeline, { prs }));
      const section = container.querySelector("[data-testid='merged-section']");
      expect(section?.textContent).toContain("1 merged PR");
      expect(section?.textContent).not.toContain("1 merged PRs");
    });

    it("merged PRs are collapsed by default", () => {
      const prs = [makePR({ number: 1, stage: "merged" })];
      const container = render(React.createElement(PRPipeline, { prs }));
      expect(container.querySelector("[data-testid='merged-prs']")).toBeNull();
    });

    it("expands merged PRs when toggle is clicked", () => {
      const prs = [makePR({ number: 1, stage: "merged", title: "first merged" })];
      const container = render(React.createElement(PRPipeline, { prs }));

      const toggle = container.querySelector("[data-testid='merged-section'] button") as HTMLButtonElement;
      expect(toggle).not.toBeNull();

      click(toggle);

      expect(container.querySelector("[data-testid='merged-prs']")).not.toBeNull();
      expect(container.querySelector("[data-testid='merged-pr-row-1']")).not.toBeNull();
    });

    it("collapses merged PRs when toggle is clicked again", () => {
      const prs = [makePR({ number: 1, stage: "merged" })];
      const container = render(React.createElement(PRPipeline, { prs }));

      const toggle = container.querySelector("[data-testid='merged-section'] button") as HTMLButtonElement;

      click(toggle); // expand
      expect(container.querySelector("[data-testid='merged-prs']")).not.toBeNull();

      click(toggle); // collapse
      expect(container.querySelector("[data-testid='merged-prs']")).toBeNull();
    });

    it("toggle button has aria-expanded attribute", () => {
      const prs = [makePR({ number: 1, stage: "merged" })];
      const container = render(React.createElement(PRPipeline, { prs }));

      const toggle = container.querySelector("[data-testid='merged-section'] button") as HTMLButtonElement;
      expect(toggle.getAttribute("aria-expanded")).toBe("false");

      click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
    });

    it("merged PR row shows checkmark, number, and title", () => {
      const prs = [makePR({ number: 99, stage: "merged", title: "fix: resolve race condition" })];
      const container = render(React.createElement(PRPipeline, { prs }));

      const toggle = container.querySelector("[data-testid='merged-section'] button") as HTMLButtonElement;
      click(toggle);

      const row = container.querySelector("[data-testid='merged-pr-row-99']") as HTMLElement;
      expect(row).not.toBeNull();
      expect(row.textContent).toContain("\u2713"); // checkmark
      expect(row.textContent).toContain("#99");
      expect(row.textContent).toContain("fix: resolve race condition");
    });

    it("shows 'All pull requests have been merged' when only merged PRs exist", () => {
      const prs = [makePR({ number: 1, stage: "merged" })];
      const container = render(React.createElement(PRPipeline, { prs }));
      expect(container.textContent).toContain("All pull requests have been merged.");
    });
  });

  describe("mixed active and merged PRs", () => {
    it("separates active and merged PRs into different sections", () => {
      const prs = [
        makePR({ number: 1, stage: "draft" }),
        makePR({ number: 2, stage: "merged" }),
        makePR({ number: 3, stage: "ci_running" }),
      ];
      const container = render(React.createElement(PRPipeline, { prs }));

      // Active section should have PRs 1 and 3
      const activePRs = container.querySelector("[data-testid='active-prs']");
      expect(activePRs).not.toBeNull();
      expect(activePRs?.querySelector("[data-testid='pr-row-1']")).not.toBeNull();
      expect(activePRs?.querySelector("[data-testid='pr-row-3']")).not.toBeNull();
      expect(activePRs?.querySelector("[data-testid='pr-row-2']")).toBeNull();

      // Merged section should have PR 2
      expect(container.querySelector("[data-testid='merged-section']")).not.toBeNull();
    });

    it("does not show 'all merged' message when active PRs exist", () => {
      const prs = [
        makePR({ number: 1, stage: "draft" }),
        makePR({ number: 2, stage: "merged" }),
      ];
      const container = render(React.createElement(PRPipeline, { prs }));
      expect(container.textContent).not.toContain("All pull requests have been merged.");
    });
  });

  describe("all pipeline stages render correctly", () => {
    const stages: PRStage[] = ["draft", "ready", "ci_running", "ci_passed", "ci_failed", "merged"];

    for (const stage of stages) {
      it(`renders a PR in stage "${stage}" without errors`, () => {
        const pr = makePR({ stage });
        // merged PRs go into the collapsed section, not the active section
        if (stage === "merged") {
          const container = render(React.createElement(PRPipeline, { prs: [pr] }));
          expect(container.querySelector("[data-testid='merged-section']")).not.toBeNull();
        } else {
          const container = render(React.createElement(PRPipeline, { prs: [pr] }));
          expect(container.querySelector(`[data-testid='pr-row-${pr.number}']`)).not.toBeNull();
        }
      });
    }
  });
});
