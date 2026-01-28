import { getGitHubMCPConfig } from "../mcp-config";

describe("GitHub MCP Configuration", () => {
  describe("getGitHubMCPConfig", () => {
    it("returns config with default GitHub MCP URL", () => {
      const config = getGitHubMCPConfig();

      expect(config).toHaveProperty("github");
      expect(config.github).toEqual({
        type: "http",
        url: "https://api.githubcopilot.com/mcp/",
        tools: ["*"],
      });
    });

    it("allows overriding the URL", () => {
      const config = getGitHubMCPConfig({
        url: "https://custom-mcp.example.com/",
      });

      expect(config.github).toEqual({
        type: "http",
        url: "https://custom-mcp.example.com/",
        tools: ["*"],
      });
    });

    it("returns a record keyed by 'github'", () => {
      const config = getGitHubMCPConfig();
      const keys = Object.keys(config);

      expect(keys).toEqual(["github"]);
    });

    it("can be spread into mcpServers config", () => {
      const mcpServers = {
        ...getGitHubMCPConfig(),
        custom: { type: "stdio" as const, command: "my-server" },
      };

      expect(mcpServers).toHaveProperty("github");
      expect(mcpServers).toHaveProperty("custom");
    });
  });
});
