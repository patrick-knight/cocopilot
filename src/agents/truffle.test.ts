import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import { TruffleAgent, TruffleConfig } from "./truffle";
import { MessageBroker } from "../messaging/broker";
import { MessageType, CocoMessage } from "../messaging/types";

// ---------------------------------------------------------------------------
// Mock child_process.execFile to avoid real git/gh calls
// ---------------------------------------------------------------------------

jest.mock("node:child_process", () => {
  const original = jest.requireActual("node:child_process");
  return {
    ...original,
    execFile: jest.fn(),
  };
});

const mockExecFile = childProcess.execFile as unknown as jest.Mock;

function setupExecFileMock(
  responses: Record<string, { stdout?: string; stderr?: string; error?: Error }>,
) {
  mockExecFile.mockImplementation(
    (
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      const key = `${cmd} ${args.join(" ")}`;

      // Find a matching response by checking if key starts with any registered pattern
      for (const [pattern, response] of Object.entries(responses)) {
        if (key.startsWith(pattern) || key.includes(pattern)) {
          if (response.error) {
            cb(response.error, { stdout: "", stderr: response.error.message });
          } else {
            cb(null, {
              stdout: response.stdout ?? "",
              stderr: response.stderr ?? "",
            });
          }
          return;
        }
      }

      // Default: succeed silently
      cb(null, { stdout: "", stderr: "" });
    },
  );
}

// ---------------------------------------------------------------------------
// Mock MessageBroker
// ---------------------------------------------------------------------------

