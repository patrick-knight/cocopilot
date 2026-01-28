/**
 * BYOK (Bring Your Own Key) — API key management for CoCoPilot.
 *
 * Supports loading API keys from environment variables or an encrypted
 * on-disk store (~/.cocopilot/keys.json).  Keys are encrypted at rest
 * using AES-256-GCM (see ./encryption.ts).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { encrypt, decrypt } from "./encryption.js";
import { getCocopilotDir, ensureCocopilotDir } from "../daemon/config.js";

// ---- Types ----------------------------------------------------------------

/** Supported API providers. */
export type Provider = "anthropic" | "openai" | "azure";

export const PROVIDERS: readonly Provider[] = [
  "anthropic",
  "openai",
  "azure",
] as const;

/** Map of provider → API key. */
export type APIKeyMap = Partial<Record<Provider, string>>;

/** Environment variable names per provider. */
const ENV_VARS: Record<Provider, string> = {
  anthropic: "COCOPILOT_ANTHROPIC_KEY",
  openai: "COCOPILOT_OPENAI_KEY",
  azure: "COCOPILOT_AZURE_KEY",
};

// ---- Validation -----------------------------------------------------------

/** Basic format checks per provider. */
const KEY_PATTERNS: Record<Provider, RegExp> = {
  anthropic: /^sk-ant-[a-zA-Z0-9_-]{20,}$/,
  openai: /^sk-[a-zA-Z0-9_-]{20,}$/,
  azure: /^[a-fA-F0-9]{32}$/,
};

/**
 * Validate that a key matches the expected format for a provider.
 *
 * This is a lightweight sanity check — it does not call the provider API.
 */
export function validateKey(provider: Provider, key: string): boolean {
  const pattern = KEY_PATTERNS[provider];
  if (!pattern) return false;
  return pattern.test(key);
}

// ---- Storage --------------------------------------------------------------

function keysFilePath(): string {
  return path.join(getCocopilotDir(), "keys.json");
}

/**
 * Load API keys from environment variables and (optionally) the encrypted
 * keys file.
 *
 * Priority: environment variables take precedence over stored keys.
 *
 * @param password - Password to decrypt the keys file.  If omitted, only
 *   environment variables are checked.
 * @returns Map of provider → key for all configured providers.
 */
export function loadAPIKeys(password?: string): APIKeyMap {
  const keys: APIKeyMap = {};

  // 1. Try the encrypted file first (if password provided)
  if (password) {
    const filePath = keysFilePath();
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const decrypted = decrypt(raw, password);
        const stored: APIKeyMap = JSON.parse(decrypted);
        for (const p of PROVIDERS) {
          if (stored[p]) {
            keys[p] = stored[p];
          }
        }
      } catch {
        // Decryption failed — wrong password or corrupt file.
        // Fall through to env vars.
      }
    }
  }

  // 2. Environment variables override stored keys
  for (const p of PROVIDERS) {
    const envVal = process.env[ENV_VARS[p]];
    if (envVal) {
      keys[p] = envVal;
    }
  }

  return keys;
}

/**
 * Encrypt and store an API key for a provider.
 *
 * Reads the existing keys file (if any), merges the new key, and writes
 * the result back encrypted.
 *
 * @param provider - The provider to configure.
 * @param key - The API key to store.
 * @param password - Password used to encrypt the keys file.
 */
export function configureProvider(
  provider: Provider,
  key: string,
  password: string,
): void {
  ensureCocopilotDir();

  // Load existing keys (if the file exists and we can decrypt it)
  let existing: APIKeyMap = {};
  const filePath = keysFilePath();

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      existing = JSON.parse(decrypt(raw, password));
    } catch {
      // Can't decrypt — start fresh (previous password may differ)
      existing = {};
    }
  }

  existing[provider] = key;

  const encrypted = encrypt(JSON.stringify(existing), password);
  fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
}

/**
 * List providers that have stored keys (without revealing the keys).
 *
 * @param password - Password to decrypt the keys file.
 * @returns Array of provider names that have stored keys.
 */
export function listConfiguredProviders(password: string): Provider[] {
  const filePath = keysFilePath();
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const stored: APIKeyMap = JSON.parse(decrypt(raw, password));
    return PROVIDERS.filter((p) => !!stored[p]);
  } catch {
    return [];
  }
}
