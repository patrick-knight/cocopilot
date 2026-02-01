import { Command } from "commander";

interface RepairResponse {
  message: string;
  workersCleanedUp: number;
  agentsRestarted: number;
  errors?: string[];
}

async function repairViaApi(repoName: string): Promise<RepairResponse> {
  const response = await fetch(
    `http://localhost:3000/api/v1/repositories/${encodeURIComponent(repoName)}/repair`,
    { method: "POST" },
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Repository "${repoName}" not found`);
    }
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json() as Promise<RepairResponse>;
}

export function registerRepairCommand(program: Command): void {
  program
    .command("repair")
    .description("Clean up orphaned workers and restart agents for a repository")
    .argument("<repo-name>", "Repository name to repair")
    .action(async (repoName: string) => {
      try {
        const result = await repairViaApi(repoName);
        
        const hasChanges = result.workersCleanedUp > 0 || result.agentsRestarted > 0;
        
        if (hasChanges) {
          console.log(`✅ ${result.message}`);
          if (result.workersCleanedUp > 0) {
            console.log(`   🧹 Workers cleaned up: ${result.workersCleanedUp}`);
          }
          if (result.agentsRestarted > 0) {
            console.log(`   🔄 Agents restarted: ${result.agentsRestarted}`);
          }
        } else {
          console.log(`✓ ${result.message}`);
        }

        if (result.errors && result.errors.length > 0) {
          console.log("\n⚠️  Some errors occurred:");
          for (const err of result.errors) {
            console.log(`   - ${err}`);
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
          console.error("Error: CoCoPilot daemon is not running. Start it with: coco start");
        } else {
          console.error(`Error: ${message}`);
        }
        process.exitCode = 1;
      }
    });
}
