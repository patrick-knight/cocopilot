import express from "express";
import request from "supertest";
import { extWorkerRoutes } from "./workers";
import { errorHandler } from "../../server/middleware/error-handler";

function createApp(stateManager: any, broker: any = { send: jest.fn().mockResolvedValue({}) }) {
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
  it("sends spawn request and returns 202", async () => {
    const repo = { name: "my-app", defaultBranch: "main", workers: {} };
    const broker = { send: jest.fn().mockResolvedValue({}) };
    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const app = createApp(sm, broker);

    const res = await request(app)
      .post("/api/v1/workers")
      .send({ task: "Add tests", repoName: "my-app" });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("accepted");
    expect(res.body.task).toBe("Add tests");
    expect(broker.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SPAWN_WORKER",
        to: "chocolatier:my-app",
        payload: expect.objectContaining({ task: "Add tests" }),
      }),
    );
  });

  it("returns 400 when task is missing", async () => {
    const sm = { getRepo: jest.fn() };
    const broker = { send: jest.fn() };
    const app = createApp(sm, broker);

    const res = await request(app)
      .post("/api/v1/workers")
      .send({ repoName: "my-app" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/task/);
  });

  it("returns 400 when repoName is missing", async () => {
    const sm = { getRepo: jest.fn() };
    const broker = { send: jest.fn() };
    const app = createApp(sm, broker);

    const res = await request(app)
      .post("/api/v1/workers")
      .send({ task: "Do work" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/repoName/);
  });

  it("returns 404 when repo not tracked", async () => {
    const sm = { getRepo: jest.fn().mockReturnValue(undefined) };
    const broker = { send: jest.fn() };
    const app = createApp(sm, broker);

    const res = await request(app)
      .post("/api/v1/workers")
      .send({ task: "Do work", repoName: "ghost" });

    expect(res.status).toBe(404);
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
    expect(res.body.workers).toHaveLength(2);
    expect(res.body.workers[0].repoName).toBe("my-app");
    expect(res.body.workers[1].repoName).toBe("other-app");
  });

  it("returns empty array when no repos exist", async () => {
    const sm = { getRepos: jest.fn().mockReturnValue({}) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/workers");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ workers: [] });
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
