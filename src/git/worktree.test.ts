import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getWorktreePath,
  createWorktree,
  listWorktrees,
  removeWorktree,
} from "./worktree";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temporary git repo with an initial commit. */
async function createTempRepo(): Promise<string> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "coco-wt-"));
  await execFileAsync("git", ["init", "-b", "main", tmpDir]);
  await execFileAsync("git", ["config", "user.email", "test@test.com"], {
    cwd: tmpDir,
  });
  await execFileAsync("git", ["config", "user.name", "Test"], {
    cwd: tmpDir,
  });
  // Need at least one commit for worktrees to work
  const readmePath = path.join(tmpDir, "README.md");
  await fs.promises.writeFile(readmePath, "# Test Repo\n");
  await execFileAsync("git", ["add", "."], { cwd: tmpDir });
  await execFileAsync("git", ["commit", "-m", "initial commit"], {
    cwd: tmpDir,
  });
  return tmpDir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let repoDir: string;

beforeEach(async () => {
  repoDir = await createTempRepo();
});

afterEach(async () => {
  // Clean up worktrees before removing the repo directory, otherwise
  // git may leave lock files. Use --force to handle any edge cases.
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["worktree", "list", "--porcelain"],
      { cwd: repoDir },
    );
    const worktreePaths = stdout
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .filter((p) => p !== repoDir);

    for (const wt of worktreePaths) {
      try {
        await execFileAsync("git", ["worktree", "remove", "--force", wt], {
          cwd: repoDir,
        });
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch {
    // Ignore if git commands fail during cleanup
  }

  await fs.promises.rm(repoDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getWorktreePath
// ---------------------------------------------------------------------------

describe("getWorktreePath", () => {
  it("returns the expected path structure", () => {
    const result = getWorktreePath("my-app", "Snickers");
    const home = process.env.HOME || process.env.USERPROFILE || "~";
    expect(result).toBe(
      path.join(home, ".cocopilot", "repos", "my-app", "worktrees", "Snickers"),
    );
  });

  it("handles different repo and worker names", () => {
    const result = getWorktreePath("api-service", "KitKat");
    expect(result).toContain("api-service");
    expect(result).toContain("KitKat");
    expect(result).toContain("worktrees");
  });
});

// ---------------------------------------------------------------------------
// createWorktree
// ---------------------------------------------------------------------------

describe("createWorktree", () => {
  it("creates a worktree at the expected path", async () => {
    const repoName = path.basename(repoDir);
    const wtPath = await createWorktree(repoDir, "Snickers", "main");

    const expectedPath = getWorktreePath(repoName, "Snickers");
    expect(wtPath).toBe(expectedPath);
    expect(fs.existsSync(wtPath)).toBe(true);
  });

  it("creates the worktree on a work/<name> branch", async () => {
    await createWorktree(repoDir, "KitKat", "main");

    // Verify the branch was created
    const { stdout } = await execFileAsync(
      "git",
      ["branch", "--list", "work/KitKat"],
      { cwd: repoDir },
    );
    expect(stdout.trim()).toContain("work/KitKat");
  });

  it("worktree contains the repository files", async () => {
    const wtPath = await createWorktree(repoDir, "Twix", "main");
    const readmePath = path.join(wtPath, "README.md");
    expect(fs.existsSync(readmePath)).toBe(true);
    const content = await fs.promises.readFile(readmePath, "utf-8");
    expect(content).toBe("# Test Repo\n");
  });

  it("cleans up and recreates when called twice with the same name", async () => {
    const wtPath1 = await createWorktree(repoDir, "Reeses", "main");
    expect(fs.existsSync(wtPath1)).toBe(true);

    // Second call should succeed due to cleanup logic
    const wtPath2 = await createWorktree(repoDir, "Reeses", "main");
    expect(wtPath2).toBe(wtPath1);
    expect(fs.existsSync(wtPath2)).toBe(true);
  });

  it("throws when base branch does not exist", async () => {
    await expect(
      createWorktree(repoDir, "Milkyway", "nonexistent-branch"),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// listWorktrees
// ---------------------------------------------------------------------------

describe("listWorktrees", () => {
  it("lists the main worktree when no extras exist", async () => {
    const worktrees = await listWorktrees(repoDir);
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0].path).toBe(repoDir);
    expect(worktrees[0].branch).toBe("refs/heads/main");
    expect(worktrees[0].head).toBeTruthy();
    expect(worktrees[0].bare).toBe(false);
    expect(worktrees[0].detached).toBe(false);
  });

  it("lists created worktrees", async () => {
    const repoName = path.basename(repoDir);
    await createWorktree(repoDir, "Snickers", "main");
    await createWorktree(repoDir, "KitKat", "main");

    const worktrees = await listWorktrees(repoDir);
    expect(worktrees).toHaveLength(3); // main + 2 workers

    const snickersWt = worktrees.find(
      (wt) => wt.path === getWorktreePath(repoName, "Snickers"),
    );
    expect(snickersWt).toBeDefined();
    expect(snickersWt!.branch).toBe("refs/heads/work/Snickers");

    const kitkatWt = worktrees.find(
      (wt) => wt.path === getWorktreePath(repoName, "KitKat"),
    );
    expect(kitkatWt).toBeDefined();
    expect(kitkatWt!.branch).toBe("refs/heads/work/KitKat");
  });

  it("all worktrees have a HEAD sha", async () => {
    await createWorktree(repoDir, "Butterfinger", "main");
    const worktrees = await listWorktrees(repoDir);
    for (const wt of worktrees) {
      expect(wt.head).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// removeWorktree
// ---------------------------------------------------------------------------

describe("removeWorktree", () => {
  it("removes the worktree directory", async () => {
    const wtPath = await createWorktree(repoDir, "Skittles", "main");
    expect(fs.existsSync(wtPath)).toBe(true);

    await removeWorktree(repoDir, "Skittles");
    expect(fs.existsSync(wtPath)).toBe(false);
  });

  it("deletes the associated branch", async () => {
    await createWorktree(repoDir, "Starburst", "main");
    await removeWorktree(repoDir, "Starburst");

    const { stdout } = await execFileAsync(
      "git",
      ["branch", "--list", "work/Starburst"],
      { cwd: repoDir },
    );
    expect(stdout.trim()).toBe("");
  });

  it("reduces the worktree count", async () => {
    await createWorktree(repoDir, "Snickers", "main");
    await createWorktree(repoDir, "KitKat", "main");

    let worktrees = await listWorktrees(repoDir);
    expect(worktrees).toHaveLength(3);

    await removeWorktree(repoDir, "Snickers");
    worktrees = await listWorktrees(repoDir);
    expect(worktrees).toHaveLength(2);
  });

  it("throws when worktree does not exist", async () => {
    await expect(
      removeWorktree(repoDir, "NonExistent"),
    ).rejects.toThrow();
  });

  it("handles worktree with uncommitted changes (--force)", async () => {
    const wtPath = await createWorktree(repoDir, "Twix", "main");

    // Create an uncommitted file in the worktree
    await fs.promises.writeFile(
      path.join(wtPath, "dirty.txt"),
      "uncommitted\n",
    );

    // Should succeed due to --force
    await removeWorktree(repoDir, "Twix");
    expect(fs.existsSync(wtPath)).toBe(false);
  });
});
