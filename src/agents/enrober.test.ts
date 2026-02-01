import {
  Enrober,
  ENROBER_SYSTEM_PROMPT,
  type ExecFn,
} from "./enrober";
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

function ghPRListResponse(
  prs: Array<{
    number: number;
    title: string;
    headRefName: string;
    url: string;
    login: string;
    isDraft?: boolean;
    reviewDecision?: string;
  }>,
) {
  return JSON.stringify(
    prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
      url: pr.url,
      author: { login: pr.login },
      isDraft: pr.isDraft ?? false,
      reviewDecision: pr.reviewDecision ?? "",
    })),
  );
}

function ghPRViewResponse(reviews: Array<{
  login: string;
  state: string;
  submittedAt: string;
}>, reviewRequests: Array<{ login: string }> = []) {
  return JSON.stringify({
    reviews: reviews.map((r) => ({
      author: { login: r.login },
      state: r.state,
      submittedAt: r.submittedAt,
    })),
    reviewRequests: reviewRequests.map((r) => ({ login: r.login })),
  });
}

function ghChecksResponse(checks: Array<{
  name: string;
  state: string;
  conclusion: string;
}>) {
  return JSON.stringify(
    checks.map((c) => ({
      name: c.name,
      state: c.state,
      conclusion: c.conclusion,
    })),
  );
}

function createEnrober(
  execFn: ExecFn,
  broker?: MockBroker,
): { enrober: Enrober; broker: MockBroker } {
  const mockBroker = broker ?? new MockBroker();
  const enrober = new Enrober(
    {
      repoPath: "/tmp/test-repo",
      repoName: "test-repo",
      broker: mockBroker as unknown as MessageBroker,
      pollIntervalMs: 60000,
      label: "cocopilot",
    },
    execFn,
  );
  return { enrober, broker: mockBroker };
}

// --- Tests ---

