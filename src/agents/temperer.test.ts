import { Temperer, type ExecFn, type TempererConfig } from "./temperer";
import {
  MessageBroker,
  MessageType,
  type CocoMessage,
  type CreateMessageOptions,
  type MessageHandler,
} from "../messaging/index";

// --- Mock MessageBroker ---

class MockBroker {
  sent: CreateMessageOptions<MessageType>[] = [];
  subscribedAgent: string | null = null;
  handler: MessageHandler | null = null;

  async connect() {}
  async close() {}

  async send<T extends MessageType>(options: CreateMessageOptions<T>) {
    this.sent.push(options as CreateMessageOptions<MessageType>);
    return {
      id: "mock-msg-id",
      ...options,
      priority: options.priority ?? "normal",
      timestamp: Date.now(),
      ack_required: options.ack_required ?? false,
    } as CocoMessage<T>;
  }

  async subscribe(agentName: string, handler: MessageHandler) {
    this.subscribedAgent = agentName;
    this.handler = handler;
  }

  async unsubscribe(_agentName: string) {
    this.subscribedAgent = null;
    this.handler = null;
  }

  get isReady() {
    return true;
  }
}

// --- Helpers ---

function ghPRListResponse(prs: Array<{
  number: number;
  title: string;
  headRefName: string;
  url: string;
  login: string;
}>) {
  return JSON.stringify(
    prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
      url: pr.url,
      author: { login: pr.login },
    })),
  );
}

function ghChecksResponse(checks: Array<{
  name: string;
  state: string;
  conclusion: string;
  detailsUrl?: string;
}>) {
  return JSON.stringify(
    checks.map((c) => ({
      name: c.name,
      state: c.state,
      conclusion: c.conclusion,
      detailsUrl: c.detailsUrl ?? "",
    })),
  );
}

function createTemperer(
  execFn: ExecFn,
  broker?: MockBroker,
): { temperer: Temperer; broker: MockBroker } {
  const mockBroker = broker ?? new MockBroker();
  const temperer = new Temperer(
    {
      repoPath: "/tmp/test-repo",
      repoName: "test-repo",
      broker: mockBroker as unknown as MessageBroker,
      pollIntervalMs: 60000,
      label: "cocopilot",
    },
    execFn,
  );
  return { temperer, broker: mockBroker };
}

// --- Tests ---

