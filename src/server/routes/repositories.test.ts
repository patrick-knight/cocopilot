import express from "express";
import request from "supertest";
import { repositoryRoutes } from "./repositories";
import { errorHandler } from "../middleware/error-handler";

function createApp(stateManager: any) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/repositories", repositoryRoutes(stateManager));
  app.use(errorHandler);
  return app;
}

describe("POST /api/v1/repositories", () => {
  it("creates a repo and returns 201", async () => {
    const repo = {
      id: "uuid-1",
      name: "my-app",
      url: "https://github.com/org/my-app",
      localPath: "/tmp/my-app",
      mode: "single-player",
      status: "initializing",
    };
    const sm = { addRepo: jest.fn().mockResolvedValue(repo) };
    const app = createApp(sm);

    const res = await request(app)
      .post("/api/v1/repositories")
      .send({
        name: "my-app",
        url: "https://github.com/org/my-app",
        localPath: "/tmp/my-app",
        mode: "single-player",
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("my-app");
    expect(sm.addRepo).toHaveBeenCalledWith({
      name: "my-app",
      url: "https://github.com/org/my-app",
      localPath: "/tmp/my-app",
      mode: "single-player",
      defaultBranch: undefined,
    });
  });

  it("returns 400 when required fields are missing", async () => {
    const sm = { addRepo: jest.fn() };
    const app = createApp(sm);

    const res = await request(app)
      .post("/api/v1/repositories")
      .send({ name: "incomplete" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required/);
  });

  it("returns 409 when repo already exists", async () => {
    const sm = {
      addRepo: jest.fn().mockRejectedValue(new Error('Repository "dup" is already tracked')),
    };
    const app = createApp(sm);

    const res = await request(app)
      .post("/api/v1/repositories")
      .send({
        name: "dup",
        url: "https://github.com/org/dup",
        localPath: "/tmp/dup",
        mode: "single-player",
      });

    expect(res.status).toBe(409);
  });
});

describe("GET /api/v1/repositories", () => {
  it("returns all repos as an array", async () => {
    const repos = {
      "my-app": { id: "1", name: "my-app" },
      "other-app": { id: "2", name: "other-app" },
    };
    const sm = { getRepos: jest.fn().mockReturnValue(repos) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/repositories");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe("my-app");
  });
});

describe("GET /api/v1/repositories/:repoName", () => {
  it("returns 200 with repo details", async () => {
    const repo = { id: "1", name: "my-app", status: "active" };
    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/repositories/my-app");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("my-app");
    expect(sm.getRepo).toHaveBeenCalledWith("my-app");
  });

  it("returns 404 when repo not found", async () => {
    const sm = { getRepo: jest.fn().mockReturnValue(undefined) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/repositories/missing");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/repositories/:repoName", () => {
  it("returns 204 on successful removal", async () => {
    const sm = { removeRepo: jest.fn().mockResolvedValue(undefined) };
    const app = createApp(sm);

    const res = await request(app).delete("/api/v1/repositories/my-app");
    expect(res.status).toBe(204);
    expect(sm.removeRepo).toHaveBeenCalledWith("my-app");
  });

  it("returns 404 when repo not tracked", async () => {
    const sm = {
      removeRepo: jest
        .fn()
        .mockRejectedValue(new Error('Repository "ghost" is not tracked')),
    };
    const app = createApp(sm);

    const res = await request(app).delete("/api/v1/repositories/ghost");
    expect(res.status).toBe(404);
  });
});
