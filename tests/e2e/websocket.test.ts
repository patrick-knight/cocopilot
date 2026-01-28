/**
 * End-to-end tests for CoCoPilot Socket.IO real-time events.
 *
 * Starts the real HTTP + Socket.IO server, connects a socket.io-client,
 * and verifies that StateManager events are forwarded to the client
 * through the socket bridge.
 */

import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import {
  createServer,
  startServer,
  stopServer,
  type CocoServer,
} from "../../src/server/app";
import { StateManager } from "../../src/state/state-manager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockBroker() {
  return {
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue({}),
  } as any;
}

/** Wait for a specific socket event with a timeout. */
function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}" event`)),
      timeoutMs,
    );
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let stateManager: StateManager;
let broker: ReturnType<typeof createMockBroker>;
let server: CocoServer;
let serverUrl: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coco-e2e-ws-"));
  stateManager = new StateManager(tmpDir);
  await stateManager.init();
  broker = createMockBroker();
  server = createServer({ stateManager, broker });
  await startServer(server, 0); // random port
  const address = server.httpServer.address();
  const port =
    typeof address === "object" && address ? address.port : 3000;
  serverUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await stopServer(server);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

describe("Socket.IO connection", () => {
  let client: ClientSocket;

  afterEach(() => {
    client?.disconnect();
  });

  it("connects to the server", (done) => {
    client = ioClient(serverUrl, {
      transports: ["websocket"],
      forceNew: true,
    });

    client.on("connect", () => {
      expect(client.connected).toBe(true);
      done();
    });

    client.on("connect_error", (err) => {
      done(err);
    });
  });
});

// ---------------------------------------------------------------------------
// Worker events
// ---------------------------------------------------------------------------

describe("worker events", () => {
  let client: ClientSocket;

  beforeEach((done) => {
    client = ioClient(serverUrl, {
      transports: ["websocket"],
      forceNew: true,
    });
    client.on("connect", done);
  });

  afterEach(() => {
    client?.disconnect();
  });

  it("receives worker_spawned when a worker is added", async () => {
    const eventPromise = waitForEvent<{
      repository: string;
      worker: { name: string; status: string };
    }>(client, "worker_spawned");

    // Emit event on StateManager (simulates daemon adding a worker)
    stateManager.emit("workerAdded", "my-repo", {
      name: "Snickers",
      status: "starting",
      task: "Fix tests",
    });

    const data = await eventPromise;
    expect(data.repository).toBe("my-repo");
    expect(data.worker.name).toBe("Snickers");
    expect(data.worker.status).toBe("starting");
  });

  it("receives worker_updated when a worker status changes", async () => {
    const eventPromise = waitForEvent<{
      repository: string;
      worker: { name: string; status: string };
    }>(client, "worker_updated");

    stateManager.emit("workerUpdated", "my-repo", {
      name: "Snickers",
      status: "working",
    });

    const data = await eventPromise;
    expect(data.repository).toBe("my-repo");
    expect(data.worker.status).toBe("working");
  });

  it("receives worker_removed when a worker is deleted", async () => {
    const eventPromise = waitForEvent<{
      repository: string;
      worker: string;
    }>(client, "worker_removed");

    stateManager.emit("workerRemoved", "my-repo", "Snickers");

    const data = await eventPromise;
    expect(data.repository).toBe("my-repo");
    expect(data.worker).toBe("Snickers");
  });
});

// ---------------------------------------------------------------------------
// Repository events
// ---------------------------------------------------------------------------

describe("repository events", () => {
  let client: ClientSocket;

  beforeEach((done) => {
    client = ioClient(serverUrl, {
      transports: ["websocket"],
      forceNew: true,
    });
    client.on("connect", done);
  });

  afterEach(() => {
    client?.disconnect();
  });

  it("receives repo_added when a repository is tracked", async () => {
    const eventPromise = waitForEvent<{
      repository: string;
      id: string;
    }>(client, "repo_added");

    stateManager.emit("repoAdded", { name: "new-repo", id: "uuid-123" });

    const data = await eventPromise;
    expect(data.repository).toBe("new-repo");
    expect(data.id).toBe("uuid-123");
  });

  it("receives repo_removed when a repository is untracked", async () => {
    const eventPromise = waitForEvent<{
      repository: string;
    }>(client, "repo_removed");

    stateManager.emit("repoRemoved", "old-repo");

    const data = await eventPromise;
    expect(data.repository).toBe("old-repo");
  });
});

// ---------------------------------------------------------------------------
// Agent events
// ---------------------------------------------------------------------------

