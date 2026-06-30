/**
 * Tests for CopilotClientWrapper
 *
 * Uses mocks for @github/copilot-sdk and RedisMessageBus to test
 * the wrapper's session management, tool merging, event streaming,
 * and reconnection logic without requiring a real Copilot CLI or Redis.
 */

import { CopilotClientWrapper } from "./client.js";
import type {
  CopilotWrapperConfig,
  StreamEvent,
  ManagedSession,
} from "./types.js";
import type { SessionEvent, Tool } from "@github/copilot-sdk";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock session returned by the SDK client
function createMockSession(sessionId = "test-session-1") {
  const handlers: Array<(event: SessionEvent) => void> = [];

  return {
    sessionId,
    on: jest.fn((handler: (event: SessionEvent) => void) => {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    }),
    send: jest.fn().mockResolvedValue("msg-1"),
    sendAndWait: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    abort: jest.fn().mockResolvedValue(undefined),
    getMessages: jest.fn().mockResolvedValue([]),
    registerTools: jest.fn(),
    registerPermissionHandler: jest.fn(),
    _dispatchEvent: jest.fn(),
    _handlePermissionRequest: jest.fn(),
    // Helper to simulate event dispatch for tests
    _simulateEvent(event: SessionEvent) {
      for (const h of handlers) h(event);
    },
  };
}

// Mock CopilotClient from the SDK
const mockSession = createMockSession();
const mockClient = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue([]),
  forceStop: jest.fn().mockResolvedValue(undefined),
  createSession: jest.fn().mockResolvedValue(mockSession),
  resumeSession: jest.fn().mockResolvedValue(mockSession),
  deleteSession: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn().mockResolvedValue({ message: "pong", timestamp: new Date().toISOString() }),
  listModels: jest.fn().mockResolvedValue([]),
  getLastSessionId: jest.fn().mockResolvedValue(undefined),
  listSessions: jest.fn().mockResolvedValue([]),
  getStatus: jest.fn().mockResolvedValue({ version: "1.0.0", protocolVersion: 1 }),
  getAuthStatus: jest.fn().mockResolvedValue({ isAuthenticated: true }),
};

jest.mock("@github/copilot-sdk", () => ({
  CopilotClient: jest.fn().mockImplementation(() => mockClient),
  CopilotSession: jest.fn(),
  defineTool: jest.fn(
    (name: string, config: { description?: string; handler: Function }) => ({
      name,
      description: config.description,
      handler: config.handler,
    }),
  ),
}));

