import { EventEmitter } from "node:events";
import request from "supertest";
import { createServer, startServer, stopServer } from "./app";

function createMockDeps() {
  const sm = new EventEmitter() as any;
  sm.getConfig = jest.fn().mockReturnValue({ model: "gpt-5", webPort: 3000 });
  sm.updateConfig = jest.fn().mockResolvedValue({ model: "gpt-5", webPort: 9000 });
  sm.getRepos = jest.fn().mockReturnValue({});
  sm.getRepo = jest.fn().mockReturnValue(undefined);
  sm.addRepo = jest.fn();
  sm.removeRepo = jest.fn();
  sm.addWorker = jest.fn();
  sm.getWorker = jest.fn();
  sm.removeWorker = jest.fn();

  const broker = {
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue({}),
  };

  return { stateManager: sm, broker: broker as any };
}

describe("createServer", () => {
  it("creates a server with httpServer, io, and cleanup function", () => {
    const deps = createMockDeps();
    const server = createServer(deps);

    expect(server.httpServer).toBeDefined();
    expect(server.io).toBeDefined();
    expect(typeof server.cleanup).toBe("function");

    server.cleanup();
  });
});

describe("server integration", () => {
  it("responds to GET /api/v1/config", async () => {
    const deps = createMockDeps();
    const server = createServer(deps);

    const res = await request(server.httpServer).get("/api/v1/config");
    expect(res.status).toBe(200);
    expect(res.body.model).toBe("gpt-5");

    server.cleanup();
  });

  it("responds to GET /api/v1/repositories", async () => {
    const deps = createMockDeps();
    const server = createServer(deps);

    const res = await request(server.httpServer).get("/api/v1/repositories");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);

    server.cleanup();
  });

  it("returns 404 for unknown routes", async () => {
    const deps = createMockDeps();
    const server = createServer(deps);

    const res = await request(server.httpServer).get("/api/v1/nonexistent");
    expect(res.status).toBe(404);

    server.cleanup();
  });
});

describe("startServer / stopServer", () => {
  it("starts and stops the server", async () => {
    const deps = createMockDeps();
    const server = createServer(deps);

    // Use port 0 for random available port
    await startServer(server, 0);

    const address = server.httpServer.address();
    expect(address).toBeTruthy();

    await stopServer(server);
  });
});
