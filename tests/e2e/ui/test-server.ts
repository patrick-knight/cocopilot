/**
 * Lightweight test server for Playwright E2E UI tests.
 *
 * Starts an Express + Socket.IO server with pre-seeded state so
 * Playwright tests can exercise the Cocoa Board without Docker or Redis.
 *
 * The server serves a minimal HTML shell that loads React in-memory —
 * since the real frontend is a client-side SPA, we serve a static HTML
 * page that the React app mounts into, plus expose the REST API routes
 * so the pages can fetch data.
 */

import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import express from "express";

import { createServer, startServer } from "../../../src/server/app.js";
import { StateManager } from "../../../src/state/state-manager.js";

// ---------------------------------------------------------------------------
// Mock broker
// ---------------------------------------------------------------------------

function createMockBroker() {
  return {
    subscribe: async () => {},
    unsubscribe: async () => {},
    send: async () => ({}),
  } as any;
}

// ---------------------------------------------------------------------------
// HTML shell for the SPA
// ---------------------------------------------------------------------------

const HTML_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CoCoPilot — Cocoa Board</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  </style>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  // Create temp state directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coco-pw-"));

  const stateManager = new StateManager(tmpDir);
  await stateManager.init();

  // Seed test data: a repository with agents and workers
  const repo = await stateManager.addRepo({
    name: "my-app",
    url: "https://github.com/acme/my-app",
    localPath: "/tmp/my-app",
    mode: "single-player",
  });

  await stateManager.updateRepoStatus("my-app", "active");

  await stateManager.setAgent("my-app", {
    name: "chocolatier",
    type: "supervisor",
    status: "healthy",
  });

  await stateManager.setAgent("my-app", {
    name: "temperer",
    type: "merge-queue",
    status: "healthy",
  });

  await stateManager.addWorker("my-app", {
    task: "Add unit tests for the user service",
    name: "Snickers",
  });

  await stateManager.updateWorkerStatus("my-app", "Snickers", "working");

  await stateManager.addWorker("my-app", {
    task: "Fix the login page styling",
    name: "KitKat",
  });

  await stateManager.updateWorkerStatus("my-app", "KitKat", "completed", {
    prNumber: 47,
    prUrl: "https://github.com/acme/my-app/pull/47",
  });

  // Create server
  const broker = createMockBroker();
  const server = createServer({ stateManager, broker });

  // Serve HTML shell for all non-API routes (SPA fallback)
  const app = server.httpServer.listeners("request")[0] as express.Application;

  // Start on port 4400
  const PORT = parseInt(process.env.PORT ?? "4400", 10);
  await startServer(server, PORT);

  console.log(`Test server running on http://localhost:${PORT}`);
  console.log(`State dir: ${tmpDir}`);

  // Cleanup on exit
  process.on("SIGTERM", () => {
    server.cleanup();
    server.httpServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(0);
  });

  process.on("SIGINT", () => {
    server.cleanup();
    server.httpServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Failed to start test server:", err);
  process.exit(1);
});