describe("Enrober", () => {
  describe("listOpenPRs", () => {
    it("parses gh pr list JSON output with review fields", async () => {
      const execFn: ExecFn = async (_file, _args, _opts) => ({
        stdout: ghPRListResponse([
          {
            number: 42,
            title: "feat: add auth",
            headRefName: "work/Snickers",
            url: "https://github.com/org/repo/pull/42",
            login: "bot",
            isDraft: false,
            reviewDecision: "REVIEW_REQUIRED",
          },
        ]),
        stderr: "",
      });

      const { enrober } = createEnrober(execFn);
      const prs = await enrober.listOpenPRs();

      expect(prs).toHaveLength(1);
      expect(prs[0]).toEqual({
        number: 42,
        title: "feat: add auth",
        headRefName: "work/Snickers",
        url: "https://github.com/org/repo/pull/42",
        author: "bot",
        isDraft: false,
        reviewDecision: "REVIEW_REQUIRED",
      });
    });

    it("returns empty array when gh command fails", async () => {
      const execFn: ExecFn = async () => {
        throw new Error("gh not found");
      };

      const { enrober } = createEnrober(execFn);
      const prs = await enrober.listOpenPRs();
      expect(prs).toEqual([]);
    });

    it("passes correct arguments including review fields to gh", async () => {
      let capturedArgs: string[] = [];

      const execFn: ExecFn = async (_file, args, _opts) => {
        capturedArgs = args;
        return { stdout: "[]", stderr: "" };
      };

      const { enrober } = createEnrober(execFn);
      await enrober.listOpenPRs();

      expect(capturedArgs).toEqual([
        "pr", "list",
        "--state", "open",
        "--label", "cocopilot",
        "--json", "number,title,headRefName,url,author,isDraft,reviewDecision",
        "--limit", "100",
      ]);
    });
  });

  describe("checkApproval", () => {
    it("returns approved state when reviewer has approved", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "view") {
          return {
            stdout: ghPRViewResponse([
              { login: "reviewer1", state: "APPROVED", submittedAt: "2026-01-28T00:00:00Z" },
            ]),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { enrober } = createEnrober(execFn);
      const state = await enrober.checkApproval(42);

      expect(state.approved).toBe(true);
      expect(state.approvalCount).toBe(1);
      expect(state.changesRequested).toBe(false);
      expect(state.reviewers).toHaveLength(1);
      expect(state.reviewers[0].state).toBe("APPROVED");
    });

    it("returns changesRequested when reviewer requests changes", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "view") {
          return {
            stdout: ghPRViewResponse([
              { login: "reviewer1", state: "CHANGES_REQUESTED", submittedAt: "2026-01-28T00:00:00Z" },
            ]),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { enrober } = createEnrober(execFn);
      const state = await enrober.checkApproval(42);

      expect(state.approved).toBe(false);
      expect(state.changesRequested).toBe(true);
    });

    it("includes pending reviewers from reviewRequests", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "view") {
          return {
            stdout: ghPRViewResponse(
              [],
              [{ login: "reviewer1" }, { login: "reviewer2" }],
            ),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { enrober } = createEnrober(execFn);
      const state = await enrober.checkApproval(42);

      expect(state.approved).toBe(false);
      expect(state.approvalCount).toBe(0);
      expect(state.reviewers).toHaveLength(2);
      expect(state.reviewers.every((r) => r.state === "PENDING")).toBe(true);
    });

    it("uses latest review per reviewer", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "view") {
          return {
            stdout: ghPRViewResponse([
              { login: "reviewer1", state: "CHANGES_REQUESTED", submittedAt: "2026-01-27T00:00:00Z" },
              { login: "reviewer1", state: "APPROVED", submittedAt: "2026-01-28T00:00:00Z" },
            ]),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { enrober } = createEnrober(execFn);
      const state = await enrober.checkApproval(42);

      expect(state.approved).toBe(true);
      expect(state.approvalCount).toBe(1);
      expect(state.changesRequested).toBe(false);
      expect(state.reviewers).toHaveLength(1);
      expect(state.reviewers[0].state).toBe("APPROVED");
    });

    it("returns empty state when gh command fails", async () => {
      const execFn: ExecFn = async () => {
        throw new Error("gh api error");
      };

      const { enrober } = createEnrober(execFn);
      const state = await enrober.checkApproval(42);

      expect(state.approved).toBe(false);
      expect(state.reviewers).toEqual([]);
    });
  });

  describe("isCIPassing", () => {
    it("returns true when all checks pass", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "checks") {
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

      const { enrober } = createEnrober(execFn);
      const passing = await enrober.isCIPassing(42);
      expect(passing).toBe(true);
    });

    it("returns false when any check fails", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "checks") {
          return {
            stdout: ghChecksResponse([
              { name: "build", state: "COMPLETED", conclusion: "SUCCESS" },
              { name: "test", state: "COMPLETED", conclusion: "FAILURE" },
            ]),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { enrober } = createEnrober(execFn);
      const passing = await enrober.isCIPassing(42);
      expect(passing).toBe(false);
    });

    it("returns false when no checks exist", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "checks") {
          return { stdout: "[]", stderr: "" };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { enrober } = createEnrober(execFn);
      const passing = await enrober.isCIPassing(42);
      expect(passing).toBe(false);
    });

    it("returns false when gh command fails", async () => {
      const execFn: ExecFn = async () => {
        throw new Error("gh api error");
      };

      const { enrober } = createEnrober(execFn);
      const passing = await enrober.isCIPassing(42);
      expect(passing).toBe(false);
    });

    it("treats NEUTRAL and SKIPPED as passing", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "checks") {
          return {
            stdout: ghChecksResponse([
              { name: "build", state: "COMPLETED", conclusion: "SUCCESS" },
              { name: "optional", state: "COMPLETED", conclusion: "NEUTRAL" },
              { name: "skipped", state: "COMPLETED", conclusion: "SKIPPED" },
            ]),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { enrober } = createEnrober(execFn);
      const passing = await enrober.isCIPassing(42);
      expect(passing).toBe(true);
    });
  });

  describe("pollOnce", () => {
    it("skips draft PRs", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return {
            stdout: ghPRListResponse([
              {
                number: 10,
                title: "feat: wip",
                headRefName: "work/Twix",
                url: "https://github.com/org/repo/pull/10",
                login: "bot",
                isDraft: true,
              },
            ]),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { enrober, broker } = createEnrober(execFn);
      await enrober.pollOnce();

      // Should not track draft PRs
      expect(enrober.getTrackedPRs().size).toBe(0);
      expect(broker.sent).toHaveLength(0);
    });

    it("surfaces blocked PR when no reviewers assigned", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return {
            stdout: ghPRListResponse([
              {
                number: 20,
                title: "feat: needs review",
                headRefName: "work/Reese",
                url: "https://github.com/org/repo/pull/20",
                login: "bot",
              },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "view") {
          return {
            stdout: ghPRViewResponse([], []),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { enrober, broker } = createEnrober(execFn);
      await enrober.pollOnce();

      const tracked = enrober.getTrackedPRs().get(20);
      expect(tracked?.state).toBe("blocked");
      expect(tracked?.blockedReason).toBe("no_reviewers");

      // Should broadcast blocked PR
      const broadcastMsg = broker.sent.find(
        (m) => m.type === MessageType.BROADCAST,
      );
      expect(broadcastMsg).toBeDefined();
      expect(
        (broadcastMsg!.payload as { message: string }).message,
      ).toContain("blocked");
      expect(
        (broadcastMsg!.payload as { message: string }).message,
      ).toContain("No reviewers assigned");
    });

    it("marks PR as changes_requested and notifies when reviewer requests changes", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return {
            stdout: ghPRListResponse([
              {
                number: 30,
                title: "feat: review me",
                headRefName: "work/KitKat",
                url: "https://github.com/org/repo/pull/30",
                login: "bot",
              },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "view") {
          return {
            stdout: ghPRViewResponse([
              { login: "alice", state: "CHANGES_REQUESTED", submittedAt: "2026-01-28T00:00:00Z" },
            ]),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { enrober, broker } = createEnrober(execFn);
      await enrober.pollOnce();

      const tracked = enrober.getTrackedPRs().get(30);
      expect(tracked?.state).toBe("changes_requested");

      // Should broadcast changes requested
      const broadcastMsg = broker.sent.find(
        (m) =>
          m.type === MessageType.BROADCAST &&
          (m.payload as { message: string }).message.includes("changes requested"),
      );
      expect(broadcastMsg).toBeDefined();
    });

    it("marks PR as ready_to_merge when approved and CI passing", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return {
            stdout: ghPRListResponse([
              {
                number: 40,
                title: "feat: approved",
                headRefName: "work/MilkyWay",
                url: "https://github.com/org/repo/pull/40",
                login: "bot",
              },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "view") {
          return {
            stdout: ghPRViewResponse([
              { login: "alice", state: "APPROVED", submittedAt: "2026-01-28T00:00:00Z" },
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
        if (args[0] === "pr" && args[1] === "comment") {
          return { stdout: "", stderr: "" };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { enrober, broker } = createEnrober(execFn);
      await enrober.pollOnce();

      const tracked = enrober.getTrackedPRs().get(40);
      expect(tracked?.state).toBe("ready_to_merge");

      // Should broadcast ready to merge
      const broadcastMsg = broker.sent.find(
        (m) =>
          m.type === MessageType.BROADCAST &&
          (m.payload as { message: string }).message.includes("ready to merge"),
      );
      expect(broadcastMsg).toBeDefined();
    });

    it("marks PR as approved when approved but CI not passing", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return {
            stdout: ghPRListResponse([
              {
                number: 45,
                title: "feat: approved no CI",
                headRefName: "work/Dove",
                url: "https://github.com/org/repo/pull/45",
                login: "bot",
              },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "view") {
          return {
            stdout: ghPRViewResponse([
              { login: "alice", state: "APPROVED", submittedAt: "2026-01-28T00:00:00Z" },
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
        return { stdout: "[]", stderr: "" };
      };

      const { enrober } = createEnrober(execFn);
      await enrober.pollOnce();

      const tracked = enrober.getTrackedPRs().get(45);
      expect(tracked?.state).toBe("approved");
    });

    it("does not re-surface already blocked PRs with same reason", async () => {
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return {
            stdout: ghPRListResponse([
              {
                number: 50,
                title: "feat: still blocked",
                headRefName: "work/Starburst",
                url: "https://github.com/org/repo/pull/50",
                login: "bot",
              },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "view") {
          return {
            stdout: ghPRViewResponse([], []),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { enrober, broker } = createEnrober(execFn);

      // First poll — should broadcast blocked
      await enrober.pollOnce();
      const firstCount = broker.sent.filter(
        (m) => m.type === MessageType.BROADCAST,
      ).length;
      expect(firstCount).toBe(1);

      // Second poll — should NOT broadcast again (same reason)
      await enrober.pollOnce();
      const secondCount = broker.sent.filter(
        (m) => m.type === MessageType.BROADCAST,
      ).length;
      expect(secondCount).toBe(1);
    });

    it("never auto-merges — only notifies", async () => {
      let mergeAttempted = false;
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "merge") {
          mergeAttempted = true;
        }
        if (args[0] === "pr" && args[1] === "list") {
          return {
            stdout: ghPRListResponse([
              {
                number: 60,
                title: "feat: ready",
                headRefName: "work/Butterfinger",
                url: "https://github.com/org/repo/pull/60",
                login: "bot",
              },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "view") {
          return {
            stdout: ghPRViewResponse([
              { login: "alice", state: "APPROVED", submittedAt: "2026-01-28T00:00:00Z" },
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
        return { stdout: "", stderr: "" };
      };

      const { enrober } = createEnrober(execFn);
      await enrober.pollOnce();

      // The Enrober should NEVER call gh pr merge
      expect(mergeAttempted).toBe(false);
    });

    it("cleans up tracked PRs that are no longer open", async () => {
      let returnPRs = true;
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          if (returnPRs) {
            return {
              stdout: ghPRListResponse([
                {
                  number: 70,
                  title: "feat: temp",
                  headRefName: "work/Skittles",
                  url: "https://github.com/org/repo/pull/70",
                  login: "bot",
                },
              ]),
              stderr: "",
            };
          }
          return { stdout: "[]", stderr: "" };
        }
        if (args[0] === "pr" && args[1] === "view") {
          return {
            stdout: ghPRViewResponse([], [{ login: "reviewer1" }]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "comment") {
          return { stdout: "", stderr: "" };
        }
        return { stdout: "[]", stderr: "" };
      };

      const { enrober } = createEnrober(execFn);

      // First poll
      await enrober.pollOnce();
      expect(enrober.getTrackedPRs().has(70)).toBe(true);

      // Second poll — PR no longer open
      returnPRs = false;
      await enrober.pollOnce();
      expect(enrober.getTrackedPRs().has(70)).toBe(false);
    });

    it("skips ready_to_merge PRs on subsequent polls", async () => {
      let viewCallCount = 0;
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "list") {
          return {
            stdout: ghPRListResponse([
              {
                number: 80,
                title: "feat: merged",
                headRefName: "work/Dove",
                url: "https://github.com/org/repo/pull/80",
                login: "bot",
              },
            ]),
            stderr: "",
          };
        }
        if (args[0] === "pr" && args[1] === "view") {
          viewCallCount++;
          return {
            stdout: ghPRViewResponse([
              { login: "alice", state: "APPROVED", submittedAt: "2026-01-28T00:00:00Z" },
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
        return { stdout: "", stderr: "" };
      };

      const { enrober } = createEnrober(execFn);

      // First poll — marks as ready_to_merge
      await enrober.pollOnce();
      expect(viewCallCount).toBe(1);

      // Second poll — should skip the ready_to_merge PR
      await enrober.pollOnce();
      expect(viewCallCount).toBe(1); // no additional view call
    });
  });

  describe("message handling", () => {
    it("tracks PRs from PR_CREATED messages with original worker", async () => {
      const execFn: ExecFn = async () => ({ stdout: "[]", stderr: "" });
      const { enrober, broker } = createEnrober(execFn);

      await enrober.start();

      // Simulate receiving a PR_CREATED message
      await broker.handler!({
        id: "msg-1",
        type: MessageType.PR_CREATED,
        from: "Snickers",
        to: "enrober",
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

      const tracked = enrober.getTrackedPRs().get(99);
      expect(tracked).toBeDefined();
      expect(tracked!.originalWorker).toBe("Snickers");
      expect(tracked!.state).toBe("needs_review");
      expect(tracked!.branch).toBe("work/Snickers");

      await enrober.stop();
    });
  });

  describe("lifecycle", () => {
    it("start sets isRunning to true, stop sets it to false", async () => {
      const execFn: ExecFn = async () => ({ stdout: "[]", stderr: "" });
      const { enrober } = createEnrober(execFn);

      expect(enrober.isRunning).toBe(false);

      await enrober.start();
      expect(enrober.isRunning).toBe(true);

      await enrober.stop();
      expect(enrober.isRunning).toBe(false);
    });

    it("start is idempotent", async () => {
      const execFn: ExecFn = async () => ({ stdout: "[]", stderr: "" });
      const mockBroker = new MockBroker();
      const { enrober } = createEnrober(execFn, mockBroker);

      await enrober.start();
      await enrober.start(); // should not throw or double-subscribe

      await enrober.stop();
    });

    it("subscribes with correct agent name", async () => {
      const execFn: ExecFn = async () => ({ stdout: "[]", stderr: "" });
      const mockBroker = new MockBroker();
      const { enrober } = createEnrober(execFn, mockBroker);

      await enrober.start();
      expect(mockBroker.subscribedAgent).toBe("enrober:test-repo");

      await enrober.stop();
      expect(mockBroker.subscribedAgent).toBeNull();
    });
  });

  describe("pingReviewers", () => {
    it("posts a comment on the PR", async () => {
      let commentArgs: string[] = [];
      const execFn: ExecFn = async (_file, args) => {
        if (args[0] === "pr" && args[1] === "comment") {
          commentArgs = args;
        }
        return { stdout: "", stderr: "" };
      };

      const { enrober } = createEnrober(execFn);
      await enrober.pingReviewers(42);

      expect(commentArgs[0]).toBe("pr");
      expect(commentArgs[1]).toBe("comment");
      expect(commentArgs[2]).toBe("42");
      expect(commentArgs[3]).toBe("--body");
      expect(commentArgs[4]).toContain("Enrober");
    });

    it("does not throw when comment fails", async () => {
      const execFn: ExecFn = async () => {
        throw new Error("comment failed");
      };

      const { enrober } = createEnrober(execFn);
      // Should not throw
      await expect(enrober.pingReviewers(42)).resolves.toBeUndefined();
    });
  });

  describe("getToolDefinitions", () => {
    it("returns three tool definitions", () => {
      const execFn: ExecFn = async () => ({ stdout: "[]", stderr: "" });
      const { enrober } = createEnrober(execFn);
      const tools = enrober.getToolDefinitions();

      expect(tools).toHaveLength(3);
      const names = tools.map((t) => t.name);
      expect(names).toContain("list_prs");
      expect(names).toContain("check_approval");
      expect(names).toContain("notify_reviewers");
    });

    it("list_prs handler returns tracked PRs", async () => {
      const execFn: ExecFn = async () => ({ stdout: "[]", stderr: "" });
      const { enrober } = createEnrober(execFn);

      const tools = enrober.getToolDefinitions();
      const listTool = tools.find((t) => t.name === "list_prs")!;
      const result = (await listTool.handler({})) as { count: number };
      expect(result.count).toBe(0);
    });
  });

  describe("getSystemPrompt", () => {
    it("returns the system prompt", () => {
      const execFn: ExecFn = async () => ({ stdout: "[]", stderr: "" });
      const { enrober } = createEnrober(execFn);
      const prompt = enrober.getSystemPrompt();
      expect(prompt).toBe(ENROBER_SYSTEM_PROMPT);
      expect(prompt).toContain("Enrober");
      expect(prompt).toContain("PR shepherd");
      expect(prompt).toContain("Never auto-merge");
    });
  });
});
