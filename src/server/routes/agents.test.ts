import express from "express";
import request from "supertest";
import { agentRoutes } from "./agents";
import { errorHandler } from "../middleware/error-handler";

function createApp(stateManager: any, broker: any = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/repositories/:repoName/agents",
    agentRoutes(stateManager, broker),
  );
  app.use(errorHandler);
  return app;
}

describe("GET /api/v1/repositories/:repoName/agents", () => {
  it("returns all agents as an array", async () => {
    const repo = {
      agents: {
        chocolatier: { name: "chocolatier", type: "supervisor", status: "healthy" },
        temperer: { name: "temperer", type: "merge-queue", status: "healthy" },
      },
    };
    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/repositories/my-app/agents");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe("chocolatier");
  });

  it("returns 404 for unknown repo", async () => {
    const sm = { getRepo: jest.fn().mockReturnValue(undefined) };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/repositories/ghost/agents");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/repositories/:repoName/agents/:agentName/message", () => {
  it("sends a message and returns 201", async () => {
    const repo = {
      agents: {
        chocolatier: { name: "chocolatier", type: "supervisor", status: "healthy" },
      },
    };
    const sentMsg = { id: "msg-1", type: "NUDGE" };
    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const broker = { send: jest.fn().mockResolvedValue(sentMsg) };
    const app = createApp(sm, broker);

    const res = await request(app)
      .post("/api/v1/repositories/my-app/agents/chocolatier/message")
      .send({ type: "NUDGE", payload: { hint: "Check tests" } });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("msg-1");
    expect(broker.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "NUDGE",
        to: "chocolatier",
        from: "api",
      }),
    );
  });

  it("returns 404 for unknown repo", async () => {
    const sm = { getRepo: jest.fn().mockReturnValue(undefined) };
    const broker = { send: jest.fn() };
    const app = createApp(sm, broker);

    const res = await request(app)
      .post("/api/v1/repositories/ghost/agents/chocolatier/message")
      .send({ type: "NUDGE", payload: {} });

    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown agent", async () => {
    const repo = { agents: {} };
    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const broker = { send: jest.fn() };
    const app = createApp(sm, broker);

    const res = await request(app)
      .post("/api/v1/repositories/my-app/agents/ghost/message")
      .send({ type: "NUDGE", payload: {} });

    expect(res.status).toBe(404);
  });

  it("returns 400 when type or payload missing", async () => {
    const repo = {
      agents: {
        chocolatier: { name: "chocolatier", type: "supervisor" },
      },
    };
    const sm = { getRepo: jest.fn().mockReturnValue(repo) };
    const broker = { send: jest.fn() };
    const app = createApp(sm, broker);

    const res = await request(app)
      .post("/api/v1/repositories/my-app/agents/chocolatier/message")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type.*payload/);
  });
});
