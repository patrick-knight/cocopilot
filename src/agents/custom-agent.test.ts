import { CustomAgent } from "./custom-agent";
import type { CustomAgentStatus } from "./custom-agent";
import type { ParsedAgentDef } from "./custom-loader";

// ---------------------------------------------------------------------------
// Mock CopilotClientWrapper to avoid real SDK calls
// ---------------------------------------------------------------------------

const mockStart = jest.fn().mockResolvedValue(undefined);
const mockStop = jest.fn().mockResolvedValue(undefined);

jest.mock("../copilot/client.js", () => ({
  CopilotClientWrapper: jest.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    getState: jest.fn().mockReturnValue("connected"),
    agentName: "test-agent",
  })),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createDef(overrides: Partial<ParsedAgentDef> = {}): ParsedAgentDef {
  return {
    name: "test-agent",
    class: "persistent",
    tools: ["read_file", "search_code"],
    systemPrompt: "You are a test agent.",
    filePath: "/path/to/test-agent.md",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CustomAgent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Construction & accessors
  // -----------------------------------------------------------------------

  describe("construction", () => {
    it("exposes read-only accessors from the definition", () => {
      const def = createDef();
      const agent = new CustomAgent(def);

      expect(agent.name).toBe("test-agent");
      expect(agent.agentClass).toBe("persistent");
      expect(agent.tools).toEqual(["read_file", "search_code"]);
      expect(agent.systemPrompt).toBe("You are a test agent.");
      expect(agent.filePath).toBe("/path/to/test-agent.md");
    });

    it("freezes the definition to prevent mutation", () => {
      const def = createDef();
      const agent = new CustomAgent(def);

      def.name = "mutated";
      expect(agent.name).toBe("test-agent");
    });

    it("starts with stopped status and no client", () => {
      const agent = new CustomAgent(createDef());

      expect(agent.copilotClient).toBeNull();
      const status = agent.getStatus();
      expect(status.status).toBe("stopped");
      expect(status.startedAt).toBeNull();
      expect(status.uptimeMs).toBeNull();
      expect(status.error).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getStatus
  // -----------------------------------------------------------------------

  describe("getStatus", () => {
    it("returns full status snapshot", () => {
      const agent = new CustomAgent(createDef());
      const status = agent.getStatus();

      expect(status).toEqual({
        name: "test-agent",
        class: "persistent",
        status: "stopped",
        tools: ["read_file", "search_code"],
        filePath: "/path/to/test-agent.md",
        startedAt: null,
        uptimeMs: null,
        error: null,
      });
    });

    it("reports running status after start", async () => {
      const agent = new CustomAgent(createDef());
      await agent.start();

      const status = agent.getStatus();
      expect(status.status).toBe("running");
      expect(status.startedAt).toBeGreaterThan(0);
      expect(status.uptimeMs).toBeGreaterThanOrEqual(0);
    });

    it("reports error status when start fails", async () => {
      mockStart.mockRejectedValueOnce(new Error("Connection refused"));

      const agent = new CustomAgent(createDef());

      await expect(agent.start()).rejects.toThrow("Connection refused");

      const status = agent.getStatus();
      expect(status.status).toBe("error");
      expect(status.error).toBe("Connection refused");
    });
  });

  // -----------------------------------------------------------------------
  // Lifecycle: start
  // -----------------------------------------------------------------------

  describe("start", () => {
    it("creates and starts a CopilotClientWrapper", async () => {
      const agent = new CustomAgent(createDef());
      await agent.start();

      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(agent.copilotClient).not.toBeNull();
    });

    it("passes agent name and system prompt to the wrapper", async () => {
      const { CopilotClientWrapper } = jest.requireMock("../copilot/client.js");

      const agent = new CustomAgent(createDef());
      await agent.start();

      expect(CopilotClientWrapper).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: "test-agent",
          systemMessage: { mode: "replace", content: "You are a test agent." },
        }),
      );
    });

    it("passes model override when provided", async () => {
      const { CopilotClientWrapper } = jest.requireMock("../copilot/client.js");

      const agent = new CustomAgent(createDef(), { model: "gpt-4o" });
      await agent.start();

      expect(CopilotClientWrapper).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4o",
        }),
      );
    });

    it("throws if agent is already running", async () => {
      const agent = new CustomAgent(createDef());
      await agent.start();

      await expect(agent.start()).rejects.toThrow("already running");
    });

    it("sets error status on start failure", async () => {
      mockStart.mockRejectedValueOnce(new Error("Network error"));

      const agent = new CustomAgent(createDef());

      await expect(agent.start()).rejects.toThrow("Network error");

      const status = agent.getStatus();
      expect(status.status).toBe("error");
      expect(status.error).toBe("Network error");
    });
  });

  // -----------------------------------------------------------------------
  // Lifecycle: stop
  // -----------------------------------------------------------------------

  describe("stop", () => {
    it("stops the client and sets status to stopped", async () => {
      const agent = new CustomAgent(createDef());
      await agent.start();
      await agent.stop();

      expect(mockStop).toHaveBeenCalledTimes(1);
      expect(agent.copilotClient).toBeNull();

      const status = agent.getStatus();
      expect(status.status).toBe("stopped");
      expect(status.startedAt).toBeNull();
    });

    it("is a no-op when already stopped", async () => {
      const agent = new CustomAgent(createDef());

      await agent.stop(); // Should not throw

      expect(mockStop).not.toHaveBeenCalled();
    });

    it("cleans up even if client stop throws", async () => {
      mockStop.mockRejectedValueOnce(new Error("cleanup error"));

      const agent = new CustomAgent(createDef());
      await agent.start();

      // stop should still complete and set status to stopped
      await expect(agent.stop()).rejects.toThrow("cleanup error");

      const status = agent.getStatus();
      expect(status.status).toBe("stopped");
    });

    it("allows restarting after stop", async () => {
      const agent = new CustomAgent(createDef());

      await agent.start();
      expect(agent.getStatus().status).toBe("running");

      await agent.stop();
      expect(agent.getStatus().status).toBe("stopped");

      await agent.start();
      expect(agent.getStatus().status).toBe("running");
    });
  });

  // -----------------------------------------------------------------------
  // Ephemeral vs persistent
  // -----------------------------------------------------------------------

  describe("agent class", () => {
    it("reports persistent class", () => {
      const agent = new CustomAgent(createDef({ class: "persistent" }));
      expect(agent.agentClass).toBe("persistent");
      expect(agent.getStatus().class).toBe("persistent");
    });

    it("reports ephemeral class", () => {
      const agent = new CustomAgent(createDef({ class: "ephemeral" }));
      expect(agent.agentClass).toBe("ephemeral");
      expect(agent.getStatus().class).toBe("ephemeral");
    });
  });
});