describe("Temperer", () => {
  describe("listOpenPRs", () => {
    it("parses gh pr list JSON output", async () => {
      const execFn: ExecFn = async (_file, _args, _opts) => ({
        stdout: ghPRListResponse([
          {
            number: 42,
            title: "feat: add auth",
            headRefName: "work/Snickers",
            url: "https://github.com/org/repo/pull/42",
            login: "bot",
          },
          {
            number: 43,
            title: "fix: typo",
            headRefName: "work/KitKat",
            url: "https://github.com/org/repo/pull/43",
            login: "bot",
          },
        ]),
        stderr: "",
      });

      const { temperer } = createTemperer(execFn);
      const prs = await temperer.listOpenPRs();

      expect(prs).toHaveLength(2);
      expect(prs[0]).toEqual({
        number: 42,
        title: "feat: add auth",
        headRefName: "work/Snickers",
        url: "https://github.com/org/repo/pull/42",
        author: "bot",
      });
    });

    it("returns empty array when gh command fails", async () => {
      const execFn: ExecFn = async () => {
        throw new Error("gh not found");
      };

      const { temperer } = createTemperer(execFn);
      const prs = await temperer.listOpenPRs();
      expect(prs).toEqual([]);
    });

    it("passes correct arguments to gh", async () => {
      let capturedArgs: string[] = [];
      let capturedCwd = "";

      const execFn: ExecFn = async (_file, args, opts) => {
        capturedArgs = args;
        capturedCwd = opts.cwd;
        return { stdout: "[]", stderr: "" };
      };

      const { temperer } = createTemperer(execFn);
      await temperer.listOpenPRs();

      expect(capturedArgs).toEqual([
        "pr", "list",
        "--state", "open",
        "--label", "cocopilot",
        "--json", "number,title,headRefName,url,author",
        "--limit", "100",
      ]);
      expect(capturedCwd).toBe("/tmp/test-repo");
    });
  });

  describe("checkCI", () => {
    it("returns passing when all checks succeed", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[1] === "checks") {
          return {
            stdout: ghChecksResponse([
              { name: "build", state: "COMPLETED", conclusion: "SUCCESS" },
              { name: "test", state: "COMPLETED", conclusion: "SUCCESS" },
            ]),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { temperer } = createTemperer(execFn);
      const result = await temperer.checkCI(42);

      expect(result.status).toBe("passing");
      expect(result.checks).toHaveLength(2);
    });

    it("returns failing with summary when checks fail", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[1] === "checks") {
          return {
            stdout: ghChecksResponse([
              { name: "build", state: "COMPLETED", conclusion: "SUCCESS" },
              {
                name: "test",
                state: "COMPLETED",
                conclusion: "FAILURE",
                detailsUrl: "https://github.com/org/repo/actions/runs/123",
              },
            ]),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { temperer } = createTemperer(execFn);
      const result = await temperer.checkCI(42);

      expect(result.status).toBe("failing");
      expect(result.failureSummary).toContain("1 CI check(s) failed:");
      expect(result.failureSummary).toContain("test");
      expect(result.workflowUrl).toBe(
        "https://github.com/org/repo/actions/runs/123",
      );
    });

    it("returns pending when checks are in progress", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[1] === "checks") {
          return {
            stdout: ghChecksResponse([
              { name: "build", state: "IN_PROGRESS", conclusion: "" },
            ]),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { temperer } = createTemperer(execFn);
      const result = await temperer.checkCI(42);

      expect(result.status).toBe("pending");
    });

    it("returns no_checks when no checks exist", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[1] === "checks") {
          return { stdout: "[]", stderr: "" };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { temperer } = createTemperer(execFn);
      const result = await temperer.checkCI(42);

      expect(result.status).toBe("no_checks");
    });

    it("returns no_checks when gh command fails", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[1] === "checks") {
          throw new Error("gh api error");
        }
        return { stdout: "[]", stderr: "" };
      };

      const { temperer } = createTemperer(execFn);
      const result = await temperer.checkCI(42);

      expect(result.status).toBe("no_checks");
      expect(result.checks).toEqual([]);
    });
  });

  describe("pollOnce", () => {
    it("merges a PR when CI passes and sends PR_MERGED message", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return {
            stdout: ghPRListResponse([
              {
                number: 10,
                title: "feat: thing",
                headRefName: "work/Twix",
                url: "https://github.com/org/repo/pull/10",
                login: "bot",
              },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "checks") {
          return {
            stdout: ghChecksResponse([
              { name: "build", state: "COMPLETED", conclusion: "SUCCESS" },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "merge") {
          return {
            stdout: "Merged via abc123def456789012345678901234567890abcd",
            stderr: "",
          };
        }
        return { stdout: "", stderr: "" };
      };

      const { temperer, broker } = createTemperer(execFn);

      // start() subscribes + does first poll (discovers PR -> awaiting_security_review)
      await temperer.start();

      // Simulate security review passing via the handler registered during start()
      await broker.handler!({
        id: "sec-1",
        type: MessageType.SECURITY_REVIEW_PASSED,
        from: "security-reviewer:test-repo",
        to: "temperer:test-repo",
        payload: { prNumber: 10, warnings: [] },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      });

      // Second poll: CI passes, security passed -> merge
      broker.sent = [];
      await temperer.pollOnce();

      // Should have sent PR_MERGED to chocolatier
      const mergeMsg = broker.sent.find(
        (m) => m.type === MessageType.PR_MERGED,
      );
      expect(mergeMsg).toBeDefined();
      expect(mergeMsg!.to).toBe("chocolatier:test-repo");
      expect(mergeMsg!.payload).toEqual({
        pr_number: 10,
        pr_url: "https://github.com/org/repo/pull/10",
        merge_sha: "abc123def456789012345678901234567890abcd",
      });

      // PR should be tracked as merged
      const tracked = temperer.getTrackedPRs().get(10);
      expect(tracked?.state).toBe("merged");

      await temperer.stop();
    });

    it("sends CI_FAILED and SPAWN_FIXUP when CI fails", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return {
            stdout: ghPRListResponse([
              {
                number: 20,
                title: "feat: broken",
                headRefName: "work/MilkyWay",
                url: "https://github.com/org/repo/pull/20",
                login: "bot",
              },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "checks") {
          return {
            stdout: ghChecksResponse([
              {
                name: "test",
                state: "COMPLETED",
                conclusion: "FAILURE",
                detailsUrl: "https://github.com/org/repo/actions/runs/999",
              },
            ]),
            stderr: "",
          };
        }
        return { stdout: "", stderr: "" };
      };

      const { temperer, broker } = createTemperer(execFn);

      // start() subscribes + does first poll (discovers PR -> awaiting_security_review)
      await temperer.start();

      // Simulate security review passing via the handler registered during start()
      await broker.handler!({
        id: "sec-1",
        type: MessageType.SECURITY_REVIEW_PASSED,
        from: "security-reviewer:test-repo",
        to: "temperer:test-repo",
        payload: { prNumber: 20, warnings: [] },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      });

      // Second poll: CI fails
      broker.sent = [];
      await temperer.pollOnce();

      // Should have sent CI_FAILED
      const ciMsg = broker.sent.find((m) => m.type === MessageType.CI_FAILED);
      expect(ciMsg).toBeDefined();
      expect(ciMsg!.to).toBe("chocolatier:test-repo");
      expect(ciMsg!.priority).toBe("high");
      expect((ciMsg!.payload as { pr_number: number }).pr_number).toBe(20);
      expect((ciMsg!.payload as { pr_url: string }).pr_url).toBe("https://github.com/org/repo/pull/20");
      expect((ciMsg!.payload as { failure_summary: string }).failure_summary).toContain("1 CI check(s) failed:");
      expect((ciMsg!.payload as { failure_summary: string }).failure_summary).toContain("test");
      expect((ciMsg!.payload as { workflow_url: string }).workflow_url).toBe("https://github.com/org/repo/actions/runs/999");

      // Should have sent SPAWN_FIXUP
      const fixupMsg = broker.sent.find(
        (m) => m.type === MessageType.SPAWN_FIXUP,
      );
      expect(fixupMsg).toBeDefined();
      expect(fixupMsg!.to).toBe("chocolatier:test-repo");
      expect((fixupMsg!.payload as { pr_number: number }).pr_number).toBe(20);
      expect((fixupMsg!.payload as { pr_url: string }).pr_url).toBe("https://github.com/org/repo/pull/20");
      expect((fixupMsg!.payload as { failure_summary: string }).failure_summary).toContain("1 CI check(s) failed:");
      expect((fixupMsg!.payload as { original_worker: string }).original_worker).toBe("unknown");

      // PR should be tracked as fixup_requested
      const tracked = temperer.getTrackedPRs().get(20);
      expect(tracked?.state).toBe("fixup_requested");

      await temperer.stop();
    });

    it("does not re-request fixup for PRs already in fixup_requested state", async () => {
      let pollCount = 0;
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return {
            stdout: ghPRListResponse([
              {
                number: 30,
                title: "feat: still broken",
                headRefName: "work/Reese",
                url: "https://github.com/org/repo/pull/30",
                login: "bot",
              },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "checks") {
          return {
            stdout: ghChecksResponse([
              { name: "test", state: "COMPLETED", conclusion: "FAILURE" },
            ]),
            stderr: "",
          };
        }
        return { stdout: "", stderr: "" };
      };

      const { temperer, broker } = createTemperer(execFn);

      // start() subscribes + does first poll (discovers PR -> awaiting_security_review)
      await temperer.start();

      // Simulate security review passing via the handler registered during start()
      await broker.handler!({
        id: "sec-1",
        type: MessageType.SECURITY_REVIEW_PASSED,
        from: "security-reviewer:test-repo",
        to: "temperer:test-repo",
        payload: { prNumber: 30, warnings: [] },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      });

      // Second poll: CI fails, should send fixup request
      broker.sent = [];
      await temperer.pollOnce();
      pollCount = broker.sent.filter(
        (m) => m.type === MessageType.SPAWN_FIXUP,
      ).length;
      expect(pollCount).toBe(1);

      // Third poll: should NOT send another fixup request
      await temperer.pollOnce();
      pollCount = broker.sent.filter(
        (m) => m.type === MessageType.SPAWN_FIXUP,
      ).length;
      expect(pollCount).toBe(1);

      await temperer.stop();
    });

    it("skips PRs with pending checks", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return {
            stdout: ghPRListResponse([
              {
                number: 40,
                title: "feat: pending",
                headRefName: "work/Butterfinger",
                url: "https://github.com/org/repo/pull/40",
                login: "bot",
              },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "checks") {
          return {
            stdout: ghChecksResponse([
              { name: "build", state: "QUEUED", conclusion: "" },
            ]),
            stderr: "",
          };
        }
        return { stdout: "", stderr: "" };
      };

      const { temperer, broker } = createTemperer(execFn);

      // start() subscribes + does first poll (discovers PR -> awaiting_security_review)
      await temperer.start();

      // Simulate security review passing via the handler registered during start()
      await broker.handler!({
        id: "sec-1",
        type: MessageType.SECURITY_REVIEW_PASSED,
        from: "security-reviewer:test-repo",
        to: "temperer:test-repo",
        payload: { prNumber: 40, warnings: [] },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      });

      // Second poll: CI pending, no merge/fixup messages
      broker.sent = [];
      await temperer.pollOnce();

      // No messages should be sent (pending checks = no action)
      expect(broker.sent).toHaveLength(0);

      // PR should be tracked as watching
      const tracked = temperer.getTrackedPRs().get(40);
      expect(tracked?.state).toBe("watching");

      await temperer.stop();
    });

    it("cleans up tracked PRs that are no longer open", async () => {
      let returnPRs = true;
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          if (returnPRs) {
            return {
              stdout: ghPRListResponse([
                {
                  number: 50,
                  title: "feat: temp",
                  headRefName: "work/Skittles",
                  url: "https://github.com/org/repo/pull/50",
                  login: "bot",
                },
              ]),
              stderr: "",
            };
          }
          return { stdout: "[]", stderr: "" };
        }
        if (args[0] === "pr" && args[1] === "checks") {
          return {
            stdout: ghChecksResponse([
              { name: "build", state: "QUEUED", conclusion: "" },
            ]),
            stderr: "",
          };
        }
        return { stdout: "", stderr: "" };
      };

      const { temperer, broker } = createTemperer(execFn);

      // start() subscribes + does first poll (discovers PR -> awaiting_security_review)
      await temperer.start();
      expect(temperer.getTrackedPRs().has(50)).toBe(true);

      // Simulate security review passing via the handler registered during start()
      await broker.handler!({
        id: "sec-1",
        type: MessageType.SECURITY_REVIEW_PASSED,
        from: "security-reviewer:test-repo",
        to: "temperer:test-repo",
        payload: { prNumber: 50, warnings: [] },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      });

      // Second poll: PR 50 is no longer open
      returnPRs = false;
      await temperer.pollOnce();
      expect(temperer.getTrackedPRs().has(50)).toBe(false);

      await temperer.stop();
    });

    it("skips already-merged PRs", async () => {
      let callCount = 0;
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return {
            stdout: ghPRListResponse([
              {
                number: 60,
                title: "feat: merged",
                headRefName: "work/Dove",
                url: "https://github.com/org/repo/pull/60",
                login: "bot",
              },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "checks") {
          callCount++;
          return {
            stdout: ghChecksResponse([
              { name: "build", state: "COMPLETED", conclusion: "SUCCESS" },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "merge") {
          return { stdout: "merged abc123def456789012345678901234567890abcd", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      };

      const { temperer, broker } = createTemperer(execFn);

      // start() subscribes + does first poll (discovers PR -> awaiting_security_review)
      await temperer.start();

      // Simulate security review passing via the handler registered during start()
      await broker.handler!({
        id: "sec-1",
        type: MessageType.SECURITY_REVIEW_PASSED,
        from: "security-reviewer:test-repo",
        to: "temperer:test-repo",
        payload: { prNumber: 60, warnings: [] },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      });

      // Second poll: CI passes, security passed -> merge
      await temperer.pollOnce();
      expect(callCount).toBe(1);

      // Third poll: should skip checks entirely since PR is merged
      await temperer.pollOnce();
      expect(callCount).toBe(1); // no additional checks call

      await temperer.stop();
    });
  });

  describe("message handling", () => {
    it("tracks PRs from PR_CREATED messages with original worker", async () => {
      const execFn: ExecFn = async () => ({ stdout: "[]", stderr: "" });
      const { temperer, broker } = createTemperer(execFn);

      await temperer.start();

      // Simulate receiving a PR_CREATED message
      const prCreatedMsg: CocoMessage = {
        id: "msg-1",
        type: MessageType.PR_CREATED,
        from: "Snickers",
        to: "temperer",
        payload: {
          pr_number: 99,
          pr_url: "https://github.com/org/repo/pull/99",
          title: "feat: new feature",
          branch: "work/Snickers",
        },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      };

      // Invoke the handler directly
      await broker.handler!(prCreatedMsg);

      const tracked = temperer.getTrackedPRs().get(99);
      expect(tracked).toBeDefined();
      expect(tracked!.originalWorker).toBe("Snickers");
      expect(tracked!.state).toBe("awaiting_security_review");
      expect(tracked!.branch).toBe("work/Snickers");

      await temperer.stop();
    });

    it("includes original worker in SPAWN_FIXUP when known from PR_CREATED", async () => {
      // Start with no PRs so the initial pollOnce() in start() is a no-op.
      // After receiving PR_CREATED, manually call pollOnce() with the PR visible.
      let returnPR = false;
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          if (!returnPR) return { stdout: "[]", stderr: "" };
          return {
            stdout: ghPRListResponse([
              {
                number: 99,
                title: "feat: new feature",
                headRefName: "work/Snickers",
                url: "https://github.com/org/repo/pull/99",
                login: "bot",
              },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "checks") {
          return {
            stdout: ghChecksResponse([
              { name: "test", state: "COMPLETED", conclusion: "FAILURE" },
            ]),
            stderr: "",
          };
        }
        return { stdout: "", stderr: "" };
      };

      const { temperer, broker } = createTemperer(execFn);
      await temperer.start();

      // Simulate PR_CREATED from Snickers
      await broker.handler!({
        id: "msg-1",
        type: MessageType.PR_CREATED,
        from: "Snickers",
        to: "temperer",
        payload: {
          pr_number: 99,
          pr_url: "https://github.com/org/repo/pull/99",
          title: "feat: new feature",
          branch: "work/Snickers",
        },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      });

      // Simulate security review passing
      await broker.handler!({
        id: "sec-1",
        type: MessageType.SECURITY_REVIEW_PASSED,
        from: "security-reviewer:test-repo",
        to: "temperer:test-repo",
        payload: { prNumber: 99, warnings: [] },
        priority: "normal",
        timestamp: Date.now(),
        ack_required: false,
      });

      // Now make the PR visible and poll
      returnPR = true;
      await temperer.pollOnce();

      const fixupMsg = broker.sent.find(
        (m) => m.type === MessageType.SPAWN_FIXUP,
      );
      expect(fixupMsg).toBeDefined();
      expect((fixupMsg!.payload as { original_worker: string }).original_worker).toBe(
        "Snickers",
      );

      await temperer.stop();
    });
  });

  describe("lifecycle", () => {
    it("start sets isRunning to true, stop sets it to false", async () => {
      const execFn: ExecFn = async () => ({ stdout: "[]", stderr: "" });
      const { temperer } = createTemperer(execFn);

      expect(temperer.isRunning).toBe(false);

      await temperer.start();
      expect(temperer.isRunning).toBe(true);

      await temperer.stop();
      expect(temperer.isRunning).toBe(false);
    });

    it("start is idempotent", async () => {
      const execFn: ExecFn = async () => ({ stdout: "[]", stderr: "" });
      const mockBroker = new MockBroker();
      const { temperer } = createTemperer(execFn, mockBroker);

      await temperer.start();
      await temperer.start(); // should not throw or double-subscribe

      await temperer.stop();
    });

    it("subscribes with correct agent name", async () => {
      const execFn: ExecFn = async () => ({ stdout: "[]", stderr: "" });
      const mockBroker = new MockBroker();
      const { temperer } = createTemperer(execFn, mockBroker);

      await temperer.start();
      expect(mockBroker.subscribedAgent).toBe("temperer:test-repo");

      await temperer.stop();
      expect(mockBroker.subscribedAgent).toBeNull();
    });
  });
});
