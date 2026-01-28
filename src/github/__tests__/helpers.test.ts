import type { ExecFn } from "../types";
import {
  createPR,
  listPRs,
  getCIStatus,
  mergePR,
  addLabels,
  getPRReviews,
  getRepoInfo,
  type GitHubHelperContext,
} from "../helpers";

// --- Helpers ---

function makeCtx(execFn: ExecFn): GitHubHelperContext {
  return { repoPath: "/tmp/test-repo", execFn };
}

function successExec(stdout: string): ExecFn {
  return async () => ({ stdout, stderr: "" });
}

function failExec(message = "command failed"): ExecFn {
  return async () => {
    throw new Error(message);
  };
}

function ghPRListResponse(
  prs: Array<{
    number: number;
    title: string;
    headRefName: string;
    baseRefName?: string;
    url: string;
    login: string;
    isDraft?: boolean;
    state?: string;
    labels?: string[];
    createdAt?: string;
    updatedAt?: string;
  }>,
) {
  return JSON.stringify(
    prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName ?? "main",
      url: pr.url,
      author: { login: pr.login },
      isDraft: pr.isDraft ?? false,
      state: pr.state ?? "OPEN",
      labels: (pr.labels ?? []).map((l) => ({ name: l })),
      createdAt: pr.createdAt ?? "2026-01-28T00:00:00Z",
      updatedAt: pr.updatedAt ?? "2026-01-28T00:00:00Z",
    })),
  );
}

function ghChecksResponse(
  checks: Array<{
    name: string;
    state: string;
    conclusion: string;
    detailsUrl?: string;
  }>,
) {
  return JSON.stringify(
    checks.map((c) => ({
      name: c.name,
      state: c.state,
      conclusion: c.conclusion,
      detailsUrl: c.detailsUrl ?? "",
    })),
  );
}

// --- Tests ---

