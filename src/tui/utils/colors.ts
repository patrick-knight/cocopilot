/**
 * TUI color utilities - respects NO_COLOR env var
 */

import chalk, { Chalk } from "chalk";

const noColor = process.env.NO_COLOR !== undefined || process.argv.includes("--no-color");

// Create a chalk instance that respects NO_COLOR
export const colors = noColor
  ? new Chalk({ level: 0 })
  : chalk;

// Export noColor for other modules
export { noColor };

// Status colors
export const statusColors = {
  healthy: colors.green,
  running: colors.green,
  working: colors.cyan,
  paused: colors.yellow,
  starting: colors.yellow,
  completed: colors.green,
  merged: colors.magenta,
  failed: colors.red,
  stuck: colors.red,
  terminated: colors.gray,
  unknown: colors.gray,
};

export function getStatusColor(status: string): (text: string) => string {
  return statusColors[status as keyof typeof statusColors] ?? colors.white;
}

// Status symbols
export const symbols = {
  success: noColor ? "[OK]" : "✅",
  warning: noColor ? "[!]" : "⚠️",
  error: noColor ? "[X]" : "❌",
  info: noColor ? "[i]" : "ℹ️",
  spinner: noColor ? "*" : "◐",
  bullet: noColor ? "-" : "•",
  arrow: noColor ? ">" : "→",
  pointer: noColor ? ">" : "❯",
  check: noColor ? "[x]" : "✓",
  cross: noColor ? "[x]" : "✗",
  pause: noColor ? "||" : "⏸",
};

export function getStatusSymbol(status: string): string {
  switch (status) {
    case "healthy":
    case "running":
    case "completed":
    case "merged":
      return symbols.success;
    case "starting":
    case "working":
      return symbols.info;
    case "paused":
      return symbols.pause;
    case "failed":
    case "stuck":
    case "error":
      return symbols.error;
    case "warning":
      return symbols.warning;
    default:
      return symbols.bullet;
  }
}
