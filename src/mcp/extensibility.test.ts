import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { loadMCPConfig, validateServer, injectServers } from "./extensibility.js";
import type { MCPServerConfig } from "./types.js";
import type { CopilotSessionOptions } from "../copilot/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(content: unknown): string {
  const configPath = path.join(tmpDir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(content, null, 2));
  return configPath;
}

// ---------------------------------------------------------------------------
// loadMCPConfig
// ---------------------------------------------------------------------------

describe("loadMCPConfig", () => {
  it("returns empty array when file does not exist", () => {
    const result = loadMCPConfig("/nonexistent/path/config.json");
    expect(result).toEqual([]);
  });

  it("returns empty array when file has no mcpServers key", () => {
    const configPath = writeConfig({ model: "test" });
    const result = loadMCPConfig(configPath);
    expect(result).toEqual([]);
  });

  it("returns empty array when mcpServers is not an array", () => {
    const configPath = writeConfig({ mcpServers: "not-array" });
    const result = loadMCPConfig(configPath);
    expect(result).toEqual([]);
  });

  it("returns empty array for invalid JSON", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, "{ invalid json }");
    const result = loadMCPConfig(configPath);
    expect(result).toEqual([]);
  });

  it("loads valid MCP server configs", () => {
    const servers: MCPServerConfig[] = [
      { name: "test-server", url: "http://localhost:3001", transport: "sse" },
      {
        name: "local-tool",
        url: "/usr/local/bin/mcp-tool",
        transport: "stdio",
        env: { API_KEY: "secret" },
      },
    ];
    const configPath = writeConfig({ mcpServers: servers });
    const result = loadMCPConfig(configPath);
    expect(result).toEqual(servers);
  });

  it("filters out malformed entries", () => {
    const configPath = writeConfig({
      mcpServers: [
        { name: "valid", url: "http://example.com", transport: "sse" },
        { name: "missing-url", transport: "sse" },
        { name: "bad-transport", url: "http://example.com", transport: "grpc" },
        null,
        42,
        { url: "http://example.com", transport: "stdio" }, // missing name
      ],
    });
    const result = loadMCPConfig(configPath);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("valid");
  });

  it("returns empty array when file is unreadable", () => {
    const configPath = path.join(tmpDir, "config.json");
    // Create a directory with the same name to cause a read error
    fs.mkdirSync(configPath);
    const result = loadMCPConfig(configPath);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateServer
// ---------------------------------------------------------------------------

describe("validateServer", () => {
  it("rejects config with empty name", async () => {
    const result = await validateServer({
      name: "",
      url: "http://localhost:3001",
      transport: "sse",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("name");
  });

  it("rejects config with empty url", async () => {
    const result = await validateServer({
      name: "test",
      url: "",
      transport: "sse",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("URL");
  });

  it("rejects config with invalid transport", async () => {
    const result = await validateServer({
      name: "test",
      url: "http://localhost:3001",
      transport: "grpc" as "stdio",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Transport");
  });

  it("rejects config with non-object env", async () => {
    const result = await validateServer({
      name: "test",
      url: "/usr/bin/mcp",
      transport: "stdio",
      env: "not-an-object" as unknown as Record<string, string>,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("env");
  });

  it("rejects config with non-string env values", async () => {
    const result = await validateServer({
      name: "test",
      url: "/usr/bin/mcp",
      transport: "stdio",
      env: { key: 123 as unknown as string },
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("string");
  });

  it("validates a valid stdio config without network check", async () => {
    const result = await validateServer({
      name: "local-tool",
      url: "/usr/local/bin/mcp-tool",
      transport: "stdio",
    });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("validates a valid stdio config with env", async () => {
    const result = await validateServer({
      name: "local-tool",
      url: "/usr/local/bin/mcp-tool",
      transport: "stdio",
      env: { PATH: "/usr/bin", NODE_ENV: "production" },
    });
    expect(result.valid).toBe(true);
  });

  it("reports unreachable SSE server", async () => {
    const result = await validateServer({
      name: "unreachable",
      url: "http://192.0.2.1:1", // RFC 5737 TEST-NET, will fail
      transport: "sse",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("unreachable");
  });
});

// ---------------------------------------------------------------------------
// injectServers
// ---------------------------------------------------------------------------

describe("injectServers", () => {
  it("returns options unchanged when servers array is empty", () => {
    const options: CopilotSessionOptions = { model: "test" };
    const result = injectServers(options, []);
    expect(result).toBe(options); // same reference, no copy
  });

  it("adds MCP servers to options with no existing servers", () => {
    const options: CopilotSessionOptions = { model: "test" };
    const servers: MCPServerConfig[] = [
      { name: "s1", url: "http://localhost:3001", transport: "sse" },
    ];
    const result = injectServers(options, servers);
    expect(result.model).toBe("test");
    expect(result.mcpServers).toBeDefined();
    expect((result.mcpServers as Record<string, unknown>)["s1"]).toEqual({
      url: "http://localhost:3001",
      transport: "sse",
    });
  });

  it("merges with existing MCP servers", () => {
    const options: CopilotSessionOptions = {
      mcpServers: {
        existing: { url: "http://localhost:1000", transport: "sse" },
      } as unknown as CopilotSessionOptions["mcpServers"],
    };
    const servers: MCPServerConfig[] = [
      { name: "new-server", url: "http://localhost:2000", transport: "stdio" },
    ];
    const result = injectServers(options, servers);
    const mcpServers = result.mcpServers as unknown as Record<string, Record<string, unknown>>;
    expect(mcpServers["existing"]).toBeDefined();
    expect(mcpServers["new-server"]).toEqual({
      url: "http://localhost:2000",
      transport: "stdio",
    });
  });

  it("new servers override existing servers with the same name", () => {
    const options: CopilotSessionOptions = {
      mcpServers: {
        shared: { url: "http://old-url", transport: "sse" },
      } as unknown as CopilotSessionOptions["mcpServers"],
    };
    const servers: MCPServerConfig[] = [
      { name: "shared", url: "http://new-url", transport: "stdio" },
    ];
    const result = injectServers(options, servers);
    const mcpServers = result.mcpServers as unknown as Record<string, Record<string, unknown>>;
    expect(mcpServers["shared"]).toEqual({
      url: "http://new-url",
      transport: "stdio",
    });
  });

  it("includes env when present on server config", () => {
    const options: CopilotSessionOptions = {};
    const servers: MCPServerConfig[] = [
      {
        name: "with-env",
        url: "/usr/bin/tool",
        transport: "stdio",
        env: { SECRET: "abc123" },
      },
    ];
    const result = injectServers(options, servers);
    const mcpServers = result.mcpServers as unknown as Record<string, Record<string, unknown>>;
    expect(mcpServers["with-env"]).toEqual({
      url: "/usr/bin/tool",
      transport: "stdio",
      env: { SECRET: "abc123" },
    });
  });

  it("does not include env key when not present on server config", () => {
    const options: CopilotSessionOptions = {};
    const servers: MCPServerConfig[] = [
      { name: "no-env", url: "http://localhost:3001", transport: "sse" },
    ];
    const result = injectServers(options, servers);
    const mcpServers = result.mcpServers as unknown as Record<string, Record<string, unknown>>;
    expect(mcpServers["no-env"]).toEqual({
      url: "http://localhost:3001",
      transport: "sse",
    });
    expect(Object.keys(mcpServers["no-env"])).not.toContain("env");
  });

  it("does not mutate original options", () => {
    const options: CopilotSessionOptions = {
      model: "test",
      mcpServers: {
        existing: { url: "http://keep", transport: "sse" },
      } as unknown as CopilotSessionOptions["mcpServers"],
    };
    const original = { ...options };
    injectServers(options, [
      { name: "new", url: "http://new", transport: "stdio" },
    ]);
    expect(options.mcpServers).toEqual(original.mcpServers);
  });
});
