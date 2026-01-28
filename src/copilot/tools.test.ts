import {
  createAgentTools,
  createSendMessageTool,
  createMarkCompleteTool,
  createRequestHelpTool,
  AgentToolDependencies,
} from "./tools.js";
import { MessageBroker } from "../messaging/broker.js";
import { MessageType, COMPLETIONS_CHANNEL } from "../messaging/types.js";

// Mock the MessageBroker
const mockSend = jest.fn().mockResolvedValue({ id: "mock-id" });
const mockBroker = {
  send: mockSend,
  connect: jest.fn(),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
  acknowledge: jest.fn(),
  replay: jest.fn(),
  getPending: jest.fn(),
  getHistory: jest.fn(),
  cleanup: jest.fn(),
  deleteMessage: jest.fn(),
  close: jest.fn(),
  isReady: true,
} as unknown as MessageBroker;

const mockRedisPublish = jest.fn().mockResolvedValue(1);

function makeDeps(overrides?: Partial<AgentToolDependencies>): AgentToolDependencies {
  return {
    agentName: "Snickers",
    broker: mockBroker,
    redisPublish: mockRedisPublish,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("createAgentTools", () => {
  it("returns an array of three tool definitions", () => {
    const tools = createAgentTools(makeDeps());
    expect(tools).toHaveLength(3);
    expect(tools[0].name).toBe("send_message");
    expect(tools[1].name).toBe("mark_complete");
    expect(tools[2].name).toBe("request_help");
  });

  it("each tool has description, parameters, and handler", () => {
    const tools = createAgentTools(makeDeps());
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.parameters.type).toBe("object");
      expect(typeof tool.handler).toBe("function");
    }
  });
});

describe("send_message tool", () => {
  it("has correct parameter schema", () => {
    const tool = createSendMessageTool(makeDeps());
    expect(tool.parameters.properties.to).toBeDefined();
    expect(tool.parameters.properties.message).toBeDefined();
    expect(tool.parameters.properties.priority).toBeDefined();
    expect(tool.parameters.properties.priority.enum).toEqual([
      "low",
      "normal",
      "high",
    ]);
    expect(tool.parameters.required).toEqual(["to", "message"]);
  });

  it("sends a BROADCAST message via the broker", async () => {
    const tool = createSendMessageTool(makeDeps());

    const result = await tool.handler({
      to: "KitKat",
      message: "How is the auth middleware going?",
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      type: MessageType.BROADCAST,
      from: "Snickers",
      to: "KitKat",
      payload: { message: "How is the auth middleware going?" },
      priority: "normal",
    });

    expect(result.sent).toBe(true);
    expect(result.to).toBe("KitKat");
    expect(typeof result.timestamp).toBe("number");
  });

  it("passes custom priority to the broker", async () => {
    const tool = createSendMessageTool(makeDeps());

    await tool.handler({
      to: "chocolatier",
      message: "Urgent update",
      priority: "high",
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ priority: "high" }),
    );
  });

  it("defaults priority to normal when not specified", async () => {
    const tool = createSendMessageTool(makeDeps());

    await tool.handler({ to: "Twix", message: "Hello" });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ priority: "normal" }),
    );
  });

  it("uses the agent name as the from field", async () => {
    const tool = createSendMessageTool(makeDeps({ agentName: "Reeses" }));

    await tool.handler({ to: "chocolatier", message: "Done" });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Reeses" }),
    );
  });
});

