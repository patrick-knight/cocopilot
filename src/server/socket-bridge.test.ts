import { EventEmitter } from "node:events";
import { createSocketBridge } from "./socket-bridge";
import { MessageType } from "../messaging/types";

function mockIO() {
  return { emit: jest.fn() } as any;
}

function mockBroker() {
  return {
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
  } as any;
}

describe("createSocketBridge", () => {
  let io: any;
  let sm: EventEmitter;
  let broker: any;
  let cleanup: () => void;

  beforeEach(() => {
    io = mockIO();
    sm = new EventEmitter();
    broker = mockBroker();
    cleanup = createSocketBridge(io, sm as any, broker);
  });

  afterEach(() => {
    cleanup();
  });

  it("emits worker_spawned on workerAdded", () => {
    const worker = { name: "Snickers", status: "starting" };
    sm.emit("workerAdded", "my-app", worker);
    expect(io.emit).toHaveBeenCalledWith("worker_spawned", {
      repository: "my-app",
      worker,
    });
  });

  it("emits worker_updated on workerUpdated", () => {
    const worker = { name: "Snickers", status: "working" };
    sm.emit("workerUpdated", "my-app", worker);
    expect(io.emit).toHaveBeenCalledWith("worker_updated", {
      repository: "my-app",
      worker,
    });
  });

  it("emits worker_removed on workerRemoved", () => {
    sm.emit("workerRemoved", "my-app", "Snickers");
    expect(io.emit).toHaveBeenCalledWith("worker_removed", {
      repository: "my-app",
      worker: "Snickers",
    });
  });

  it("emits repo_added on repoAdded", () => {
    sm.emit("repoAdded", { name: "my-app", id: "uuid-1" });
    expect(io.emit).toHaveBeenCalledWith("repo_added", {
      repository: "my-app",
      id: "uuid-1",
    });
  });

  it("emits repo_removed on repoRemoved", () => {
    sm.emit("repoRemoved", "my-app");
    expect(io.emit).toHaveBeenCalledWith("repo_removed", {
      repository: "my-app",
    });
  });

  it("emits agent_updated on agentUpdated", () => {
    const agent = { name: "chocolatier", status: "healthy" };
    sm.emit("agentUpdated", "my-app", agent);
    expect(io.emit).toHaveBeenCalledWith("agent_updated", {
      repository: "my-app",
      agent,
    });
  });

  it("emits state_changed on stateChanged", () => {
    const state = { status: "running" };
    sm.emit("stateChanged", state);
    expect(io.emit).toHaveBeenCalledWith("state_changed", { state });
  });

  it("subscribes to broker for broadcast messages", () => {
    expect(broker.subscribe).toHaveBeenCalledWith(
      "__socket_bridge__",
      expect.any(Function),
    );
  });

  it("forwards PR_MERGED from broker to socket", () => {
    const handler = broker.subscribe.mock.calls[0][1];
    const msg = {
      type: MessageType.PR_MERGED,
      payload: { pr_number: 42, pr_url: "https://github.com/org/repo/pull/42", merge_sha: "abc" },
    };
    handler(msg);
    expect(io.emit).toHaveBeenCalledWith("pr_merged", msg.payload);
  });

  it("forwards CI_FAILED from broker to socket", () => {
    const handler = broker.subscribe.mock.calls[0][1];
    const msg = {
      type: MessageType.CI_FAILED,
      payload: { pr_number: 42, pr_url: "https://github.com/org/repo/pull/42", failure_summary: "test failed" },
    };
    handler(msg);
    expect(io.emit).toHaveBeenCalledWith("ci_failed", msg.payload);
  });

  it("cleanup removes all listeners", () => {
    cleanup();
    // After cleanup, emitting should not trigger io.emit
    io.emit.mockClear();
    sm.emit("workerAdded", "my-app", {});
    expect(io.emit).not.toHaveBeenCalled();
  });
});
