import express from "express";
import request from "supertest";
import { extStatusRoutes } from "./status";
import { errorHandler } from "../../server/middleware/error-handler";

function createApp(stateManager: any, redisConnected?: () => boolean) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/status", extStatusRoutes({ stateManager, redisConnected }));
  app.use(errorHandler);
  return app;
}

describe("GET /api/v1/status", () => {
  it("returns full system status when daemon is running", async () => {
    const sm = {
      getDaemonState: jest.fn().mockReturnValue({
        status: "running",
        pid: 12345,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        version: 1,
        repositories: {},
      }),
      getRepos: jest.fn().mockReturnValue({
        "my-app": {
          workers: {
            Snickers: { name: "Snickers", status: "working" },
            KitKat: { name: "KitKat", status: "starting" },
          },
        },
        "other-app": {
          workers: {
            Twix: { name: "Twix", status: "completed" },
          },
        },
      }),
    };

    const app = createApp(sm, () => true);

    const res = await request(app).get("/api/v1/status");

    expect(res.status).toBe(200);
    expect(res.body.daemon.up).toBe(true);
    expect(res.body.daemon.status).toBe("running");
    expect(res.body.daemon.pid).toBe(12345);
    expect(res.body.daemon.uptimeSeconds).toBeGreaterThanOrEqual(59);
    expect(res.body.daemon.startedAt).toBeDefined();
    expect(res.body.redis.connected).toBe(true);
    expect(res.body.workers.total).toBe(3);
    expect(res.body.workers.byStatus).toEqual({
      working: 1,
      starting: 1,
      completed: 1,
    });
    expect(res.body.repositories).toBe(2);
    expect(res.body.version).toBe(1);
  });

  it("returns daemon.up=false when stopped", async () => {
    const sm = {
      getDaemonState: jest.fn().mockReturnValue({
        status: "stopped",
        version: 1,
        repositories: {},
      }),
      getRepos: jest.fn().mockReturnValue({}),
    };

    const app = createApp(sm);

    const res = await request(app).get("/api/v1/status");

    expect(res.status).toBe(200);
    expect(res.body.daemon.up).toBe(false);
    expect(res.body.daemon.pid).toBeNull();
    expect(res.body.daemon.uptimeSeconds).toBeNull();
    expect(res.body.daemon.startedAt).toBeNull();
    expect(res.body.redis.connected).toBe(false);
    expect(res.body.workers.total).toBe(0);
  });

  it("reports redis disconnected when no checker provided", async () => {
    const sm = {
      getDaemonState: jest.fn().mockReturnValue({
        status: "running",
        pid: 1,
        startedAt: new Date().toISOString(),
        version: 1,
        repositories: {},
      }),
      getRepos: jest.fn().mockReturnValue({}),
    };

    const app = createApp(sm);

    const res = await request(app).get("/api/v1/status");

    expect(res.status).toBe(200);
    expect(res.body.redis.connected).toBe(false);
  });

  it("reports redis disconnected when checker returns false", async () => {
    const sm = {
      getDaemonState: jest.fn().mockReturnValue({
        status: "running",
        pid: 1,
        startedAt: new Date().toISOString(),
        version: 1,
        repositories: {},
      }),
      getRepos: jest.fn().mockReturnValue({}),
    };

    const app = createApp(sm, () => false);

    const res = await request(app).get("/api/v1/status");

    expect(res.status).toBe(200);
    expect(res.body.redis.connected).toBe(false);
  });
});
