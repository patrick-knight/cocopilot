import express from "express";
import request from "supertest";
import { workerRoutes } from "./workers";
import { errorHandler } from "../middleware/error-handler";

function createApp(stateManager: any, broker: any = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/repositories/:repoName/workers",
    workerRoutes(stateManager, broker),
  );
  app.use(errorHandler);
  return app;
}

describe("POST /api/v1/repositories/:repoName/workers", () => {
  it("spawns a worker and returns 201", async () => {
    const worker = { id: "uuid-1", name: "Snickers", task: "Add tests", status: "starting" };
    const sm = { addWorker: jest.fn().mockResolvedValue(worker) };
    const app = createApp(sm);

    const res = await request(app)
      .post("/api/v1/repositories/my-app/workers")
      .send({ task: "Add tests" });

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
      .post("/api/v1/repositories/my-app/workers")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/task/);
  });

  it("returns 404 when repo not tracked", async () => {
    const sm = {
      addWorker: jest.fn().mockRejectedValue(new Error('Repository "ghost" is not tracked')),
    };
    const app = createApp(sm);

    const res = await request(app)
      .post("/api/v1/repositories/ghost/workers")
      .send({ task: "Do work" });

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
      .post("/api/v1/repositories/my-app/workers")
      .send({ task: "Do work" });

    expect(res.status).toBe(409);
  });
});

describe("GET /api/v1/repositories/:repoName/workers", () => {
  it("returns all workers as an array", async () => {
    const repo = {
      workers: {
        Snickers: { name: "Snickers", status: "working" },
        KitKat: { name: "KitKat", status: "starting" },
      },
    };
    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/repositories/my-app/workers");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("returns 404 for unknown repo", async () => {
    const sm = { getRepo: jest.fn().mockReturnValue(undefined) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/repositories/ghost/workers");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/repositories/:repoName/workers/:workerName", () => {
  it("returns a specific worker", async () => {
    const worker = { name: "Snickers", status: "working" };
    const sm = { getWorker: jest.fn().mockReturnValue(worker) };
    const app = createApp(sm);

    const res = await request(app).get(
      "/api/v1/repositories/my-app/workers/Snickers",
    );
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Snickers");
    expect(sm.getWorker).toHaveBeenCalledWith("my-app", "Snickers");
  });

  it("returns 404 for unknown worker", async () => {
    const sm = { getWorker: jest.fn().mockReturnValue(undefined) };
    const app = createApp(sm);

    const res = await request(app).get(
      "/api/v1/repositories/my-app/workers/Ghost",
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/repositories/:repoName/workers/:workerName", () => {
  it("returns 204 on successful removal", async () => {
    const sm = { removeWorker: jest.fn().mockResolvedValue(undefined) };
    const app = createApp(sm);

    const res = await request(app).delete(
      "/api/v1/repositories/my-app/workers/Snickers",
    );
    expect(res.status).toBe(204);
    expect(sm.removeWorker).toHaveBeenCalledWith("my-app", "Snickers");
  });

  it("returns 404 for unknown worker", async () => {
    const sm = {
      removeWorker: jest
        .fn()
        .mockRejectedValue(new Error('Worker "Ghost" not found')),
    };
    const app = createApp(sm);

    const res = await request(app).delete(
      "/api/v1/repositories/my-app/workers/Ghost",
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/repositories/:repoName/workers/:workerName/nudge", () => {
  it("sends a nudge message and returns 200", async () => {
    const worker = { name: "Snickers", status: "stuck" };
    const sm = { getWorker: jest.fn().mockReturnValue(worker) };
    const broker = { send: jest.fn().mockResolvedValue({}) };
    const app = createApp(sm, broker);

    const res = await request(app)
      .post("/api/v1/repositories/my-app/workers/Snickers/nudge")
      .send({ hint: "Check the tests", context: "CI failed" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(broker.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "NUDGE",
        to: "Snickers:my-app",
        payload: { hint: "Check the tests", context: "CI failed" },
      }),
    );
  });

  it("returns 400 when hint is missing", async () => {
    const sm = { getWorker: jest.fn() };
    const broker = { send: jest.fn() };
    const app = createApp(sm, broker);

    const res = await request(app)
      .post("/api/v1/repositories/my-app/workers/Snickers/nudge")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown worker", async () => {
    const sm = { getWorker: jest.fn().mockReturnValue(undefined) };
    const broker = { send: jest.fn() };
    const app = createApp(sm, broker);

    const res = await request(app)
      .post("/api/v1/repositories/my-app/workers/Ghost/nudge")
      .send({ hint: "help" });

    expect(res.status).toBe(404);
  });
});
