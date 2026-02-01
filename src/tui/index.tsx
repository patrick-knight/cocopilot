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
import { render, Box, Text, useInput, useApp } from "ink";
import { RouterProvider, useRouter, Screen } from "./router.js";
import {
  StatusScreen,
  RepositoriesScreen,
  RepoDetailScreen,
  WorkerDetailScreen,
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
    // Global shortcuts
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
    } else if (input === "s" && screen.type !== "status") {
      navigate({ type: "status" });
    } else if (input === "m" && screen.type !== "metrics") {
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
function parseArgs(): { port: number; initialScreen?: Screen } {
  const args = process.argv.slice(2);
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

// Main entry point
const { port, initialScreen } = parseArgs();

// Initialize API client with port
getClient(port);

// Render the TUI
render(<App initialScreen={initialScreen} />);
