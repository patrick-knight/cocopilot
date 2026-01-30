import { Command } from "commander";
import { StateManager } from "../../state/state-manager.js";

async function signalDaemonReload(): Promise<void> {
  try {
    await fetch("http://localhost:3000/api/v1/system/reload-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    // Daemon not running or not reachable; ignore.
  }
}

async function deleteViaApi(name: string): Promise<boolean> {
  try {
    const response = await fetch(
      `http://localhost:3000/api/v1/repositories/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
    if (response.ok || response.status === 204) {
      return true;
    }
    if (response.status === 404) {
      throw new Error(`Repository "${name}" is not tracked`);
    }
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
      return false;
    }
    throw err;
  }
}

export function registerRemoveCommand(program: Command): void {
  program
    .command("remove")
    .alias("rm")
    .description("Stop tracking a repository")
    .argument("<repo-name>", "Repository name to remove")
    .action(async (name: string) => {
      try {
        const removedViaApi = await deleteViaApi(name);
        if (!removedViaApi) {
          const stateManager = new StateManager();
          await stateManager.init();
          await stateManager.removeRepo(name);
          await signalDaemonReload();
        }

        console.log(`Repository "${name}" removed.`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("not tracked")) {
          console.error(`Error: Repository "${name}" is not tracked.`);
        } else {
          console.error(`Error: Failed to remove repository — ${message}`);
        }
        process.exitCode = 1;
      }
    });
}