describe("GitHub Helpers", () => {
  describe("createPR", () => {
    it("passes correct arguments to gh pr create", async () => {
      let capturedArgs: string[] = [];
      let capturedCwd = "";

      const execFn: ExecFn = async (_file, args, opts) => {
        capturedArgs = args;
        capturedCwd = opts.cwd;
        return {
          stdout: "https://github.com/org/repo/pull/42\n",
          stderr: "",
        };
      };

      const result = await createPR(makeCtx(execFn), {
        title: "feat: add auth",
        body: "Adds authentication middleware",
        head: "work/Snickers",
      });

      expect(capturedArgs).toEqual([
        "pr", "create",
        "--title", "feat: add auth",
        "--body", "Adds authentication middleware",
        "--head", "work/Snickers",
      ]);
      expect(capturedCwd).toBe("/tmp/test-repo");
      expect(result.number).toBe(42);
      expect(result.url).toBe("https://github.com/org/repo/pull/42");
    });

    it("includes optional parameters when provided", async () => {
      let capturedArgs: string[] = [];

      const execFn: ExecFn = async (_file, args) => {
        capturedArgs = args;
        return {
          stdout: "https://github.com/org/repo/pull/99\n",
          stderr: "",
        };
      };

      await createPR(makeCtx(execFn), {
        title: "feat: draft PR",
        body: "Work in progress",
        head: "work/KitKat",
        base: "develop",
        draft: true,
        labels: ["cocopilot", "wip"],
      });

      expect(capturedArgs).toContain("--base");
      expect(capturedArgs).toContain("develop");
      expect(capturedArgs).toContain("--draft");
      expect(capturedArgs).toContain("--label");
      expect(capturedArgs).toContain("cocopilot,wip");
    });

    it("returns number 0 if URL format is unexpected", async () => {
      const result = await createPR(makeCtx(successExec("unexpected output\n")), {
        title: "test",
        body: "test",
        head: "branch",
      });

      expect(result.number).toBe(0);
      expect(result.url).toBe("unexpected output");
    });

    it("throws when gh command fails", async () => {
      await expect(
        createPR(makeCtx(failExec()), {
          title: "test",
          body: "test",
          head: "branch",
        }),
      ).rejects.toThrow();
    });
  });

  describe("listPRs", () => {
    it("parses gh pr list JSON output", async () => {
      const execFn = successExec(
        ghPRListResponse([
          {
            number: 42,
            title: "feat: add auth",
            headRefName: "work/Snickers",
            url: "https://github.com/org/repo/pull/42",
            login: "bot",
            labels: ["cocopilot"],
          },
          {
            number: 43,
            title: "fix: typo",
            headRefName: "work/KitKat",
            url: "https://github.com/org/repo/pull/43",
            login: "bot",
          },
        ]),
      );

      const prs = await listPRs(makeCtx(execFn));

      expect(prs).toHaveLength(2);
      expect(prs[0]).toEqual({
        number: 42,
        title: "feat: add auth",
        headRefName: "work/Snickers",
        baseRefName: "main",
        url: "https://github.com/org/repo/pull/42",
        author: "bot",
        isDraft: false,
        state: "OPEN",
        labels: ["cocopilot"],
        createdAt: "2026-01-28T00:00:00Z",
        updatedAt: "2026-01-28T00:00:00Z",
      });
    });

    it("passes filter options to gh", async () => {
      let capturedArgs: string[] = [];

      const execFn: ExecFn = async (_file, args) => {
        capturedArgs = args;
        return { stdout: "[]", stderr: "" };
      };

      await listPRs(makeCtx(execFn), {
        state: "closed",
        label: "cocopilot",
        limit: 50,
        base: "main",
      });

      expect(capturedArgs).toContain("--state");
      expect(capturedArgs[capturedArgs.indexOf("--state") + 1]).toBe("closed");
      expect(capturedArgs).toContain("--label");
      expect(capturedArgs[capturedArgs.indexOf("--label") + 1]).toBe("cocopilot");
      expect(capturedArgs).toContain("--limit");
      expect(capturedArgs[capturedArgs.indexOf("--limit") + 1]).toBe("50");
      expect(capturedArgs).toContain("--base");
      expect(capturedArgs[capturedArgs.indexOf("--base") + 1]).toBe("main");
    });

    it("returns empty array when gh command fails", async () => {
      const prs = await listPRs(makeCtx(failExec()));
      expect(prs).toEqual([]);
    });

    it("uses default options when none provided", async () => {
      let capturedArgs: string[] = [];

      const execFn: ExecFn = async (_file, args) => {
        capturedArgs = args;
        return { stdout: "[]", stderr: "" };
      };

      await listPRs(makeCtx(execFn));

      expect(capturedArgs).toContain("--state");
      expect(capturedArgs[capturedArgs.indexOf("--state") + 1]).toBe("open");
      expect(capturedArgs).toContain("--limit");
      expect(capturedArgs[capturedArgs.indexOf("--limit") + 1]).toBe("100");
    });
  });

  describe("getCIStatus", () => {
    it("returns passing when all checks succeed", async () => {
      const execFn = successExec(
        ghChecksResponse([
          { name: "build", state: "COMPLETED", conclusion: "SUCCESS" },
          { name: "test", state: "COMPLETED", conclusion: "SUCCESS" },
        ]),
      );

      const result = await getCIStatus(makeCtx(execFn), 42);

      expect(result.status).toBe("passing");
      expect(result.checks).toHaveLength(2);
      expect(result.checks[0]).toEqual({
        name: "build",
        status: "passed",
        category: "other",
        detailsUrl: "",
        conclusion: "SUCCESS",
      });
    });

    it("returns failing with summary when checks fail", async () => {
      const execFn = successExec(
        ghChecksResponse([
          { name: "build", state: "COMPLETED", conclusion: "SUCCESS" },
          {
            name: "test",
            state: "COMPLETED",
            conclusion: "FAILURE",
            detailsUrl: "https://github.com/org/repo/actions/runs/123",
          },
        ]),
      );

      const result = await getCIStatus(makeCtx(execFn), 42);

      expect(result.status).toBe("failing");
      expect(result.failureSummary).toBe("1 check(s) failed: test");
      expect(result.workflowUrl).toBe(
        "https://github.com/org/repo/actions/runs/123",
      );
    });

    it("treats TIMED_OUT and CANCELLED as failures", async () => {
      const execFn = successExec(
        ghChecksResponse([
          { name: "slow-test", state: "COMPLETED", conclusion: "TIMED_OUT" },
          { name: "cancelled-job", state: "COMPLETED", conclusion: "CANCELLED" },
        ]),
      );

      const result = await getCIStatus(makeCtx(execFn), 42);

      expect(result.status).toBe("failing");
      expect(result.failureSummary).toBe(
        "2 check(s) failed: slow-test, cancelled-job",
      );
    });

    it("returns pending when checks are in progress", async () => {
      const execFn = successExec(
        ghChecksResponse([
          { name: "build", state: "IN_PROGRESS", conclusion: "" },
        ]),
      );

      const result = await getCIStatus(makeCtx(execFn), 42);
      expect(result.status).toBe("pending");
    });

    it("returns pending for QUEUED checks", async () => {
      const execFn = successExec(
        ghChecksResponse([
          { name: "build", state: "QUEUED", conclusion: "" },
        ]),
      );

      const result = await getCIStatus(makeCtx(execFn), 42);
      expect(result.status).toBe("pending");
    });

    it("returns no_checks when no checks exist", async () => {
      const result = await getCIStatus(makeCtx(successExec("[]")), 42);
      expect(result.status).toBe("no_checks");
    });

    it("returns no_checks when gh command fails", async () => {
      const result = await getCIStatus(makeCtx(failExec()), 42);
      expect(result.status).toBe("no_checks");
      expect(result.checks).toEqual([]);
    });

    it("handles case-insensitive status values", async () => {
      const execFn = successExec(
        ghChecksResponse([
          { name: "build", state: "completed", conclusion: "failure" },
        ]),
      );

      const result = await getCIStatus(makeCtx(execFn), 42);
      expect(result.status).toBe("failing");
    });
  });

  describe("mergePR", () => {
    it("merges with squash by default and extracts SHA", async () => {
      let capturedArgs: string[] = [];

      const execFn: ExecFn = async (_file, args) => {
        capturedArgs = args;
        return {
          stdout: "Merged via abc123def456789012345678901234567890abcd",
          stderr: "",
        };
      };

      const result = await mergePR(makeCtx(execFn), 42);

      expect(capturedArgs).toEqual([
        "pr", "merge", "42", "--squash", "--delete-branch",
      ]);
      expect(result.merged).toBe(true);
      expect(result.sha).toBe("abc123def456789012345678901234567890abcd");
    });

    it("uses specified merge method", async () => {
      let capturedArgs: string[] = [];

      const execFn: ExecFn = async (_file, args) => {
        capturedArgs = args;
        return { stdout: "", stderr: "" };
      };

      await mergePR(makeCtx(execFn), 42, { method: "rebase", deleteBranch: false });

      expect(capturedArgs).toEqual(["pr", "merge", "42", "--rebase"]);
    });

    it("returns merged false when gh command fails", async () => {
      const result = await mergePR(makeCtx(failExec()), 42);
      expect(result.merged).toBe(false);
      expect(result.sha).toBe("");
    });

    it("returns unknown sha when output has no sha", async () => {
      const result = await mergePR(makeCtx(successExec("PR merged\n")), 42);
      expect(result.merged).toBe(true);
      expect(result.sha).toBe("unknown");
    });
  });

  describe("addLabels", () => {
    it("passes correct arguments to gh pr edit", async () => {
      let capturedArgs: string[] = [];

      const execFn: ExecFn = async (_file, args) => {
        capturedArgs = args;
        return { stdout: "", stderr: "" };
      };

      const result = await addLabels(makeCtx(execFn), 42, ["cocopilot", "bug"]);

      expect(capturedArgs).toEqual([
        "pr", "edit", "42", "--add-label", "cocopilot,bug",
      ]);
      expect(result).toBe(true);
    });

    it("returns true for empty labels (no-op)", async () => {
      const execFn: ExecFn = async () => {
        throw new Error("should not be called");
      };

      const result = await addLabels(makeCtx(execFn), 42, []);
      expect(result).toBe(true);
    });

    it("returns false when gh command fails", async () => {
      const result = await addLabels(makeCtx(failExec()), 42, ["cocopilot"]);
      expect(result).toBe(false);
    });
  });

  describe("getPRReviews", () => {
    it("parses review data from gh pr view", async () => {
      const execFn = successExec(
        JSON.stringify({
          reviews: [
            {
              author: { login: "reviewer1" },
              state: "APPROVED",
              body: "LGTM",
              submittedAt: "2026-01-28T12:00:00Z",
            },
            {
              author: { login: "reviewer2" },
              state: "CHANGES_REQUESTED",
              body: "Please fix the typo",
              submittedAt: "2026-01-28T13:00:00Z",
            },
          ],
        }),
      );

      const reviews = await getPRReviews(makeCtx(execFn), 42);

      expect(reviews).toHaveLength(2);
      expect(reviews[0]).toEqual({
        author: "reviewer1",
        state: "APPROVED",
        body: "LGTM",
        submittedAt: "2026-01-28T12:00:00Z",
      });
      expect(reviews[1].state).toBe("CHANGES_REQUESTED");
    });

    it("returns empty array when gh command fails", async () => {
      const reviews = await getPRReviews(makeCtx(failExec()), 42);
      expect(reviews).toEqual([]);
    });

    it("passes correct arguments to gh", async () => {
      let capturedArgs: string[] = [];

      const execFn: ExecFn = async (_file, args) => {
        capturedArgs = args;
        return { stdout: JSON.stringify({ reviews: [] }), stderr: "" };
      };

      await getPRReviews(makeCtx(execFn), 55);

      expect(capturedArgs).toEqual([
        "pr", "view", "55", "--json", "reviews",
      ]);
    });
  });

  describe("getRepoInfo", () => {
    it("parses repository information", async () => {
      const execFn = successExec(
        JSON.stringify({
          name: "cocopilot",
          nameWithOwner: "org/cocopilot",
          url: "https://github.com/org/cocopilot",
          defaultBranchRef: { name: "main" },
          isFork: false,
          parent: null,
          isPrivate: false,
        }),
      );

      const info = await getRepoInfo(makeCtx(execFn));

      expect(info).toEqual({
        name: "cocopilot",
        nameWithOwner: "org/cocopilot",
        url: "https://github.com/org/cocopilot",
        defaultBranch: "main",
        isFork: false,
        parent: null,
        isPrivate: false,
      });
    });

    it("parses fork information", async () => {
      const execFn = successExec(
        JSON.stringify({
          name: "cocopilot",
          nameWithOwner: "user/cocopilot",
          url: "https://github.com/user/cocopilot",
          defaultBranchRef: { name: "main" },
          isFork: true,
          parent: { nameWithOwner: "org/cocopilot" },
          isPrivate: false,
        }),
      );

      const info = await getRepoInfo(makeCtx(execFn));

      expect(info).not.toBeNull();
      expect(info!.isFork).toBe(true);
      expect(info!.parent).toBe("org/cocopilot");
    });

    it("returns null when gh command fails", async () => {
      const info = await getRepoInfo(makeCtx(failExec()));
      expect(info).toBeNull();
    });

    it("passes correct arguments to gh", async () => {
      let capturedArgs: string[] = [];

      const execFn: ExecFn = async (_file, args) => {
        capturedArgs = args;
        return {
          stdout: JSON.stringify({
            name: "repo",
            nameWithOwner: "org/repo",
            url: "https://github.com/org/repo",
            defaultBranchRef: { name: "main" },
            isFork: false,
            parent: null,
            isPrivate: false,
          }),
          stderr: "",
        };
      };

      await getRepoInfo(makeCtx(execFn));

      expect(capturedArgs).toEqual([
        "repo",
        "view",
        "--json",
        "name,nameWithOwner,url,defaultBranchRef,isFork,parent,isPrivate",
      ]);
    });
  });
});