describe("mark_complete tool", () => {
  it("has correct parameter schema", () => {
    const tool = createMarkCompleteTool(makeDeps());
    expect(tool.parameters.properties.summary).toBeDefined();
    expect(tool.parameters.properties.pr_url).toBeDefined();
    expect(tool.parameters.required).toEqual(["summary"]);
  });

  it("sends TASK_COMPLETE to chocolatier via broker", async () => {
    const tool = createMarkCompleteTool(makeDeps());

    const result = await tool.handler({
      summary: "Added JWT auth middleware with tests",
      pr_url: "https://github.com/org/repo/pull/42",
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      type: MessageType.TASK_COMPLETE,
      from: "Snickers",
      to: "chocolatier",
      payload: {
        summary: "Added JWT auth middleware with tests",
        pr_url: "https://github.com/org/repo/pull/42",
      },
      priority: "high",
    });

    expect(result.completed).toBe(true);
    expect(result.agent).toBe("Snickers");
    expect(typeof result.timestamp).toBe("number");
  });

  it("publishes to completions channel when redisPublish is provided", async () => {
    const tool = createMarkCompleteTool(makeDeps());

    await tool.handler({ summary: "Task done" });

    expect(mockRedisPublish).toHaveBeenCalledTimes(1);
    expect(mockRedisPublish).toHaveBeenCalledWith(
      COMPLETIONS_CHANNEL,
      expect.any(String),
    );

    const publishedData = JSON.parse(mockRedisPublish.mock.calls[0][1]);
    expect(publishedData.agent).toBe("Snickers");
    expect(publishedData.summary).toBe("Task done");
    expect(typeof publishedData.timestamp).toBe("number");
  });

  it("includes pr_url in completions channel payload when provided", async () => {
    const tool = createMarkCompleteTool(makeDeps());

    await tool.handler({
      summary: "Done",
      pr_url: "https://github.com/org/repo/pull/99",
    });

    const publishedData = JSON.parse(mockRedisPublish.mock.calls[0][1]);
    expect(publishedData.pr_url).toBe(
      "https://github.com/org/repo/pull/99",
    );
  });

  it("works without redisPublish (skips completions channel)", async () => {
    const tool = createMarkCompleteTool(
      makeDeps({ redisPublish: undefined }),
    );

    const result = await tool.handler({ summary: "All done" });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockRedisPublish).not.toHaveBeenCalled();
    expect(result.completed).toBe(true);
  });

  it("sends without pr_url when not provided", async () => {
    const tool = createMarkCompleteTool(makeDeps());

    await tool.handler({ summary: "Finished refactoring" });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { summary: "Finished refactoring", pr_url: undefined },
      }),
    );
  });
});

describe("request_help tool", () => {
  it("has correct parameter schema", () => {
    const tool = createRequestHelpTool(makeDeps());
    expect(tool.parameters.properties.question).toBeDefined();
    expect(tool.parameters.properties.context).toBeDefined();
    expect(tool.parameters.required).toEqual(["question"]);
  });

  it("sends a NUDGE message to chocolatier via broker", async () => {
    const tool = createRequestHelpTool(makeDeps());

    const result = await tool.handler({
      question: "Where are the database connection settings?",
      context: "Looked in src/config but nothing there",
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      type: MessageType.NUDGE,
      from: "Snickers",
      to: "chocolatier",
      payload: {
        hint: "Where are the database connection settings?",
        context: "Looked in src/config but nothing there",
      },
      priority: "high",
      ack_required: true,
    });

    expect(result.sent).toBe(true);
    expect(result.to).toBe("chocolatier");
    expect(typeof result.timestamp).toBe("number");
  });

  it("sends without context when not provided", async () => {
    const tool = createRequestHelpTool(makeDeps());

    await tool.handler({ question: "How do I run the tests?" });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          hint: "How do I run the tests?",
          context: undefined,
        },
      }),
    );
  });

  it("always sends to chocolatier regardless of agentName", async () => {
    const tool = createRequestHelpTool(makeDeps({ agentName: "KitKat" }));

    await tool.handler({ question: "Help" });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "KitKat",
        to: "chocolatier",
      }),
    );
  });

  it("sets ack_required to true", async () => {
    const tool = createRequestHelpTool(makeDeps());

    await tool.handler({ question: "Stuck" });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ ack_required: true }),
    );
  });
});