// Mock RedisMessageBus
function createMockBus(ready = true) {
  return {
    isReady: ready,
    publish: jest.fn().mockResolvedValue(undefined),
    publishRaw: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    subscribeChannel: jest.fn().mockResolvedValue(undefined),
    unsubscribeChannel: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultConfig(
  overrides: Partial<CopilotWrapperConfig> = {},
): CopilotWrapperConfig {
  return {
    agentName: "test-agent",
    ...overrides,
  };
}

function makeTool(name: string): Tool {
  return {
    name,
    description: `Tool ${name}`,
    handler: jest.fn().mockResolvedValue("ok"),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CopilotClientWrapper", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.stop.mockResolvedValue([]);
    mockClient.createSession.mockResolvedValue(mockSession);
    mockClient.resumeSession.mockResolvedValue(mockSession);
  });

  describe("constructor", () => {
    it("should set default config values", () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());

      expect(wrapper.agentName).toBe("test-agent");
      expect(wrapper.defaultModel).toBe("claude-sonnet-4-5");
    });

    it("should accept custom model", () => {
      const wrapper = new CopilotClientWrapper(
        defaultConfig({ model: "gpt-5" }),
      );

      expect(wrapper.defaultModel).toBe("gpt-5");
    });
  });

  describe("start / stop", () => {
    it("should start the underlying client", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      await wrapper.start();

      expect(mockClient.start).toHaveBeenCalled();
    });

    it("should emit connected state on start", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      const states: string[] = [];
      wrapper.onConnectionStateChange((state) => states.push(state));

      await wrapper.start();

      expect(states).toContain("connected");
    });

    it("should stop the underlying client", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      await wrapper.start();
      await wrapper.stop();

      expect(mockClient.stop).toHaveBeenCalled();
    });

    it("should emit disconnected state on stop", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      const states: string[] = [];
      wrapper.onConnectionStateChange((state) => states.push(state));

      await wrapper.start();
      await wrapper.stop();

      expect(states).toContain("disconnected");
    });

    it("should force stop if graceful stop returns errors", async () => {
      mockClient.stop.mockResolvedValue([new Error("timeout")]);

      const wrapper = new CopilotClientWrapper(defaultConfig());
      await wrapper.start();
      await wrapper.stop();

      expect(mockClient.forceStop).toHaveBeenCalled();
    });

    it("should clear managed sessions on stop", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      await wrapper.start();
      await wrapper.createSession();

      expect(wrapper.getManagedSessions().size).toBe(1);

      await wrapper.stop();

      expect(wrapper.getManagedSessions().size).toBe(0);
    });
  });

  describe("createSession", () => {
    it("should create a session with default model", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      await wrapper.createSession();

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-sonnet-4-5",
          streaming: true,
        }),
      );
    });

    it("should allow model override per session", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      await wrapper.createSession({ model: "gpt-5" });

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gpt-5" }),
      );
    });

    it("should track the session", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      const session = await wrapper.createSession();

      const managed = wrapper.getManagedSessions();
      expect(managed.has(session.sessionId)).toBe(true);
    });

    it("should subscribe to session events", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      const session = await wrapper.createSession();

      expect(mockSession.on).toHaveBeenCalled();
    });

    it("should pass custom session ID", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      await wrapper.createSession({ sessionId: "custom-id" });

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "custom-id" }),
      );
    });
  });

  describe("tool merging", () => {
    it("should include default tools when no session tools specified", async () => {
      const tool = makeTool("default-tool");
      const wrapper = new CopilotClientWrapper(
        defaultConfig({ defaultTools: [tool] }),
      );

      await wrapper.createSession();

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({ name: "default-tool" }),
          ]),
        }),
      );
    });

    it("should merge default and session tools", async () => {
      const defaultTool = makeTool("default-tool");
      const sessionTool = makeTool("session-tool");

      const wrapper = new CopilotClientWrapper(
        defaultConfig({ defaultTools: [defaultTool] }),
      );

      await wrapper.createSession({ tools: [sessionTool] });

      const passedConfig = mockClient.createSession.mock.calls[0][0];
      const toolNames = passedConfig.tools.map((t: Tool) => t.name);

      expect(toolNames).toContain("default-tool");
      expect(toolNames).toContain("session-tool");
    });

    it("should let session tools override defaults with same name", async () => {
      const defaultTool = makeTool("shared-name");
      const sessionTool = makeTool("shared-name");

      const wrapper = new CopilotClientWrapper(
        defaultConfig({ defaultTools: [defaultTool] }),
      );

      await wrapper.createSession({ tools: [sessionTool] });

      const passedConfig = mockClient.createSession.mock.calls[0][0];
      expect(passedConfig.tools).toHaveLength(1);
      expect(passedConfig.tools[0]).toBe(sessionTool);
    });
  });

  describe("MCP server merging", () => {
    it("should pass default MCP servers", async () => {
      const wrapper = new CopilotClientWrapper(
        defaultConfig({
          mcpServers: {
            github: {
              type: "http",
              url: "https://api.githubcopilot.com/mcp/",
              tools: ["*"],
            },
          },
        }),
      );

      await wrapper.createSession();

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: expect.objectContaining({
            github: expect.objectContaining({
              url: "https://api.githubcopilot.com/mcp/",
            }),
          }),
        }),
      );
    });

    it("should merge session MCP servers over defaults", async () => {
      const wrapper = new CopilotClientWrapper(
        defaultConfig({
          mcpServers: {
            github: {
              type: "http",
              url: "https://api.githubcopilot.com/mcp/",
              tools: ["*"],
            },
          },
        }),
      );

      await wrapper.createSession({
        mcpServers: {
          custom: {
            type: "local",
            command: "npx",
            args: ["my-mcp-server"],
            tools: ["*"],
          },
        },
      });

      const passedConfig = mockClient.createSession.mock.calls[0][0];
      expect(passedConfig.mcpServers).toHaveProperty("github");
      expect(passedConfig.mcpServers).toHaveProperty("custom");
    });
  });

  describe("event streaming to Redis", () => {
    it("should publish assistant.message_delta to Redis", async () => {
      const bus = createMockBus();
      const wrapper = new CopilotClientWrapper(
        defaultConfig(),
        bus as any,
      );

      await wrapper.createSession();

      // Simulate an event
      mockSession._simulateEvent({
        id: "evt-1",
        timestamp: new Date().toISOString(),
        parentId: null,
        type: "assistant.message_delta",
        ephemeral: true,
        data: {
          messageId: "msg-1",
          deltaContent: "Hello",
        },
      });

      expect(bus.publish).toHaveBeenCalled();
      const publishedMessage = bus.publish.mock.calls[0][0];
      const streamEvt: StreamEvent = JSON.parse(
        publishedMessage.payload.message,
      );
      expect(streamEvt.type).toBe("output");
      expect(streamEvt.content).toBe("Hello");
      expect(streamEvt.agent).toBe("test-agent");
    });

    it("should publish tool.execution_start events", async () => {
      const bus = createMockBus();
      const wrapper = new CopilotClientWrapper(
        defaultConfig(),
        bus as any,
      );

      await wrapper.createSession();

      mockSession._simulateEvent({
        id: "evt-2",
        timestamp: new Date().toISOString(),
        parentId: null,
        type: "tool.execution_start",
        data: {
          toolCallId: "tc-1",
          toolName: "read_file",
          arguments: { path: "/tmp/test.ts" },
        },
      });

      expect(bus.publish).toHaveBeenCalled();
      const publishedMessage = bus.publish.mock.calls[0][0];
      const streamEvt: StreamEvent = JSON.parse(
        publishedMessage.payload.message,
      );
      expect(streamEvt.type).toBe("tool_call");
      expect(JSON.parse(streamEvt.content).toolName).toBe("read_file");
    });

    it("should not publish when Redis bus is not ready", async () => {
      const bus = createMockBus(false);
      const wrapper = new CopilotClientWrapper(
        defaultConfig(),
        bus as any,
      );

      await wrapper.createSession();

      mockSession._simulateEvent({
        id: "evt-3",
        timestamp: new Date().toISOString(),
        parentId: null,
        type: "assistant.message",
        data: { messageId: "msg-1", content: "test" },
      });

      expect(bus.publish).not.toHaveBeenCalled();
    });

    it("should not publish for untracked event types", async () => {
      const bus = createMockBus();
      const wrapper = new CopilotClientWrapper(
        defaultConfig(),
        bus as any,
      );

      await wrapper.createSession();

      mockSession._simulateEvent({
        id: "evt-4",
        timestamp: new Date().toISOString(),
        parentId: null,
        type: "assistant.usage",
        ephemeral: true,
        data: { inputTokens: 100, outputTokens: 50 },
      } as SessionEvent);

      expect(bus.publish).not.toHaveBeenCalled();
    });

    it("should work without a Redis bus", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());

      const session = await wrapper.createSession();

      // Should not throw when event fires with no bus
      mockSession._simulateEvent({
        id: "evt-5",
        timestamp: new Date().toISOString(),
        parentId: null,
        type: "assistant.message",
        data: { messageId: "msg-1", content: "test" },
      });

      // No assertion needed — just verifying it doesn't throw
    });
  });

  describe("destroySession", () => {
    it("should remove the session from managed sessions", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      const session = await wrapper.createSession();

      expect(wrapper.getManagedSessions().size).toBe(1);

      await wrapper.destroySession(session.sessionId);

      expect(wrapper.getManagedSessions().size).toBe(0);
    });

    it("should call deleteSession on the client", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      const session = await wrapper.createSession();

      await wrapper.destroySession(session.sessionId);

      expect(mockClient.deleteSession).toHaveBeenCalledWith(
        session.sessionId,
      );
    });

    it("should not throw if session is already destroyed", async () => {
      mockClient.deleteSession.mockRejectedValueOnce(new Error("not found"));

      const wrapper = new CopilotClientWrapper(defaultConfig());

      await expect(
        wrapper.destroySession("nonexistent"),
      ).resolves.toBeUndefined();
    });
  });

  describe("resumeSession", () => {
    it("should call resumeSession on the client", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      await wrapper.resumeSession("session-to-resume");

      expect(mockClient.resumeSession).toHaveBeenCalledWith(
        "session-to-resume",
        expect.any(Object),
      );
    });

    it("should track the resumed session", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      const session = await wrapper.resumeSession("session-to-resume");

      expect(wrapper.getManagedSessions().has(session.sessionId)).toBe(true);
    });
  });

  describe("connection state", () => {
    it("should return disconnected state initially", () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());

      expect(wrapper.getState()).toBe("disconnected");
    });

    it("should support unsubscribing from state changes", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      const states: string[] = [];

      const unsub = wrapper.onConnectionStateChange((state) =>
        states.push(state),
      );

      await wrapper.start();
      expect(states).toContain("connected");

      unsub();
      states.length = 0;

      await wrapper.stop();
      expect(states).toHaveLength(0);
    });
  });

  describe("ping", () => {
    it("should delegate to the underlying client", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      await wrapper.ping();

      expect(mockClient.ping).toHaveBeenCalledWith("cocopilot-health-check");
    });
  });

  describe("listModels", () => {
    it("should delegate to the underlying client", async () => {
      const wrapper = new CopilotClientWrapper(defaultConfig());
      await wrapper.listModels();

      expect(mockClient.listModels).toHaveBeenCalled();
    });
  });
});
