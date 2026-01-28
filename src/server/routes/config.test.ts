import express from "express";
import request from "supertest";
import { configRoutes } from "./config";

function createApp(stateManager: any) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/config", configRoutes(stateManager));
  return app;
}

describe("GET /api/v1/config", () => {
  it("returns the current config", async () => {
    const sm = {
      getConfig: jest.fn().mockReturnValue({ model: "gpt-5", webPort: 3000 }),
    };
    const app = createApp(sm);

    const res = await request(app).get("/api/v1/config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ model: "gpt-5", webPort: 3000 });
    expect(sm.getConfig).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/v1/config", () => {
  it("updates and returns the config", async () => {
    const updated = { model: "gpt-5", webPort: 9000 };
    const sm = {
      getConfig: jest.fn(),
      updateConfig: jest.fn().mockResolvedValue(updated),
    };
    const app = createApp(sm);

    const res = await request(app)
      .patch("/api/v1/config")
      .send({ webPort: 9000 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(updated);
    expect(sm.updateConfig).toHaveBeenCalledWith({ webPort: 9000 });
  });

  it("rejects non-object body", async () => {
    const sm = {
      getConfig: jest.fn(),
      updateConfig: jest.fn(),
    };
    const app = createApp(sm);

    const res = await request(app)
      .patch("/api/v1/config")
      .send("not json")
      .set("Content-Type", "application/json");

    // Express will parse "not json" as invalid JSON and Express 5 will return 400
    // If it somehow gets through, our handler should reject it
    expect([400, 415]).toContain(res.status);
  });
});
