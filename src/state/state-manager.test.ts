import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { StateManager } from "./state-manager";
import { DEFAULT_GLOBAL_CONFIG, CURRENT_STATE_VERSION } from "./schemas";

let tmpDir: string;
let sm: StateManager;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "coco-sm-"));
  sm = new StateManager(tmpDir);
  await sm.init();
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

describe("init", () => {
  it("creates config.json with defaults on first run", async () => {
    const configPath = path.join(tmpDir, "config.json");
    const raw = JSON.parse(await fs.promises.readFile(configPath, "utf-8"));
    expect(raw.model).toBe(DEFAULT_GLOBAL_CONFIG.model);
    expect(raw.webPort).toBe(DEFAULT_GLOBAL_CONFIG.webPort);
  });

  it("creates state.json on first run", async () => {
    const statePath = path.join(tmpDir, "state.json");
    const raw = JSON.parse(await fs.promises.readFile(statePath, "utf-8"));
    expect(raw.version).toBe(CURRENT_STATE_VERSION);
    expect(raw.status).toBe("stopped");
  });

  it("loads existing config on subsequent runs", async () => {
    await sm.updateConfig({ model: "gpt-5" });
    const sm2 = new StateManager(tmpDir);
    await sm2.init();
    expect(sm2.getConfig().model).toBe("gpt-5");
  });

  it("recovers from corrupted state.json", async () => {
    const statePath = path.join(tmpDir, "state.json");
    await fs.promises.writeFile(statePath, "{{{{not json");
    const sm2 = new StateManager(tmpDir);
    await sm2.init();
    // Should recover with fresh state
    expect(sm2.getDaemonState().status).toBe("stopped");
    // Original corrupt file should be backed up
    const files = await fs.promises.readdir(tmpDir);
    expect(files.some((f) => f.startsWith("state.json.corrupt."))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("config", () => {
  it("getConfig returns current config", () => {
    const config = sm.getConfig();
    expect(config.model).toBe(DEFAULT_GLOBAL_CONFIG.model);
  });

  it("updateConfig merges and persists", async () => {
    const updated = await sm.updateConfig({ webPort: 9000 });
    expect(updated.webPort).toBe(9000);
    expect(updated.model).toBe(DEFAULT_GLOBAL_CONFIG.model); // unchanged

    // Verify persisted
    const raw = JSON.parse(
      await fs.promises.readFile(path.join(tmpDir, "config.json"), "utf-8"),
    );
    expect(raw.webPort).toBe(9000);
  });

  it("updateConfig emits event", async () => {
    const handler = jest.fn();
    sm.on("configChanged", handler);
    await sm.updateConfig({ theme: "milk-chocolate" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].theme).toBe("milk-chocolate");
  });
});

// ---------------------------------------------------------------------------
// Daemon lifecycle
// ---------------------------------------------------------------------------

describe("daemon lifecycle", () => {
  it("setDaemonRunning updates state and writes PID", async () => {
    await sm.setDaemonRunning(12345);
    expect(sm.getDaemonState().status).toBe("running");
    expect(sm.getDaemonState().pid).toBe(12345);

    const pid = await sm.readPid();
    expect(pid).toBe(12345);
  });

  it("setDaemonStopped clears PID", async () => {
    await sm.setDaemonRunning(12345);
    await sm.setDaemonStopped();
    expect(sm.getDaemonState().status).toBe("stopped");
    expect(sm.getDaemonState().pid).toBeUndefined();

    const pid = await sm.readPid();
    expect(pid).toBeUndefined();
  });

  it("readPid returns undefined when no PID file", async () => {
    const pid = await sm.readPid();
    expect(pid).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Repository management
// ---------------------------------------------------------------------------

describe("repos", () => {
  it("addRepo creates and persists a repo", async () => {
    const repo = await sm.addRepo({
      name: "my-app",
      url: "https://github.com/org/my-app",
      localPath: "/tmp/repos/my-app",
      mode: "single-player",
    });
    expect(repo.name).toBe("my-app");
    expect(repo.status).toBe("initializing");
    expect(repo.id).toBeTruthy();

    const loaded = sm.getRepo("my-app");
    expect(loaded).toBeDefined();
    expect(loaded!.url).toBe("https://github.com/org/my-app");
  });

  it("addRepo throws on duplicate name", async () => {
    await sm.addRepo({
      name: "dup",
      url: "https://github.com/org/dup",
      localPath: "/tmp/dup",
      mode: "single-player",
    });
    await expect(
      sm.addRepo({
        name: "dup",
        url: "https://github.com/org/dup2",
        localPath: "/tmp/dup2",
        mode: "single-player",
      }),
    ).rejects.toThrow("already tracked");
  });

  it("updateRepoStatus changes status", async () => {
    await sm.addRepo({
      name: "r",
      url: "https://github.com/org/r",
      localPath: "/tmp/r",
      mode: "single-player",
    });
    const updated = await sm.updateRepoStatus("r", "active");
    expect(updated.status).toBe("active");
  });

  it("removeRepo deletes the repo", async () => {
    await sm.addRepo({
      name: "rm-me",
      url: "https://github.com/org/rm-me",
      localPath: "/tmp/rm-me",
      mode: "single-player",
    });
    await sm.removeRepo("rm-me");
    expect(sm.getRepo("rm-me")).toBeUndefined();
  });

  it("removeRepo throws for unknown repo", async () => {
    await expect(sm.removeRepo("nope")).rejects.toThrow("not tracked");
  });
});

// ---------------------------------------------------------------------------
// Agent management
// ---------------------------------------------------------------------------

describe("agents", () => {
  beforeEach(async () => {
    await sm.addRepo({
      name: "repo",
      url: "https://github.com/org/repo",
      localPath: "/tmp/repo",
      mode: "single-player",
    });
  });

  it("setAgent creates an agent", async () => {
    const agent = await sm.setAgent("repo", {
      name: "chocolatier",
      type: "supervisor",
      status: "starting",
      containerId: "c-1",
    });
    expect(agent.name).toBe("chocolatier");
    expect(agent.type).toBe("supervisor");
    expect(agent.containerId).toBe("c-1");
  });

  it("updateAgentStatus changes agent status", async () => {
    await sm.setAgent("repo", {
      name: "chocolatier",
      type: "supervisor",
      status: "starting",
    });
    const updated = await sm.updateAgentStatus("repo", "chocolatier", "healthy");
    expect(updated.status).toBe("healthy");
  });

  it("updateAgentStatus throws for unknown agent", async () => {
    await expect(
      sm.updateAgentStatus("repo", "ghost", "healthy"),
    ).rejects.toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// Worker management
// ---------------------------------------------------------------------------

describe("workers", () => {
  beforeEach(async () => {
    await sm.addRepo({
      name: "repo",
      url: "https://github.com/org/repo",
      localPath: "/tmp/repo",
      mode: "single-player",
    });
  });

  it("addWorker creates a worker with a candy name", async () => {
    const worker = await sm.addWorker("repo", { task: "Add tests" });
    expect(worker.name).toBe("SweetCaramel"); // first adjective+candy name
    expect(worker.task).toBe("Add tests");
    expect(worker.branch).toBe("work/SweetCaramel");
    expect(worker.status).toBe("starting");
  });

  it("addWorker respects custom name", async () => {
    const worker = await sm.addWorker("repo", {
      task: "Fix bug",
      name: "CustomWorker",
    });
    expect(worker.name).toBe("CustomWorker");
  });

  it("addWorker assigns sequential candy names", async () => {
    const w1 = await sm.addWorker("repo", { task: "Task 1" });
    const w2 = await sm.addWorker("repo", { task: "Task 2" });
    expect(w1.name).toBe("SweetCaramel");
    expect(w2.name).toBe("SweetToffee");
  });

  it("addWorker throws when max workers reached", async () => {
    await sm.updateConfig({ maxWorkersPerRepo: 2 });
    await sm.addWorker("repo", { task: "T1" });
    await sm.addWorker("repo", { task: "T2" });
    await expect(sm.addWorker("repo", { task: "T3" })).rejects.toThrow(
      "Maximum workers",
    );
  });

  it("addWorker throws on duplicate name", async () => {
    await sm.addWorker("repo", { task: "T1", name: "Dup" });
    await expect(
      sm.addWorker("repo", { task: "T2", name: "Dup" }),
    ).rejects.toThrow("already exists");
  });

  it("updateWorkerStatus transitions status", async () => {
    await sm.addWorker("repo", { task: "Work" });
    const updated = await sm.updateWorkerStatus("repo", "SweetCaramel", "working", {
      containerId: "c-99",
    });
    expect(updated.status).toBe("working");
    expect(updated.containerId).toBe("c-99");
  });

  it("updateWorkerStatus sets completedAt for terminal states", async () => {
    await sm.addWorker("repo", { task: "Work" });
    const completed = await sm.updateWorkerStatus(
      "repo",
      "SweetCaramel",
      "completed",
      { prNumber: 42, prUrl: "https://github.com/org/repo/pull/42" },
    );
    expect(completed.completedAt).toBeTruthy();
    expect(completed.prNumber).toBe(42);
  });

  it("removeWorker deletes the worker", async () => {
    await sm.addWorker("repo", { task: "Work" });
    await sm.removeWorker("repo", "SweetCaramel");
    expect(sm.getWorker("repo", "SweetCaramel")).toBeUndefined();
  });

  it("removeWorker throws for unknown worker", async () => {
    await expect(sm.removeWorker("repo", "ghost")).rejects.toThrow(
      "not found",
    );
  });

  it("recordMerge updates lastMerge", async () => {
    await sm.recordMerge("repo");
    const repo = sm.getRepo("repo");
    expect(repo!.lastMerge).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------

describe("events", () => {
  it("emits repoAdded", async () => {
    const handler = jest.fn();
    sm.on("repoAdded", handler);
    await sm.addRepo({
      name: "ev",
      url: "https://github.com/org/ev",
      localPath: "/tmp/ev",
      mode: "single-player",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("emits workerAdded", async () => {
    await sm.addRepo({
      name: "ev",
      url: "https://github.com/org/ev",
      localPath: "/tmp/ev",
      mode: "single-player",
    });
    const handler = jest.fn();
    sm.on("workerAdded", handler);
    await sm.addWorker("ev", { task: "test" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toBe("ev");
    expect(handler.mock.calls[0][1].name).toBe("SweetCaramel");
  });

  it("emits stateChanged on every mutation", async () => {
    const handler = jest.fn();
    sm.on("stateChanged", handler);
    await sm.addRepo({
      name: "sc",
      url: "https://github.com/org/sc",
      localPath: "/tmp/sc",
      mode: "single-player",
    });
    await sm.addWorker("sc", { task: "t" });
    // addRepo + addWorker = at least 2 stateChanged events
    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Persistence across restarts
// ---------------------------------------------------------------------------

describe("persistence", () => {
  it("state survives a new StateManager instance", async () => {
    await sm.addRepo({
      name: "persist",
      url: "https://github.com/org/persist",
      localPath: "/tmp/persist",
      mode: "single-player",
    });
    await sm.addWorker("persist", { task: "survive" });

    const sm2 = new StateManager(tmpDir);
    await sm2.init();

    const repo = sm2.getRepo("persist");
    expect(repo).toBeDefined();
    // Worker should be recovered (marked stuck since daemon restarted)
    const worker = sm2.getWorker("persist", "SweetCaramel");
    expect(worker).toBeDefined();
    expect(worker!.task).toBe("survive");
  });
});
