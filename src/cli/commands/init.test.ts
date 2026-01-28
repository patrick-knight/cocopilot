import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import {
  isValidGitHubUrl,
  repoNameFromUrl,
  initializeRepository,
  type InitDeps,
} from "./init";
import { StateManager } from "../../state/state-manager";
import type { ForkInfo } from "../../github/types";

// ---------------------------------------------------------------------------
// URL validation (existing tests)
// ---------------------------------------------------------------------------

describe("isValidGitHubUrl", () => {
  it("accepts valid GitHub HTTPS URLs", () => {
    expect(isValidGitHubUrl("https://github.com/owner/repo")).toBe(true);
    expect(isValidGitHubUrl("https://github.com/owner/repo.git")).toBe(true);
    expect(isValidGitHubUrl("https://github.com/my-org/my-repo")).toBe(true);
    expect(isValidGitHubUrl("https://github.com/user123/project.name")).toBe(
      true,
    );
  });

  it("accepts http URLs", () => {
    expect(isValidGitHubUrl("http://github.com/owner/repo")).toBe(true);
  });

  it("accepts www prefix", () => {
    expect(isValidGitHubUrl("https://www.github.com/owner/repo")).toBe(true);
  });

  it("rejects non-GitHub URLs", () => {
    expect(isValidGitHubUrl("https://gitlab.com/owner/repo")).toBe(false);
    expect(isValidGitHubUrl("https://bitbucket.org/owner/repo")).toBe(false);
  });

  it("rejects invalid formats", () => {
    expect(isValidGitHubUrl("not-a-url")).toBe(false);
    expect(isValidGitHubUrl("github.com/owner/repo")).toBe(false);
    expect(isValidGitHubUrl("https://github.com/owner")).toBe(false);
    expect(isValidGitHubUrl("https://github.com/")).toBe(false);
  });
});

describe("repoNameFromUrl", () => {
  it("extracts repo name from URL", () => {
    expect(repoNameFromUrl("https://github.com/owner/my-project")).toBe(
      "my-project",
    );
  });

  it("strips .git suffix", () => {
    expect(repoNameFromUrl("https://github.com/owner/my-project.git")).toBe(
      "my-project",
    );
  });
});

// ---------------------------------------------------------------------------
// initializeRepository
// ---------------------------------------------------------------------------

