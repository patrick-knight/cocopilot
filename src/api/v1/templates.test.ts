/**
 * Tests for task templates API
 */

import express from "express";
import request from "supertest";
import * as fs from "node:fs";
import * as path from "node:path";
import { templatesRoutes, BUILTIN_TEMPLATES } from "./templates.js";
import { errorHandler } from "../../server/middleware/error-handler.js";

// Mock the utils module
jest.mock("../../utils/index.js", () => ({
  loadRepoConfig: jest.fn(),
}));

import { loadRepoConfig } from "../../utils/index.js";

const mockLoadRepoConfig = loadRepoConfig as jest.MockedFunction<typeof loadRepoConfig>;

function createApp(stateManager: any) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/templates", templatesRoutes({ stateManager }));
  app.use(errorHandler);
  return app;
}

describe("GET /api/v1/templates", () => {
  beforeEach(() => {
    mockLoadRepoConfig.mockReset();
  });

  it("returns built-in templates when no repo is specified", async () => {
    const sm = { getRepo: jest.fn() };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/templates");

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(BUILTIN_TEMPLATES.length);
    expect(res.body.templates[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      source: "builtin",
    });
  });

  it("returns built-in templates when repo is not found", async () => {
    const sm = { getRepo: jest.fn().mockReturnValue(null) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/templates?repo=nonexistent");

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(BUILTIN_TEMPLATES.length);
    expect(sm.getRepo).toHaveBeenCalledWith("nonexistent");
  });

  it("returns repo-specific templates first when repo has custom templates", async () => {
    const customTemplates = [
      {
        id: "custom-task",
        name: "Custom Task",
        description: "A custom task",
        task: "Do something custom",
        category: "custom",
      },
      {
        id: "add-tests", // Override built-in template
        name: "Add Tests (Custom)",
        description: "Custom test template",
        task: "Add tests the custom way",
        category: "testing",
      },
    ];

    mockLoadRepoConfig.mockReturnValue({ templates: customTemplates });

    const repo = {
      id: "repo-1",
      name: "my-app",
      localPath: "/tmp/my-app",
      defaultBranch: "main",
    };

    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/templates?repo=my-app");

    expect(res.status).toBe(200);
    expect(mockLoadRepoConfig).toHaveBeenCalledWith("/tmp/my-app");

    // Should have custom templates + built-ins (minus the overridden one)
    expect(res.body.templates.length).toBe(BUILTIN_TEMPLATES.length + 1);

    // First two should be the custom templates with "repo" source
    expect(res.body.templates[0]).toMatchObject({
      id: "custom-task",
      name: "Custom Task",
      source: "repo",
    });

    expect(res.body.templates[1]).toMatchObject({
      id: "add-tests",
      name: "Add Tests (Custom)",
      source: "repo",
    });

    // Built-in "add-tests" should NOT be included (overridden by repo template)
    const builtinAddTests = res.body.templates.find(
      (t: any) => t.id === "add-tests" && t.source === "builtin"
    );
    expect(builtinAddTests).toBeUndefined();
  });

  it("handles repo config without templates field", async () => {
    mockLoadRepoConfig.mockReturnValue({});

    const repo = {
      id: "repo-1",
      name: "my-app",
      localPath: "/tmp/my-app",
      defaultBranch: "main",
    };

    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/templates?repo=my-app");

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(BUILTIN_TEMPLATES.length);
    expect(mockLoadRepoConfig).toHaveBeenCalledWith("/tmp/my-app");
  });
});

describe("GET /api/v1/templates/:id", () => {
  beforeEach(() => {
    mockLoadRepoConfig.mockReset();
  });

  it("returns a built-in template by ID", async () => {
    const sm = { getRepo: jest.fn() };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/templates/add-tests");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "add-tests",
      name: "Add Tests",
      category: "testing",
    });
  });

  it("returns 404 when template ID is not found", async () => {
    const sm = { getRepo: jest.fn() };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/templates/nonexistent");

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Template "nonexistent" not found');
  });

  it("returns repo-specific template when repo param is provided", async () => {
    const customTemplates = [
      {
        id: "custom-task",
        name: "Custom Task",
        description: "A custom task",
        task: "Do something custom",
        category: "custom",
      },
    ];

    mockLoadRepoConfig.mockReturnValue({ templates: customTemplates });

    const repo = {
      id: "repo-1",
      name: "my-app",
      localPath: "/tmp/my-app",
      defaultBranch: "main",
    };

    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/templates/custom-task?repo=my-app");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "custom-task",
      name: "Custom Task",
    });
    expect(mockLoadRepoConfig).toHaveBeenCalledWith("/tmp/my-app");
  });

  it("returns repo-specific override when ID matches both repo and built-in", async () => {
    const customTemplates = [
      {
        id: "add-tests", // Override built-in
        name: "Add Tests (Custom)",
        description: "Custom test template",
        task: "Add tests the custom way",
        category: "testing",
      },
    ];

    mockLoadRepoConfig.mockReturnValue({ templates: customTemplates });

    const repo = {
      id: "repo-1",
      name: "my-app",
      localPath: "/tmp/my-app",
      defaultBranch: "main",
    };

    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/templates/add-tests?repo=my-app");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "add-tests",
      name: "Add Tests (Custom)", // Should be the custom version
      task: "Add tests the custom way",
    });
    expect(mockLoadRepoConfig).toHaveBeenCalledWith("/tmp/my-app");
  });

  it("returns built-in template when repo param is provided but repo not found", async () => {
    const sm = { getRepo: jest.fn().mockReturnValue(null) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/templates/add-tests?repo=nonexistent");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "add-tests",
      name: "Add Tests", // Should be the built-in version
    });
    expect(sm.getRepo).toHaveBeenCalledWith("nonexistent");
  });
});
