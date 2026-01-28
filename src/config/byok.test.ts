import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  validateKey,
  loadAPIKeys,
  configureProvider,
  listConfiguredProviders,
  PROVIDERS,
} from "./byok.js";
import type { Provider } from "./byok.js";

// ---------------------------------------------------------------------------
// Mock the cocopilot dir to use a temp directory
// ---------------------------------------------------------------------------

let tmpDir: string;

jest.mock("../daemon/config.js", () => ({
  getCocopilotDir: () => tmpDir,
  ensureCocopilotDir: () => {
    fs.mkdirSync(tmpDir, { recursive: true });
  },
}));

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "byok-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateKey", () => {
  describe("anthropic", () => {
    it("should accept valid Anthropic keys", () => {
      expect(validateKey("anthropic", "sk-ant-abcdefghijklmnopqrstuvwx")).toBe(
        true,
      );
    });

    it("should reject keys without sk-ant- prefix", () => {
      expect(validateKey("anthropic", "sk-abcdefghijklmnopqrstuvwx")).toBe(
        false,
      );
    });

    it("should reject short keys", () => {
      expect(validateKey("anthropic", "sk-ant-short")).toBe(false);
    });
  });

  describe("openai", () => {
    it("should accept valid OpenAI keys", () => {
      expect(validateKey("openai", "sk-abcdefghijklmnopqrstuvwx")).toBe(true);
    });

    it("should reject keys without sk- prefix", () => {
      expect(validateKey("openai", "abcdefghijklmnopqrstuvwx")).toBe(false);
    });

    it("should reject short keys", () => {
      expect(validateKey("openai", "sk-short")).toBe(false);
    });
  });

  describe("azure", () => {
    it("should accept valid Azure keys (32 hex chars)", () => {
      expect(validateKey("azure", "abcdef0123456789abcdef0123456789")).toBe(
        true,
      );
    });

    it("should reject non-hex characters", () => {
      expect(validateKey("azure", "zzzzzz0123456789abcdef0123456789")).toBe(
        false,
      );
    });

    it("should reject wrong length", () => {
      expect(validateKey("azure", "abcdef")).toBe(false);
    });
  });

  it("should return false for unknown provider", () => {
    expect(validateKey("unknown" as Provider, "some-key")).toBe(false);
  });
});

describe("configureProvider", () => {
  const password = "test-password";

  it("should create keys.json in the cocopilot dir", () => {
    configureProvider("anthropic", "sk-ant-testapikey1234567890ab", password);

    const keysPath = path.join(tmpDir, "keys.json");
    expect(fs.existsSync(keysPath)).toBe(true);
  });

  it("should store encrypted data (not plaintext)", () => {
    const key = "sk-ant-testapikey1234567890ab";
    configureProvider("anthropic", key, password);

    const raw = fs.readFileSync(path.join(tmpDir, "keys.json"), "utf-8");
    expect(raw).not.toContain(key);
    // Should be valid JSON with encryption envelope fields
    const envelope = JSON.parse(raw);
    expect(envelope).toHaveProperty("version", 1);
    expect(envelope).toHaveProperty("iv");
    expect(envelope).toHaveProperty("salt");
    expect(envelope).toHaveProperty("authTag");
    expect(envelope).toHaveProperty("data");
  });

  it("should preserve existing keys when adding a new provider", () => {
    configureProvider("anthropic", "sk-ant-testapikey1234567890ab", password);
    configureProvider("openai", "sk-testapikey1234567890abcdef", password);

    const providers = listConfiguredProviders(password);
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
  });

  it("should overwrite existing key for same provider", () => {
    configureProvider("anthropic", "sk-ant-oldkey12345678901234", password);
    configureProvider("anthropic", "sk-ant-newkey12345678901234", password);

    const keys = loadAPIKeys(password);
    expect(keys.anthropic).toBe("sk-ant-newkey12345678901234");
  });
});

describe("loadAPIKeys", () => {
  const password = "test-password";

  it("should return empty object when no keys configured and no env vars", () => {
    const keys = loadAPIKeys(password);
    expect(keys).toEqual({});
  });

  it("should load keys from the encrypted file", () => {
    configureProvider("anthropic", "sk-ant-testapikey1234567890ab", password);

    const keys = loadAPIKeys(password);
    expect(keys.anthropic).toBe("sk-ant-testapikey1234567890ab");
  });

  it("should return empty when no password provided and no env vars", () => {
    configureProvider("anthropic", "sk-ant-testapikey1234567890ab", password);

    const keys = loadAPIKeys();
    expect(keys.anthropic).toBeUndefined();
  });

  it("should load keys from environment variables", () => {
    const envKey = "sk-ant-envkey123456789012345";
    process.env.COCOPILOT_ANTHROPIC_KEY = envKey;

    try {
      const keys = loadAPIKeys();
      expect(keys.anthropic).toBe(envKey);
    } finally {
      delete process.env.COCOPILOT_ANTHROPIC_KEY;
    }
  });

  it("should prefer env vars over stored keys", () => {
    configureProvider("anthropic", "sk-ant-storedkey12345678901", password);

    const envKey = "sk-ant-envkey123456789012345";
    process.env.COCOPILOT_ANTHROPIC_KEY = envKey;

    try {
      const keys = loadAPIKeys(password);
      expect(keys.anthropic).toBe(envKey);
    } finally {
      delete process.env.COCOPILOT_ANTHROPIC_KEY;
    }
  });

  it("should handle wrong password gracefully", () => {
    configureProvider("anthropic", "sk-ant-testapikey1234567890ab", password);

    // Wrong password should not throw — just returns empty from file
    const keys = loadAPIKeys("wrong-password");
    expect(keys.anthropic).toBeUndefined();
  });
});

describe("listConfiguredProviders", () => {
  const password = "test-password";

  it("should return empty array when no keys file exists", () => {
    expect(listConfiguredProviders(password)).toEqual([]);
  });

  it("should list all configured providers", () => {
    configureProvider("anthropic", "sk-ant-testapikey1234567890ab", password);
    configureProvider("openai", "sk-testapikey1234567890abcdef", password);

    const configured = listConfiguredProviders(password);
    expect(configured).toHaveLength(2);
    expect(configured).toContain("anthropic");
    expect(configured).toContain("openai");
    expect(configured).not.toContain("azure");
  });

  it("should return empty array with wrong password", () => {
    configureProvider("anthropic", "sk-ant-testapikey1234567890ab", password);

    expect(listConfiguredProviders("wrong-password")).toEqual([]);
  });
});

describe("PROVIDERS", () => {
  it("should include all three providers", () => {
    expect(PROVIDERS).toEqual(["anthropic", "openai", "azure"]);
  });
});
