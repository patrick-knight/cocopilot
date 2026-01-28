import express from "express";
import request from "supertest";
import { eventsRoutes } from "./events";
import { EventStore } from "../../state/event-store";

function createApp(eventStore: EventStore) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/events", eventsRoutes(eventStore));
  return app;
}

function seedEvents(store: EventStore) {
  store.add({
    type: "worker_spawned",
    repository: "my-app",
    description: "Worker Snickers spawned",
    agent: "Snickers",
    workerName: "Snickers",
    timestamp: "2026-01-28T10:00:00.000Z",
  });
  store.add({
    type: "pr_merged",
    repository: "my-app",
    description: "PR #42 merged",
    agent: "temperer",
    prNumber: 42,
    timestamp: "2026-01-28T11:00:00.000Z",
  });
  store.add({
    type: "ci_failed",
    repository: "api-service",
    description: "CI failed on PR #7",
    agent: "KitKat",
    prNumber: 7,
    workerName: "KitKat",
    timestamp: "2026-01-27T09:00:00.000Z",
  });
  store.add({
    type: "worker_completed",
    repository: "my-app",
    description: "Worker Snickers completed task",
    agent: "Snickers",
    workerName: "Snickers",
    timestamp: "2026-01-28T12:00:00.000Z",
  });
}

describe("GET /api/v1/events", () => {
  it("returns all events when no filters are provided", async () => {
    const store = new EventStore();
    seedEvents(store);
    const app = createApp(store);

    const res = await request(app).get("/api/v1/events");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    // newest first
    expect(res.body[0].type).toBe("worker_completed");
    expect(res.body[3].type).toBe("worker_spawned");
  });

  it("returns empty array when no events exist", async () => {
    const store = new EventStore();
    const app = createApp(store);

    const res = await request(app).get("/api/v1/events");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("filters by event type", async () => {
    const store = new EventStore();
    seedEvents(store);
    const app = createApp(store);

    const res = await request(app).get("/api/v1/events?type=pr_merged");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].type).toBe("pr_merged");
    expect(res.body[0].prNumber).toBe(42);
  });

  it("filters by agent name", async () => {
    const store = new EventStore();
    seedEvents(store);
    const app = createApp(store);

    const res = await request(app).get("/api/v1/events?agent=KitKat");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].agent).toBe("KitKat");
  });

  it("filters by repository", async () => {
    const store = new EventStore();
    seedEvents(store);
    const app = createApp(store);

    const res = await request(app).get("/api/v1/events?repository=api-service");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].repository).toBe("api-service");
  });

  it("filters by date range", async () => {
    const store = new EventStore();
    seedEvents(store);
    const app = createApp(store);

    const res = await request(app).get(
      "/api/v1/events?from=2026-01-28&to=2026-01-28",
    );
    expect(res.status).toBe(200);
    // Should include 3 events from Jan 28 but not the Jan 27 event
    expect(res.body).toHaveLength(3);
    for (const event of res.body) {
      expect(event.timestamp).toMatch(/^2026-01-28/);
    }
  });

  it("combines multiple filters", async () => {
    const store = new EventStore();
    seedEvents(store);
    const app = createApp(store);

    const res = await request(app).get(
      "/api/v1/events?type=worker_spawned&repository=my-app",
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].type).toBe("worker_spawned");
    expect(res.body[0].repository).toBe("my-app");
  });
});

describe("EventStore", () => {
  it("adds events and returns newest first", () => {
    const store = new EventStore();
    store.add({
      type: "worker_spawned",
      repository: "r",
      description: "first",
    });
    store.add({
      type: "pr_merged",
      repository: "r",
      description: "second",
    });

    const all = store.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].description).toBe("second");
    expect(all[1].description).toBe("first");
  });

  it("assigns unique IDs and timestamps", () => {
    const store = new EventStore();
    const e1 = store.add({
      type: "worker_spawned",
      repository: "r",
      description: "test",
    });
    const e2 = store.add({
      type: "pr_merged",
      repository: "r",
      description: "test2",
    });

    expect(e1.id).toBeDefined();
    expect(e2.id).toBeDefined();
    expect(e1.id).not.toBe(e2.id);
    expect(e1.timestamp).toBeDefined();
  });

  it("caps events at maxEvents", () => {
    const store = new EventStore({ maxEvents: 3 });
    for (let i = 0; i < 5; i++) {
      store.add({
        type: "worker_spawned",
        repository: "r",
        description: `event-${i}`,
      });
    }

    expect(store.size).toBe(3);
    // newest first: event-4, event-3, event-2
    const all = store.getAll();
    expect(all[0].description).toBe("event-4");
    expect(all[2].description).toBe("event-2");
  });

  it("filters by type", () => {
    const store = new EventStore();
    store.add({ type: "worker_spawned", repository: "r", description: "a" });
    store.add({ type: "pr_merged", repository: "r", description: "b" });

    const result = store.query({ type: "pr_merged" });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("pr_merged");
  });

  it("filters by agent", () => {
    const store = new EventStore();
    store.add({
      type: "worker_spawned",
      repository: "r",
      description: "a",
      agent: "Snickers",
    });
    store.add({
      type: "worker_spawned",
      repository: "r",
      description: "b",
      agent: "KitKat",
    });

    const result = store.query({ agent: "KitKat" });
    expect(result).toHaveLength(1);
    expect(result[0].agent).toBe("KitKat");
  });

  it("returns empty query results for no matches", () => {
    const store = new EventStore();
    store.add({ type: "worker_spawned", repository: "r", description: "a" });

    const result = store.query({ type: "ci_failed" });
    expect(result).toHaveLength(0);
  });
});