function createMockBroker(): jest.Mocked<MessageBroker> {
  return {
    send: jest.fn().mockResolvedValue({ id: "mock-msg-id" }),
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    acknowledge: jest.fn().mockResolvedValue(true),
    connect: jest.fn().mockResolvedValue(undefined),
    replay: jest.fn().mockResolvedValue([]),
    getPending: jest.fn().mockResolvedValue([]),
    getHistory: jest.fn().mockResolvedValue([]),
    cleanup: jest.fn().mockResolvedValue(0),
    deleteMessage: jest.fn().mockResolvedValue(true),
    close: jest.fn().mockResolvedValue(undefined),
    isReady: true,
  } as unknown as jest.Mocked<MessageBroker>;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createConfig(overrides: Partial<TruffleConfig> = {}): TruffleConfig {
  return {
    name: "Snickers",
    task: "Add unit tests for the user service",
    branch: "work/Snickers",
    repoPath: "/tmp/test-repo",
    repoName: "my-app",
    worktreePath: "/tmp/test-repo-worktrees/Snickers",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TruffleAgent", () => {
  let broker: jest.Mocked<MessageBroker>;
  let config: TruffleConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    broker = createMockBroker();
    config = createConfig();

    // Default: all git commands succeed
    setupExecFileMock({
      "git worktree add": { stdout: "" },
      "git worktree prune": { stdout: "" },
      "git add": { stdout: "" },
      "git diff --cached --quiet": {
        error: new Error("changes exist"), // exit code 1 = changes
      },
      "git diff --cached --numstat": {
        stdout: "10\t2\tsrc/user.ts\n5\t0\tsrc/user.test.ts\n",
      },
      "git commit": { stdout: "" },
      "git rev-parse --short HEAD": { stdout: "abc1234\n" },
      "git push": { stdout: "" },
      "gh pr create": {
        stdout: "https://github.com/org/my-app/pull/42\n",
      },
    });
  });

  // -----------------------------------------------------------------------
  // Construction & accessors
  // -----------------------------------------------------------------------

  describe("construction", () => {
    it("exposes read-only accessors", () => {
      const agent = new TruffleAgent(config, broker);

      expect(agent.name).toBe("Snickers");
      expect(agent.task).toBe("Add unit tests for the user service");
      expect(agent.branch).toBe("work/Snickers");
      expect(agent.status).toBe("starting");
      expect(agent.filesChanged).toBe(0);
      expect(agent.commitCount).toBe(0);
      expect(agent.prResult).toBeNull();
      expect(agent.worktreePath).toBe("/tmp/test-repo-worktrees/Snickers");
    });

    it("freezes config to prevent mutation", () => {
      const mutableConfig = createConfig();
      const agent = new TruffleAgent(mutableConfig, broker);

      mutableConfig.task = "modified";
      expect(agent.task).toBe("Add unit tests for the user service");
    });
  });

  // -----------------------------------------------------------------------
  // System prompt
  // -----------------------------------------------------------------------

  describe("buildSystemPrompt", () => {
    it("injects task and branch into the template", () => {
      const agent = new TruffleAgent(config, broker);
      const prompt = agent.buildSystemPrompt();

      expect(prompt).toContain("Add unit tests for the user service");
      expect(prompt).toContain("work/Snickers");
      expect(prompt).toContain("You are a Truffle worker for CoCoPilot");
    });

    it("appends custom prompt text when provided", () => {
      const agent = new TruffleAgent(
        createConfig({ customPrompt: "Always use vitest instead of jest." }),
        broker,
      );
      const prompt = agent.buildSystemPrompt();

      expect(prompt).toContain("Always use vitest instead of jest.");
      // Custom prompt should be at the end
      expect(prompt.indexOf("Always use vitest")).toBeGreaterThan(
        prompt.indexOf("You are a Truffle worker"),
      );
    });

    it("works without custom prompt", () => {
      const agent = new TruffleAgent(config, broker);
      const prompt = agent.buildSystemPrompt();

      // Should not end with extra whitespace/newlines from missing custom prompt
      expect(prompt).not.toMatch(/\n\n$/);
    });
  });

  // -----------------------------------------------------------------------
  // Lifecycle: init
  // -----------------------------------------------------------------------

  describe("init", () => {
    it("sets up worktree and subscribes to messages", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      // Should have called git worktree add
      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "add", "-b", "work/Snickers"]),
        expect.any(Object),
        expect.any(Function),
      );

      // Should subscribe to messages
      expect(broker.subscribe).toHaveBeenCalledWith(
        "Snickers",
        expect.any(Function),
      );

      // Status should transition to "working"
      expect(agent.status).toBe("working");
    });

    it("uses custom baseBranch when provided", async () => {
      const agent = new TruffleAgent(
        createConfig({ baseBranch: "develop" }),
        broker,
      );
      await agent.init();

      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["develop"]),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("emits statusChanged event on init", async () => {
      const agent = new TruffleAgent(config, broker);
      const statusChanges: Array<[string, string]> = [];
      agent.on("statusChanged", (status, previous) => {
        statusChanges.push([status, previous]);
      });

      await agent.init();

      expect(statusChanges).toEqual([["working", "starting"]]);
    });
  });

  // -----------------------------------------------------------------------
  // Lifecycle: stop
  // -----------------------------------------------------------------------

  describe("stop", () => {
    it("unsubscribes and sets status to terminated", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();
      await agent.stop();

      expect(broker.unsubscribe).toHaveBeenCalledWith("Snickers");
      expect(agent.status).toBe("terminated");
    });

    it("does not change status if already completed", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();
      await agent.signalComplete("All done");
      await agent.stop();

      expect(agent.status).toBe("completed");
    });
  });

  // -----------------------------------------------------------------------
  // Git: commit
  // -----------------------------------------------------------------------

  describe("commit", () => {
    it("stages, commits, and returns the short hash", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      const hash = await agent.commit("feat: add user service tests");

      expect(hash).toBe("abc1234");
      expect(agent.commitCount).toBe(1);
      expect(agent.filesChanged).toBe(2); // Two files in mock numstat
    });

    it("tracks cumulative file changes across commits", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      await agent.commit("first commit");
      await agent.commit("second commit");

      expect(agent.commitCount).toBe(2);
      expect(agent.filesChanged).toBe(4); // 2 files * 2 commits
    });

    it("emits committed event", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      const commits: Array<[string, string]> = [];
      agent.on("committed", (hash, message) => {
        commits.push([hash, message]);
      });

      await agent.commit("feat: add tests");

      expect(commits).toEqual([["abc1234", "feat: add tests"]]);
    });

    it("returns empty string when no changes to commit", async () => {
      setupExecFileMock({
        "git worktree add": { stdout: "" },
        "git add": { stdout: "" },
        "git diff --cached --quiet": { stdout: "" }, // exit 0 = no changes
      });

      const agent = new TruffleAgent(config, broker);
      await agent.init();

      const hash = await agent.commit("no-op");

      expect(hash).toBe("");
      expect(agent.commitCount).toBe(0);
    });

    it("throws if worktree is not initialized", async () => {
      const agent = new TruffleAgent(config, broker);

      await expect(agent.commit("oops")).rejects.toThrow("worktree not initialized");
    });
  });

  // -----------------------------------------------------------------------
  // Git: createPR
  // -----------------------------------------------------------------------

  describe("createPR", () => {
    it("pushes branch and creates PR via gh CLI", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      const pr = await agent.createPR(
        "feat: add user tests",
        "Adds comprehensive unit tests for the user service.",
      );

      expect(pr.number).toBe(42);
      expect(pr.url).toBe("https://github.com/org/my-app/pull/42");
      expect(pr.title).toBe("feat: add user tests");
      expect(agent.prResult).toEqual(pr);
    });

    it("emits prCreated event", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      const prs: Array<{ number: number; url: string }> = [];
      agent.on("prCreated", (pr) => prs.push(pr));

      await agent.createPR("feat: test", "body");

      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(42);
    });

    it("sends PR_CREATED message to the Temperer", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      await agent.createPR("feat: test", "body");

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.PR_CREATED,
          from: "Snickers",
          to: "temperer",
          payload: expect.objectContaining({
            pr_number: 42,
            pr_url: "https://github.com/org/my-app/pull/42",
            title: "feat: test",
            branch: "work/Snickers",
          }),
        }),
      );
    });

    it("sends to custom merge queue agent name", async () => {
      const agent = new TruffleAgent(
        createConfig({ mergeQueueName: "enrober" }),
        broker,
      );
      await agent.init();

      await agent.createPR("feat: test", "body");

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.PR_CREATED,
          to: "enrober",
        }),
      );
    });

    it("includes labels when configured", async () => {
      const agent = new TruffleAgent(
        createConfig({ prLabels: ["cocopilot", "automated"] }),
        broker,
      );
      await agent.init();

      await agent.createPR("feat: test", "body");

      // Verify gh was called with --label flags
      expect(mockExecFile).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining([
          "--label",
          "cocopilot",
          "--label",
          "automated",
        ]),
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Messaging: signalComplete
  // -----------------------------------------------------------------------

  describe("signalComplete", () => {
    it("sends TASK_COMPLETE to the Chocolatier", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();
      await agent.commit("feat: tests");

      await agent.signalComplete("Added 10 unit tests");

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.TASK_COMPLETE,
          from: "Snickers",
          to: "chocolatier",
          payload: expect.objectContaining({
            summary: "Added 10 unit tests",
            files_changed: 2,
            commits: 1,
          }),
        }),
      );
    });

    it("includes PR URL from createPR result", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();
      await agent.createPR("feat: test", "body");

      await agent.signalComplete("Done");

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.TASK_COMPLETE,
          payload: expect.objectContaining({
            pr_url: "https://github.com/org/my-app/pull/42",
          }),
        }),
      );
    });

    it("allows explicit PR URL override", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      await agent.signalComplete("Done", "https://github.com/org/repo/pull/99");

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            pr_url: "https://github.com/org/repo/pull/99",
          }),
        }),
      );
    });

    it("transitions status to completed and emits done", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      const doneEvents: Array<[string, string]> = [];
      agent.on("done", (status, summary) => doneEvents.push([status, summary]));

      await agent.signalComplete("All done");

      expect(agent.status).toBe("completed");
      expect(doneEvents).toEqual([["completed", "All done"]]);
    });

    it("sends to custom supervisor name", async () => {
      const agent = new TruffleAgent(
        createConfig({ supervisorName: "head-chef" }),
        broker,
      );
      await agent.init();

      await agent.signalComplete("Done");

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "head-chef",
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Messaging: signalFailed
  // -----------------------------------------------------------------------

  describe("signalFailed", () => {
    it("sends TASK_FAILED to the Chocolatier", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      await agent.signalFailed("Cannot find module 'foo'", false);

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.TASK_FAILED,
          from: "Snickers",
          to: "chocolatier",
          payload: expect.objectContaining({
            error: "Cannot find module 'foo'",
            task: "Add unit tests for the user service",
            recoverable: false,
          }),
        }),
      );

      expect(agent.status).toBe("failed");
    });

    it("emits done event with failed status", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      const doneEvents: Array<[string, string]> = [];
      agent.on("done", (status, summary) => doneEvents.push([status, summary]));

      await agent.signalFailed("Something broke");

      expect(doneEvents).toEqual([["failed", "Something broke"]]);
    });
  });

  // -----------------------------------------------------------------------
  // Messaging: requestHelp
  // -----------------------------------------------------------------------

  describe("requestHelp", () => {
    it("sends recoverable TASK_FAILED with high priority", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      await agent.requestHelp("I'm stuck on the database schema");

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.TASK_FAILED,
          from: "Snickers",
          to: "chocolatier",
          payload: expect.objectContaining({
            error: "I'm stuck on the database schema",
            recoverable: true,
          }),
          priority: "high",
        }),
      );

      expect(agent.status).toBe("stuck");
    });
  });

  // -----------------------------------------------------------------------
  // Messaging: inbound message handling
  // -----------------------------------------------------------------------

  describe("inbound message handling", () => {
    it("emits nudged event when receiving a NUDGE", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      // Capture the message handler registered during init
      const handler = (broker.subscribe as jest.Mock).mock.calls[0][1];

      const nudges: Array<[string, string | undefined]> = [];
      agent.on("nudged", (hint, context) => nudges.push([hint, context]));

      await handler({
        id: "nudge-1",
        type: MessageType.NUDGE,
        from: "chocolatier",
        to: "Snickers",
        payload: { hint: "Try checking the error logs", context: "/var/log" },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      } as CocoMessage);

      expect(nudges).toEqual([["Try checking the error logs", "/var/log"]]);
    });

    it("responds to STATUS_REQUEST with current status", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      const handler = (broker.subscribe as jest.Mock).mock.calls[0][1];

      await handler({
        id: "status-req-1",
        type: MessageType.STATUS_REQUEST,
        from: "chocolatier",
        to: "Snickers",
        payload: { request_id: "req-123" },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      } as CocoMessage);

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.STATUS_RESPONSE,
          from: "Snickers",
          to: "chocolatier",
          payload: expect.objectContaining({
            request_id: "req-123",
            status: "working",
            current_action: "Add unit tests for the user service",
          }),
        }),
      );
    });

    it("acknowledges messages when ack_required is true", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      const handler = (broker.subscribe as jest.Mock).mock.calls[0][1];

      await handler({
        id: "ack-msg-1",
        type: MessageType.BROADCAST,
        from: "chocolatier",
        to: "*",
        payload: { message: "System update" },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: true,
      } as CocoMessage);

      expect(broker.acknowledge).toHaveBeenCalledWith("Snickers", "ack-msg-1");
    });

    it("does not acknowledge messages when ack_required is false", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      const handler = (broker.subscribe as jest.Mock).mock.calls[0][1];

      await handler({
        id: "no-ack-1",
        type: MessageType.BROADCAST,
        from: "chocolatier",
        to: "*",
        payload: { message: "FYI" },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      } as CocoMessage);

      expect(broker.acknowledge).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // respondStatus & progress estimation
  // -----------------------------------------------------------------------

  describe("respondStatus", () => {
    it("reports progress=10 after worktree setup", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      await agent.respondStatus("req-1", "chocolatier");

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.STATUS_RESPONSE,
          payload: expect.objectContaining({
            progress: 10,
          }),
        }),
      );
    });

    it("reports higher progress after commits", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();
      await agent.commit("feat: first");

      await agent.respondStatus("req-2", "chocolatier");

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            progress: 60, // 50 + min(1*10, 40) = 60
          }),
        }),
      );
    });

    it("reports progress=90 after PR creation", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();
      await agent.createPR("feat: test", "body");

      // Clear previous send calls so we can check the status response
      broker.send.mockClear();
      await agent.respondStatus("req-3", "chocolatier");

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            progress: 90,
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Worktree cleanup
  // -----------------------------------------------------------------------

  describe("cleanupWorktree", () => {
    it("does nothing if worktree was never initialized", async () => {
      const agent = new TruffleAgent(config, broker);

      await agent.cleanupWorktree(); // Should not throw

      expect(mockExecFile).not.toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "prune"]),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("prunes after removing worktree directory", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      await agent.cleanupWorktree();

      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["worktree", "prune"],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("push throws if worktree not initialized", async () => {
      const agent = new TruffleAgent(config, broker);

      await expect(agent.push()).rejects.toThrow("worktree not initialized");
    });

    it("createPR throws if worktree not initialized", async () => {
      const agent = new TruffleAgent(config, broker);

      await expect(agent.createPR("t", "b")).rejects.toThrow(
        "worktree not initialized",
      );
    });

    it("defaults supervisorName to chocolatier", async () => {
      const agent = new TruffleAgent(
        createConfig({ supervisorName: undefined }),
        broker,
      );
      await agent.init();
      await agent.signalComplete("done");

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: "chocolatier" }),
      );
    });

    it("defaults mergeQueueName to temperer", async () => {
      const agent = new TruffleAgent(
        createConfig({ mergeQueueName: undefined }),
        broker,
      );
      await agent.init();
      await agent.createPR("t", "b");

      expect(broker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.PR_CREATED,
          to: "temperer",
        }),
      );
    });

    it("defaults baseBranch to main", async () => {
      const agent = new TruffleAgent(config, broker);
      await agent.init();

      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["main"]),
        expect.any(Object),
        expect.any(Function),
      );
    });
  });
});
