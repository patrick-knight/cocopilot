#!/usr/bin/env node
/**
 * CoCo TUI - Terminal User Interface for CoCopilot
 *
 * Usage: coco tui [options]
 *
 * Options:
 *   --port <port>    Connect to daemon on specified port (default: 3000)
 *   --no-color       Disable colors
 *   --repo <name>    Jump directly to repository detail
 */

import React from "react";
import { fileURLToPath } from "url";
import { normalize } from "path";
import { render, useInput, useApp } from "ink";
import { RouterProvider, useRouter, Screen } from "./router.js";
import {
  StatusScreen,
  RepositoriesScreen,
  RepoDetailScreen,
  WorkerDetailScreen,
  AgentDetailScreen,
  MessagesScreen,
  MetricsScreen,
  HelpScreen,
} from "./screens/index.js";
import { getClient } from "./api/client.js";

interface AppProps {
  initialScreen?: Screen;
}

function AppContent(): React.ReactElement {
  const { screen, navigate, goBack, canGoBack } = useRouter();
  const { exit } = useApp();

  useInput((input, key) => {
    // Global shortcuts - use Ctrl modifiers to avoid conflicts with text input
    if (input === "q" || (key.ctrl && input === "c")) {
      getClient().disconnect();
      exit();
    } else if (input === "?") {
      if (screen.type === "help") {
        goBack();
      } else {
        navigate({ type: "help" });
      }
    } else if (key.escape && canGoBack) {
      goBack();
    } else if (key.ctrl && input === "s" && screen.type !== "status") {
      navigate({ type: "status" });
    } else if (key.ctrl && input === "m" && screen.type !== "metrics") {
      navigate({ type: "metrics" });
    }
  });

  // Render current screen
  switch (screen.type) {
    case "status":
      return <StatusScreen />;
    case "repositories":
      return <RepositoriesScreen />;
    case "repo-detail":
      return <RepoDetailScreen repoName={screen.repoName} />;
    case "worker-detail":
      return <WorkerDetailScreen repoName={screen.repoName} workerName={screen.workerName} />;
    case "agent-detail":
      return <AgentDetailScreen repoName={screen.repoName} agentName={screen.agentName} />;
    case "messages":
      return <MessagesScreen repoName={screen.repoName} />;
    case "metrics":
      return <MetricsScreen />;
    case "help":
      return <HelpScreen />;
  }
}

function App({ initialScreen }: AppProps): React.ReactElement {
  return (
    <RouterProvider initialScreen={initialScreen}>
      <AppContent />
    </RouterProvider>
  );
}

// Parse CLI args
function parseArgs(args: string[]): { port: number; initialScreen?: Screen } {
  let port = 3000;
  let initialScreen: Screen | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (arg === "--repo" && args[i + 1]) {
      initialScreen = { type: "repo-detail", repoName: args[++i] };
    } else if (arg === "--status") {
      initialScreen = { type: "status" };
    } else if (arg === "--metrics") {
      initialScreen = { type: "metrics" };
    }
  }

  return { port, initialScreen };
}

// Main entry point - export as function instead of executing at module level
export function startTui(args?: string[]): void {
  const { port, initialScreen } = parseArgs(args || process.argv.slice(2));

  // Initialize API client with port
  getClient(port);

  // Enter alternate screen buffer BEFORE rendering (for fullscreen effect)
  process.stdout.write("\x1b[?1049h"); // Enter alternate screen buffer
  process.stdout.write("\x1b[2J"); // Clear screen
  process.stdout.write("\x1b[H"); // Move cursor to top-left

  // Render the TUI
  render(<App initialScreen={initialScreen} />, {
    exitOnCtrlC: false, // We handle this ourselves
  });

  // Restore terminal on exit
  process.on("exit", () => {
    process.stdout.write("\x1b[?1049l"); // Leave alternate screen buffer
  });
}

// Only execute if this module is the main entry point (not imported)
const modulePath = normalize(fileURLToPath(import.meta.url));
const mainPath = normalize(process.argv[1] || "");
if (modulePath === mainPath) {
  startTui();
}