describe("initializeRepository", () => {
  let tmpDir: string;
  let stateManager: StateManager;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coco-init-test-"));
    stateManager = new StateManager(tmpDir);
    await stateManager.init();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeDeps(overrides?: Partial<InitDeps>): InitDeps {
    return {
      stateManager,
      execFn: jest.fn().mockResolvedValue({ stdout: "", stderr: "" }),
      detectForkFn: jest.fn().mockResolvedValue({
        isFork: false,
        defaultBranch: "main",
      } satisfies ForkInfo),
      mkdirFn: jest.fn().mockResolvedValue(undefined),
      writeFileFn: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  // --- Non-fork (single-player) initialization ---

  it("clones the repository via git clone", async () => {
    const deps = makeDeps();
    await initializeRepository(
      "https://github.com/acme/widgets",
      "widgets",
      deps,
    );

    expect(deps.execFn).toHaveBeenCalledWith(
      "git",
      ["clone", "https://github.com/acme/widgets", expect.stringContaining("widgets")],
    );
  });

  it("creates the repo directory structure", async () => {
    const deps = makeDeps();
    await initializeRepository(
      "https://github.com/acme/widgets",
      "widgets",
      deps,
    );

    expect(deps.mkdirFn).toHaveBeenCalledWith(
      expect.stringContaining(path.join("repos", "widgets")),
      { recursive: true },
    );
  });

  it("registers the repo in StateManager with single-player mode for non-forks", async () => {
    const deps = makeDeps();
    await initializeRepository(
      "https://github.com/acme/widgets",
      "widgets",
      deps,
    );

    const repo = stateManager.getRepo("widgets");
    expect(repo).toBeDefined();
    expect(repo!.mode).toBe("single-player");
    expect(repo!.status).toBe("active");
    expect(repo!.url).toBe("https://github.com/acme/widgets");
  });

  it("registers Chocolatier and Temperer agents for non-forks", async () => {
    const deps = makeDeps();
    await initializeRepository(
      "https://github.com/acme/widgets",
      "widgets",
      deps,
    );

    const repo = stateManager.getRepo("widgets");
    expect(repo!.agents["chocolatier"]).toBeDefined();
    expect(repo!.agents["chocolatier"].type).toBe("supervisor");
    expect(repo!.agents["temperer"]).toBeDefined();
    expect(repo!.agents["temperer"].type).toBe("merge-queue");
    expect(repo!.agents["enrober"]).toBeUndefined();
  });

  it("returns single-player result for non-forks", async () => {
    const deps = makeDeps();
    const result = await initializeRepository(
      "https://github.com/acme/widgets",
      "widgets",
      deps,
    );

    expect(result.mode).toBe("single-player");
    expect(result.name).toBe("widgets");
    expect(result.url).toBe("https://github.com/acme/widgets");
    expect(result.defaultBranch).toBe("main");
    expect(result.forkInfo).toBeUndefined();
    expect(result.forkDetectionFailed).toBe(false);
  });

  it("does not write .cocopilot/config.json for non-forks", async () => {
    const deps = makeDeps();
    await initializeRepository(
      "https://github.com/acme/widgets",
      "widgets",
      deps,
    );

    // writeFileFn should not have been called (no config to write)
    expect(deps.writeFileFn).not.toHaveBeenCalled();
  });

  it("does not add upstream remote for non-forks", async () => {
    const deps = makeDeps();
    await initializeRepository(
      "https://github.com/acme/widgets",
      "widgets",
      deps,
    );

    // execFn should only be called for git clone, not git remote add
    const execCalls = (deps.execFn as jest.Mock).mock.calls;
    const remoteAddCalls = execCalls.filter(
      (call: unknown[]) =>
        (call[1] as string[])[0] === "remote" && (call[1] as string[])[1] === "add",
    );
    expect(remoteAddCalls).toHaveLength(0);
  });

  // --- Fork (multiplayer) initialization ---

  it("registers the repo in multiplayer mode for forks", async () => {
    const deps = makeDeps({
      detectForkFn: jest.fn().mockResolvedValue({
        isFork: true,
        parentOwner: "upstream-org",
        parentRepo: "original",
        sourceOwner: "upstream-org",
        sourceRepo: "original",
        defaultBranch: "main",
      } satisfies ForkInfo),
    });

    await initializeRepository(
      "https://github.com/my-user/original",
      "original",
      deps,
    );

    const repo = stateManager.getRepo("original");
    expect(repo!.mode).toBe("multiplayer");
    expect(repo!.status).toBe("active");
  });

  it("registers Chocolatier and Enrober agents for forks", async () => {
    const deps = makeDeps({
      detectForkFn: jest.fn().mockResolvedValue({
        isFork: true,
        parentOwner: "upstream-org",
        parentRepo: "original",
        sourceOwner: "upstream-org",
        sourceRepo: "original",
        defaultBranch: "develop",
      } satisfies ForkInfo),
    });

    await initializeRepository(
      "https://github.com/my-user/original",
      "original",
      deps,
    );

    const repo = stateManager.getRepo("original");
    expect(repo!.agents["chocolatier"]).toBeDefined();
    expect(repo!.agents["chocolatier"].type).toBe("supervisor");
    expect(repo!.agents["enrober"]).toBeDefined();
    expect(repo!.agents["enrober"].type).toBe("pr-shepherd");
    expect(repo!.agents["temperer"]).toBeUndefined();
  });

  it("adds upstream remote for forks", async () => {
    const deps = makeDeps({
      detectForkFn: jest.fn().mockResolvedValue({
        isFork: true,
        parentOwner: "upstream-org",
        parentRepo: "original",
        sourceOwner: "upstream-org",
        sourceRepo: "original",
        defaultBranch: "main",
      } satisfies ForkInfo),
    });

    await initializeRepository(
      "https://github.com/my-user/original",
      "original",
      deps,
    );

    const execCalls = (deps.execFn as jest.Mock).mock.calls;
    const remoteAddCall = execCalls.find(
      (call: unknown[]) =>
        (call[1] as string[])[0] === "remote" && (call[1] as string[])[1] === "add",
    );
    expect(remoteAddCall).toBeDefined();
    expect(remoteAddCall![1]).toEqual([
      "remote",
      "add",
      "upstream",
      "https://github.com/upstream-org/original.git",
    ]);
    expect(remoteAddCall![2]).toEqual({
      cwd: expect.stringContaining("clone"),
    });
  });

  it("writes .cocopilot/config.json for forks with multiplayer config", async () => {
    const deps = makeDeps({
      detectForkFn: jest.fn().mockResolvedValue({
        isFork: true,
        parentOwner: "upstream-org",
        parentRepo: "original",
        sourceOwner: "upstream-org",
        sourceRepo: "original",
        defaultBranch: "main",
      } satisfies ForkInfo),
    });

    await initializeRepository(
      "https://github.com/my-user/original",
      "original",
      deps,
    );

    // mkdirFn should be called for .cocopilot dir
    const mkdirCalls = (deps.mkdirFn as jest.Mock).mock.calls;
    const cocopilotDirCall = mkdirCalls.find(
      (call: unknown[]) => (call[0] as string).includes(".cocopilot"),
    );
    expect(cocopilotDirCall).toBeDefined();

    // writeFileFn should be called with the config
    expect(deps.writeFileFn).toHaveBeenCalledWith(
      expect.stringContaining(path.join(".cocopilot", "config.json")),
      expect.any(String),
    );

    // Verify the written config content
    const writtenContent = (deps.writeFileFn as jest.Mock).mock.calls[0][1] as string;
    const writtenConfig = JSON.parse(writtenContent);
    expect(writtenConfig.mode).toBe("multiplayer");
    expect(writtenConfig.autoMerge).toBe(false);
    expect(writtenConfig.activeAgent).toBe("enrober");
    expect(writtenConfig.upstream).toEqual({
      owner: "upstream-org",
      repo: "original",
      defaultBranch: "main",
    });
  });

  it("returns fork info in result for forks", async () => {
    const forkInfo: ForkInfo = {
      isFork: true,
      parentOwner: "upstream-org",
      parentRepo: "original",
      sourceOwner: "upstream-org",
      sourceRepo: "original",
      defaultBranch: "develop",
    };

    const deps = makeDeps({
      detectForkFn: jest.fn().mockResolvedValue(forkInfo),
    });

    const result = await initializeRepository(
      "https://github.com/my-user/original",
      "original",
      deps,
    );

    expect(result.mode).toBe("multiplayer");
    expect(result.defaultBranch).toBe("develop");
    expect(result.forkInfo).toEqual(forkInfo);
  });

  // --- Fork detection failure ---

  it("falls back to single-player when fork detection fails", async () => {
    const deps = makeDeps({
      detectForkFn: jest.fn().mockRejectedValue(new Error("gh not found")),
    });

    const result = await initializeRepository(
      "https://github.com/acme/widgets",
      "widgets",
      deps,
    );

    expect(result.mode).toBe("single-player");
    expect(result.defaultBranch).toBe("main");
    expect(result.forkInfo).toBeUndefined();
    expect(result.forkDetectionFailed).toBe(true);

    const repo = stateManager.getRepo("widgets");
    expect(repo!.mode).toBe("single-player");
    expect(repo!.agents["temperer"]).toBeDefined();
    expect(repo!.agents["enrober"]).toBeUndefined();
  });

  // --- Default branch ---

  it("uses the detected default branch", async () => {
    const deps = makeDeps({
      detectForkFn: jest.fn().mockResolvedValue({
        isFork: false,
        defaultBranch: "develop",
      } satisfies ForkInfo),
    });

    const result = await initializeRepository(
      "https://github.com/acme/widgets",
      "widgets",
      deps,
    );

    expect(result.defaultBranch).toBe("develop");

    const repo = stateManager.getRepo("widgets");
    expect(repo!.defaultBranch).toBe("develop");
  });

  // --- Error cases ---

  it("throws when repo is already tracked", async () => {
    const deps = makeDeps();

    // First init succeeds
    await initializeRepository(
      "https://github.com/acme/widgets",
      "widgets",
      deps,
    );

    // Second init should throw
    await expect(
      initializeRepository("https://github.com/acme/widgets", "widgets", deps),
    ).rejects.toThrow('Repository "widgets" is already tracked');
  });

  it("propagates git clone errors", async () => {
    const deps = makeDeps({
      execFn: jest.fn().mockRejectedValue(new Error("git clone failed")),
    });

    await expect(
      initializeRepository("https://github.com/acme/widgets", "widgets", deps),
    ).rejects.toThrow("git clone failed");
  });

  // --- Repo status lifecycle ---

  it("sets repo status to active after successful init", async () => {
    const deps = makeDeps();
    await initializeRepository(
      "https://github.com/acme/widgets",
      "widgets",
      deps,
    );

    const repo = stateManager.getRepo("widgets");
    expect(repo!.status).toBe("active");
  });

  // --- Path construction ---

  it("constructs clone path under StateManager base dir", async () => {
    const deps = makeDeps();
    const result = await initializeRepository(
      "https://github.com/acme/widgets",
      "widgets",
      deps,
    );

    expect(result.localPath).toBe(
      path.join(tmpDir, "repos", "widgets", "clone"),
    );
  });
});
