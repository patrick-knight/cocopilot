import express from "express";
import request from "supertest";
import { extWebhookRoutes, type WebhookStore } from "./webhooks";
import { errorHandler } from "../../server/middleware/error-handler";

function createApp(store?: WebhookStore) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/webhooks", extWebhookRoutes(store));
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// POST /api/v1/webhooks
// ---------------------------------------------------------------------------

describe("POST /api/v1/webhooks", () => {
  it("registers a webhook and returns 201", async () => {
    const app = createApp();

    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({
        url: "https://example.com/hook",
        events: ["worker.created", "worker.completed"],
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.url).toBe("https://example.com/hook");
    expect(res.body.events).toEqual(["worker.created", "worker.completed"]);
    expect(res.body.createdAt).toBeDefined();
  });

  it("returns 400 when url is missing", async () => {
    const app = createApp();

    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({ events: ["worker.created"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url/i);
  });

  it("returns 400 for invalid URL format", async () => {
    const app = createApp();

    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({ url: "not-a-url", events: ["worker.created"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/URL/);
  });

  it("returns 400 when events is missing", async () => {
    const app = createApp();

    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({ url: "https://example.com/hook" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/events/i);
  });

  it("returns 400 when events is empty", async () => {
    const app = createApp();

    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({ url: "https://example.com/hook", events: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/events/i);
  });

  it("returns 400 for invalid event names", async () => {
    const app = createApp();

    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({ url: "https://example.com/hook", events: ["invalid.event"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid\.event/);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/webhooks
// ---------------------------------------------------------------------------

describe("GET /api/v1/webhooks", () => {
  it("returns empty array when no webhooks registered", async () => {
    const app = createApp();

    const res = await request(app).get("/api/v1/webhooks");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns all registered webhooks", async () => {
    const store: WebhookStore = new Map();
    store.set("wh-1", {
      id: "wh-1",
      url: "https://example.com/a",
      events: ["worker.created"],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    store.set("wh-2", {
      id: "wh-2",
      url: "https://example.com/b",
      events: ["pr.merged"],
      createdAt: "2025-01-02T00:00:00.000Z",
    });
    const app = createApp(store);

    const res = await request(app).get("/api/v1/webhooks");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/webhooks/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/v1/webhooks/:id", () => {
  it("removes a webhook and returns 204", async () => {
    const store: WebhookStore = new Map();
    store.set("wh-1", {
      id: "wh-1",
      url: "https://example.com/hook",
      events: ["worker.created"],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    const app = createApp(store);

    const res = await request(app).delete("/api/v1/webhooks/wh-1");

    expect(res.status).toBe(204);
    expect(store.size).toBe(0);
  });

  it("returns 404 for unknown webhook", async () => {
    const app = createApp();

    const res = await request(app).delete("/api/v1/webhooks/nonexistent");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/nonexistent/);
  });
});
