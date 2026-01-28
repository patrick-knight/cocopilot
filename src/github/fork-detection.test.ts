import { ownerAndRepoFromUrl, configureMultiplayer } from "./fork-detection";
import type { ForkInfo } from "./types";
import type { RepoConfig } from "../state/schemas";

// detectFork calls `gh` CLI, so we test it via mocking child_process
jest.mock("node:child_process", () => ({
  execFile: jest.fn(),
}));

import { execFile } from "node:child_process";
import { detectFork } from "./fork-detection";

const mockExecFile = execFile as unknown as jest.Mock;

function setupExecFileMock(stdout: string) {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], callback: Function) => {
      callback(null, { stdout });
    },
  );
}

describe("ownerAndRepoFromUrl", () => {
  it("extracts owner and repo from a standard GitHub URL", () => {
    const result = ownerAndRepoFromUrl("https://github.com/acme/widgets");
    expect(result).toEqual({ owner: "acme", repo: "widgets" });
  });

  it("strips .git suffix", () => {
    const result = ownerAndRepoFromUrl("https://github.com/acme/widgets.git");
    expect(result).toEqual({ owner: "acme", repo: "widgets" });
  });

  it("handles URLs with www prefix", () => {
    const result = ownerAndRepoFromUrl("https://www.github.com/org/repo");
    expect(result).toEqual({ owner: "org", repo: "repo" });
  });
});

describe("detectFork", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it("returns isFork=true with parent info for a forked repo", async () => {
    const apiResponse = JSON.stringify({
      fork: true,
      default_branch: "main",
      parent_owner: "upstream-org",
      parent_repo: "original-repo",
      source_owner: "upstream-org",
      source_repo: "original-repo",
    });
    setupExecFileMock(apiResponse);

    const result = await detectFork("https://github.com/my-user/original-repo");

    expect(result).toEqual({
      isFork: true,
      parentOwner: "upstream-org",
      parentRepo: "original-repo",
      sourceOwner: "upstream-org",
      sourceRepo: "original-repo",
      defaultBranch: "main",
    });

    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["api", "repos/my-user/original-repo"]),
      expect.any(Function),
    );
  });

  it("returns isFork=false for a non-fork repo", async () => {
    const apiResponse = JSON.stringify({
      fork: false,
      default_branch: "develop",
      parent_owner: null,
      parent_repo: null,
      source_owner: null,
      source_repo: null,
    });
    setupExecFileMock(apiResponse);

    const result = await detectFork("https://github.com/my-org/my-repo");

    expect(result).toEqual({
      isFork: false,
      parentOwner: undefined,
      parentRepo: undefined,
      sourceOwner: undefined,
      sourceRepo: undefined,
      defaultBranch: "develop",
    });
  });

  it("defaults to 'main' when default_branch is missing", async () => {
    const apiResponse = JSON.stringify({
      fork: false,
      default_branch: null,
    });
    setupExecFileMock(apiResponse);

    const result = await detectFork("https://github.com/owner/repo");
    expect(result.defaultBranch).toBe("main");
  });

  it("rejects when gh CLI fails", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], callback: Function) => {
        callback(new Error("gh: command not found"));
      },
    );

    await expect(
      detectFork("https://github.com/owner/repo"),
    ).rejects.toThrow("gh: command not found");
  });
});

describe("configureMultiplayer", () => {
  const forkInfo: ForkInfo = {
    isFork: true,
    parentOwner: "upstream-org",
    parentRepo: "original-repo",
    sourceOwner: "upstream-org",
    sourceRepo: "original-repo",
    defaultBranch: "main",
  };

  const nonForkInfo: ForkInfo = {
    isFork: false,
    defaultBranch: "main",
  };

  it("returns config unchanged when not a fork", () => {
    const config: RepoConfig = { mode: "single-player" };
    const result = configureMultiplayer(config, nonForkInfo);
    expect(result).toEqual({ mode: "single-player" });
  });

  it("sets multiplayer mode for forks", () => {
    const config: RepoConfig = {};
    const result = configureMultiplayer(config, forkInfo);
    expect(result.mode).toBe("multiplayer");
  });

  it("disables autoMerge for forks", () => {
    const config: RepoConfig = {};
    const result = configureMultiplayer(config, forkInfo);
    expect(result.autoMerge).toBe(false);
  });

  it("sets activeAgent to enrober for forks", () => {
    const config: RepoConfig = {};
    const result = configureMultiplayer(config, forkInfo);
    expect(result.activeAgent).toBe("enrober");
  });

  it("sets upstream tracking info for forks", () => {
    const config: RepoConfig = {};
    const result = configureMultiplayer(config, forkInfo);
    expect(result.upstream).toEqual({
      owner: "upstream-org",
      repo: "original-repo",
      defaultBranch: "main",
    });
  });

  it("preserves existing config fields", () => {
    const config: RepoConfig = { model: "claude-sonnet-4-5", maxWorkers: 5 };
    const result = configureMultiplayer(config, forkInfo);
    expect(result.model).toBe("claude-sonnet-4-5");
    expect(result.maxWorkers).toBe(5);
    expect(result.mode).toBe("multiplayer");
  });
});
