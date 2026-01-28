/**
 * Shared helper functions for the CoCoPilot Cocoa Board.
 */

import type { RepoHealth, ActivityEventType } from "./types.js";

/** Return a human-readable relative time string (e.g. "2h ago"). */
export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Format an ISO timestamp to HH:MM for the activity feed. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Map a RepoHealth value to a Tailwind text-color class. */
export function healthColor(health: RepoHealth): string {
  switch (health) {
    case "healthy":
      return "text-green-500";
    case "warning":
      return "text-yellow-500";
    case "error":
      return "text-red-500";
  }
}

/** Map a RepoHealth value to a Tailwind bg-color class for the dot. */
export function healthBg(health: RepoHealth): string {
  switch (health) {
    case "healthy":
      return "bg-green-500";
    case "warning":
      return "bg-yellow-500";
    case "error":
      return "bg-red-500";
  }
}

/** Map an activity event type to an icon character. */
export function activityIcon(type: ActivityEventType): string {
  switch (type) {
    case "worker_spawned":
      return "+";
    case "worker_completed":
      return "\u2713"; // checkmark
    case "worker_failed":
      return "\u2717"; // cross
    case "pr_created":
      return "\u21E1"; // up arrow
    case "pr_merged":
      return "\u2B8C"; // merged circle
    case "ci_failed":
      return "!";
    case "repo_initialized":
      return "\u2606"; // star
    case "nudge_sent":
      return "\u261E"; // pointing hand
    default:
      return "\u2022"; // bullet
  }
}
