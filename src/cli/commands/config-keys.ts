import { Command } from "commander";
import {
  configureProvider,
  validateKey,
  listConfiguredProviders,
  PROVIDERS,
} from "../../config/byok.js";
import type { Provider } from "../../config/byok.js";

const KEYS_PASSWORD_ENV = "COCOPILOT_KEYS_PASSWORD";

function getPassword(): string | null {
  return process.env[KEYS_PASSWORD_ENV] ?? null;
}

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command("config")
    .description("Manage CoCoPilot configuration");

  const keysCmd = configCmd
    .command("keys")
    .description("Manage API keys (BYOK)");

  keysCmd
    .command("set")
    .description("Store an encrypted API key for a provider")
    .argument("<provider>", `Provider name (${PROVIDERS.join(", ")})`)
    .argument("<key>", "API key value")
    .option(
      "--skip-validation",
      "Skip key format validation",
    )
    .action(
      (
        provider: string,
        key: string,
        options: { skipValidation?: boolean },
      ) => {
        const password = getPassword();
        if (!password) {
          console.error(
            `Error: Set ${KEYS_PASSWORD_ENV} environment variable to encrypt your keys.`,
          );
          process.exitCode = 1;
          return;
        }

        if (!PROVIDERS.includes(provider as Provider)) {
          console.error(
            `Error: Unknown provider "${provider}". Supported: ${PROVIDERS.join(", ")}`,
          );
          process.exitCode = 1;
          return;
        }

        const p = provider as Provider;

        if (!options.skipValidation && !validateKey(p, key)) {
          console.error(
            `Error: Key does not match expected format for ${p}.`,
          );
          console.error(
            "Use --skip-validation to store it anyway.",
          );
          process.exitCode = 1;
          return;
        }

        try {
          configureProvider(p, key, password);
          console.log(`API key for ${p} stored successfully.`);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Error: Failed to store key — ${message}`);
          process.exitCode = 1;
        }
      },
    );

  keysCmd
    .command("list")
    .description("List providers with configured API keys")
    .action(() => {
      const password = getPassword();
      if (!password) {
        console.error(
          `Error: Set ${KEYS_PASSWORD_ENV} environment variable to decrypt your keys.`,
        );
        process.exitCode = 1;
        return;
      }

      try {
        const configured = listConfiguredProviders(password);

        if (configured.length === 0) {
          console.log("No API keys configured.");
          console.log(
            `Run \`coco config keys set <provider> <key>\` to add one.`,
          );
          return;
        }

        console.log("Configured providers:");
        for (const p of configured) {
          console.log(`  - ${p}`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: Failed to list keys — ${message}`);
        process.exitCode = 1;
      }
    });
}
