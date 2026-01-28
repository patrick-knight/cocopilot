import express from "express";
import request from "supertest";
import { extWorkerRoutes } from "./workers";
import { errorHandler } from "../../server/middleware/error-handler";

function createApp(stateManager: any, broker: any = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/workers", extWorkerRoutes(stateManager, broker));
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// POST /api/v1/workers
// ---------------------------------------------------------------------------

describe("POST /api/v1/workers", () => {
  it("spawns a worker and returns 201", async () => {
    const worker = {
      id: "uuid-1",
      name: "Snickers",
      task: "Add tests",
      status: "starting",
    };
    const sm = { addWorker: jest.fn().mockResolvedValue(worker) };
    const app = createApp(sm);

    const res = await request(app)
      .post("/api/v1/workers")
      .send({ task: "Add tests", repoName: "my-app" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Snickers");
    expect(sm.addWorker).toHaveBeenCalledWith("my-app", {
      task: "Add tests",
      branch: undefined,
      name: undefined,
      model: undefined,
    });
  });

  it("returns 400 when task is missing", async () => {
    const sm = { addWorker: jest.fn() };
    const app = createApp(sm);

    const res = await request(app)
      .post("/api/v1/workers")
      .send({ repoName: "my-app" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/task/);
  });

  it("returns 400 when repoName is missing", async () => {
    const sm = { addWorker: jest.fn() };
    const app = createApp(sm);

    const res = await request(app)
      .post("/api/v1/workers")
      .send({ task: "Do work" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/repoName/);
  });

  it("returns 404 when repo not tracked", async () => {
    const sm = {
      addWorker: jest
        .fn()
        .mockRejectedValue(new Error('Repository "ghost" is not tracked')),
    };
    const app = createApp(sm);

    const res = await request(app)
      .post("/api/v1/workers")
      .send({ task: "Do work", repoName: "ghost" });

    expect(res.status).toBe(404);
  });

  it("returns 409 when max workers reached", async () => {
    const sm = {
      addWorker: jest
        .fn()
        .mockRejectedValue(new Error("Maximum workers (2) reached")),
    };
    const app = createApp(sm);

    const res = await request(app)
      .post("/api/v1/workers")
      .send({ task: "Do work", repoName: "my-app" });

    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/workers
// ---------------------------------------------------------------------------

describe("GET /api/v1/workers", () => {
  it("returns all workers across repos", async () => {
    const repos = {
      "my-app": {
        workers: {
          Snickers: { name: "Snickers", status: "working" },
        },
      },
      "other-app": {
        workers: {
          KitKat: { name: "KitKat", status: "starting" },
        },
      },
    };
    const sm = { getRepos: jest.fn().mockReturnValue(repos) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/workers");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].repoName).toBe("my-app");
    expect(res.body[1].repoName).toBe("other-app");
  });

  it("returns empty array when no repos exist", async () => {
    const sm = { getRepos: jest.fn().mockReturnValue({}) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/workers");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/workers/:name
// ---------------------------------------------------------------------------

describe("GET /api/v1/workers/:name", () => {
  it("returns a worker found across repos", async () => {
    const repos = {
      "my-app": {
        workers: {
          Snickers: { name: "Snickers", status: "working" },
        },
      },
    };
    const sm = { getRepos: jest.fn().mockReturnValue(repos) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/workers/Snickers");

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Snickers");
    expect(res.body.repoName).toBe("my-app");
  });

  it("returns 404 for unknown worker", async () => {
    const sm = { getRepos: jest.fn().mockReturnValue({}) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/workers/Ghost");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Ghost/);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/workers/:name
// ---------------------------------------------------------------------------

describe("DELETE /api/v1/workers/:name", () => {
  it("returns 204 on successful removal", async () => {
    const repos = {
      "my-app": {
        workers: {
          Snickers: { name: "Snickers", status: "working" },
        },
      },
    };
    const sm = {
      getRepos: jest.fn().mockReturnValue(repos),
      removeWorker: jest.fn().mockResolvedValue(undefined),
    };
    const app = createApp(sm);

    const res = await request(app).delete("/api/v1/workers/Snickers");

    expect(res.status).toBe(204);
    expect(sm.removeWorker).toHaveBeenCalledWith("my-app", "Snickers");
  });

  it("returns 404 for unknown worker", async () => {
    const sm = {
      getRepos: jest.fn().mockReturnValue({}),
    };
    const app = createApp(sm);

    const res = await request(app).delete("/api/v1/workers/Ghost");

    expect(res.status).toBe(404);
  });
});
