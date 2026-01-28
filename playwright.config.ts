/**
 * Playwright configuration for CoCoPilot E2E UI tests.
 *
 * Starts a local Express + Socket.IO server as a web server fixture,
 * then runs Chromium-based browser tests against the dashboard.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e/ui",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:4400",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node --import tsx tests/e2e/ui/test-server.ts",
    port: 4400,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