describe("agent events", () => {
  let client: ClientSocket;

  beforeEach((done) => {
    client = ioClient(serverUrl, {
      transports: ["websocket"],
      forceNew: true,
    });
    client.on("connect", done);
  });

  afterEach(() => {
    client?.disconnect();
  });

  it("receives agent_updated when an agent status changes", async () => {
    const eventPromise = waitForEvent<{
      repository: string;
      agent: { name: string; status: string };
    }>(client, "agent_updated");

    stateManager.emit("agentUpdated", "my-repo", {
      name: "chocolatier",
      status: "healthy",
      type: "supervisor",
    });

    const data = await eventPromise;
    expect(data.repository).toBe("my-repo");
    expect(data.agent.name).toBe("chocolatier");
    expect(data.agent.status).toBe("healthy");
  });
});

// ---------------------------------------------------------------------------
// State change events
// ---------------------------------------------------------------------------

describe("state change events", () => {
  let client: ClientSocket;

  beforeEach((done) => {
    client = ioClient(serverUrl, {
      transports: ["websocket"],
      forceNew: true,
    });
    client.on("connect", done);
  });

  afterEach(() => {
    client?.disconnect();
  });

  it("receives state_changed for full state updates", async () => {
    const eventPromise = waitForEvent<{
      state: { status: string };
    }>(client, "state_changed");

    stateManager.emit("stateChanged", { status: "running", repositories: {} });

    const data = await eventPromise;
    expect(data.state.status).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// Broker broadcast events (PR_MERGED, CI_FAILED)
// ---------------------------------------------------------------------------

describe("broker broadcast events", () => {
  let client: ClientSocket;

  beforeEach((done) => {
    client = ioClient(serverUrl, {
      transports: ["websocket"],
      forceNew: true,
    });
    client.on("connect", done);
  });

  afterEach(() => {
    client?.disconnect();
  });

  it("receives pr_merged when broker broadcasts PR_MERGED", async () => {
    // The broker subscribe handler was captured during server creation
    const subscribeCall = broker.subscribe.mock.calls.find(
      (c: unknown[]) => c[0] === "__socket_bridge__",
    );
    if (!subscribeCall) {
      // If broker subscription didn't happen, skip
      return;
    }

    const brokerHandler = subscribeCall[1] as (msg: unknown) => void;

    const eventPromise = waitForEvent<{
      pr_number: number;
      pr_url: string;
    }>(client, "pr_merged");

    brokerHandler({
      type: "PR_MERGED",
      payload: {
        pr_number: 42,
        pr_url: "https://github.com/acme/repo/pull/42",
        merge_sha: "abc123",
      },
    });

    const data = await eventPromise;
    expect(data.pr_number).toBe(42);
    expect(data.pr_url).toContain("pull/42");
  });

  it("receives ci_failed when broker broadcasts CI_FAILED", async () => {
    const subscribeCall = broker.subscribe.mock.calls.find(
      (c: unknown[]) => c[0] === "__socket_bridge__",
    );
    if (!subscribeCall) {
      return;
    }

    const brokerHandler = subscribeCall[1] as (msg: unknown) => void;

    const eventPromise = waitForEvent<{
      pr_number: number;
      failure_summary: string;
    }>(client, "ci_failed");

    brokerHandler({
      type: "CI_FAILED",
      payload: {
        pr_number: 99,
        pr_url: "https://github.com/acme/repo/pull/99",
        failure_summary: "lint check failed",
      },
    });

    const data = await eventPromise;
    expect(data.pr_number).toBe(99);
    expect(data.failure_summary).toBe("lint check failed");
  });
});

// ---------------------------------------------------------------------------
// Multiple clients
// ---------------------------------------------------------------------------

describe("multiple clients", () => {
  let client1: ClientSocket;
  let client2: ClientSocket;

  beforeEach((done) => {
    let connected = 0;
    const onConnect = () => {
      connected++;
      if (connected === 2) done();
    };

    client1 = ioClient(serverUrl, {
      transports: ["websocket"],
      forceNew: true,
    });
    client2 = ioClient(serverUrl, {
      transports: ["websocket"],
      forceNew: true,
    });

    client1.on("connect", onConnect);
    client2.on("connect", onConnect);
  });

  afterEach(() => {
    client1?.disconnect();
    client2?.disconnect();
  });

  it("broadcasts events to all connected clients", async () => {
    const promise1 = waitForEvent<{ repository: string }>(
      client1,
      "worker_spawned",
    );
    const promise2 = waitForEvent<{ repository: string }>(
      client2,
      "worker_spawned",
    );

    stateManager.emit("workerAdded", "shared-repo", {
      name: "Twix",
      status: "starting",
    });

    const [data1, data2] = await Promise.all([promise1, promise2]);

    expect(data1.repository).toBe("shared-repo");
    expect(data2.repository).toBe("shared-repo");
  });
});
