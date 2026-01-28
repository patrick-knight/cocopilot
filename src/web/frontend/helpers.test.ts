/**
 * Tests for CoCoPilot Cocoa Board helper functions.
 */

import {
  relativeTime,
  formatTime,
  healthColor,
  healthBg,
  activityIcon,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// relativeTime
// ---------------------------------------------------------------------------

describe("relativeTime", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-28T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns 'just now' for future timestamps", () => {
    expect(relativeTime("2026-01-28T12:01:00Z")).toBe("just now");
  });

  it("returns seconds ago for < 60s", () => {
    expect(relativeTime("2026-01-28T11:59:30Z")).toBe("30s ago");
  });

  it("returns minutes ago for < 60m", () => {
    expect(relativeTime("2026-01-28T11:45:00Z")).toBe("15m ago");
  });

  it("returns hours ago for < 24h", () => {
    expect(relativeTime("2026-01-28T10:00:00Z")).toBe("2h ago");
  });

  it("returns days ago for >= 24h", () => {
    expect(relativeTime("2026-01-26T12:00:00Z")).toBe("2d ago");
  });

  it("returns '0s ago' for the exact same time", () => {
    expect(relativeTime("2026-01-28T12:00:00Z")).toBe("0s ago");
  });
});

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------

describe("formatTime", () => {
  it("returns a time string with hours and minutes", () => {
    const result = formatTime("2026-01-28T14:32:00Z");
    // The exact format depends on locale, but it should contain digits
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });
});

// ---------------------------------------------------------------------------
// healthColor
// ---------------------------------------------------------------------------

describe("healthColor", () => {
  it("returns green for healthy", () => {
    expect(healthColor("healthy")).toBe("text-green-500");
  });

  it("returns yellow for warning", () => {
    expect(healthColor("warning")).toBe("text-yellow-500");
  });

  it("returns red for error", () => {
    expect(healthColor("error")).toBe("text-red-500");
  });
});

// ---------------------------------------------------------------------------
// healthBg
// ---------------------------------------------------------------------------

describe("healthBg", () => {
  it("returns green bg for healthy", () => {
    expect(healthBg("healthy")).toBe("bg-green-500");
  });

  it("returns yellow bg for warning", () => {
    expect(healthBg("warning")).toBe("bg-yellow-500");
  });

  it("returns red bg for error", () => {
    expect(healthBg("error")).toBe("bg-red-500");
  });
});

// ---------------------------------------------------------------------------
// activityIcon
// ---------------------------------------------------------------------------

describe("activityIcon", () => {
  it("returns + for worker_spawned", () => {
    expect(activityIcon("worker_spawned")).toBe("+");
  });

  it("returns checkmark for worker_completed", () => {
    expect(activityIcon("worker_completed")).toBe("\u2713");
  });

  it("returns cross for worker_failed", () => {
    expect(activityIcon("worker_failed")).toBe("\u2717");
  });

  it("returns arrow for pr_created", () => {
    expect(activityIcon("pr_created")).toBe("\u21E1");
  });

  it("returns ! for ci_failed", () => {
    expect(activityIcon("ci_failed")).toBe("!");
  });

  it("returns star for repo_initialized", () => {
    expect(activityIcon("repo_initialized")).toBe("\u2606");
  });

  it("returns hand for nudge_sent", () => {
    expect(activityIcon("nudge_sent")).toBe("\u261E");
  });

  it("returns a character for pr_merged", () => {
    expect(activityIcon("pr_merged")).toBe("\u2B8C");
  });
});
