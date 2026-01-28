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

  it("emits pr:status_changed with merged stage on PR_MERGED", () => {
    const handler = broker.subscribe.mock.calls[0][1];
    const msg = {
      type: MessageType.PR_MERGED,
      payload: { pr_number: 42, pr_url: "https://github.com/org/repo/pull/42", merge_sha: "abc" },
    };
    handler(msg);
    expect(io.emit).toHaveBeenCalledWith("pr:status_changed", expect.objectContaining({
      number: 42,
      stage: "merged",
    }));
  });

  it("emits pr:status_changed with draft stage on PR_CREATED", () => {
    const handler = broker.subscribe.mock.calls[0][1];
    const msg = {
      type: MessageType.PR_CREATED,
      payload: { pr_number: 10, pr_url: "https://github.com/org/repo/pull/10", title: "feat", branch: "work/Snickers" },
    };
    handler(msg);
    expect(io.emit).toHaveBeenCalledWith("pr:status_changed", expect.objectContaining({
      number: 10,
      stage: "draft",
    }));
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

  it("emits pr:status_changed with ci_failed stage on CI_FAILED", () => {
    const handler = broker.subscribe.mock.calls[0][1];
    const msg = {
      type: MessageType.CI_FAILED,
      payload: { pr_number: 42, pr_url: "https://github.com/org/repo/pull/42", failure_summary: "test failed" },
    };
    handler(msg);
    expect(io.emit).toHaveBeenCalledWith("pr:status_changed", expect.objectContaining({
      number: 42,
      stage: "ci_failed",
    }));
  });

  it("emits pr:status_changed when worker with prNumber is updated", () => {
    const worker = {
      name: "Snickers",
      status: "completed",
      prNumber: 42,
      updatedAt: "2026-01-28T12:00:00.000Z",
    };
    sm.emit("workerUpdated", "my-app", worker);
    expect(io.emit).toHaveBeenCalledWith("pr:status_changed", {
      number: 42,
      stage: "ready",
      updatedAt: "2026-01-28T12:00:00.000Z",
    });
  });

  it("does not emit pr:status_changed when worker has no prNumber", () => {
    const worker = { name: "KitKat", status: "working" };
    sm.emit("workerUpdated", "my-app", worker);
    // Should emit worker_updated but NOT pr:status_changed
    expect(io.emit).toHaveBeenCalledWith("worker_updated", expect.anything());
    expect(io.emit).not.toHaveBeenCalledWith("pr:status_changed", expect.anything());
  });

  it("cleanup removes all listeners", () => {
    cleanup();
    // After cleanup, emitting should not trigger io.emit
    io.emit.mockClear();
    sm.emit("workerAdded", "my-app", {});
    expect(io.emit).not.toHaveBeenCalled();
  });
});
