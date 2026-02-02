import {
  MessageType,
  agentChannel,
  streamChannel,
  CHANNEL_PREFIX,
  BROADCAST_CHANNEL,
  COMPLETIONS_CHANNEL,
  STREAM_CHANNEL_PREFIX,
} from "./types";

describe("MessageType enum", () => {
  it("contains all expected message types", () => {
    expect(MessageType.TASK_ASSIGNED).toBe("TASK_ASSIGNED");
    expect(MessageType.TASK_COMPLETE).toBe("TASK_COMPLETE");
    expect(MessageType.TASK_FAILED).toBe("TASK_FAILED");
    expect(MessageType.STATUS_REQUEST).toBe("STATUS_REQUEST");
    expect(MessageType.STATUS_RESPONSE).toBe("STATUS_RESPONSE");
    expect(MessageType.NUDGE).toBe("NUDGE");
    expect(MessageType.PR_CREATED).toBe("PR_CREATED");
    expect(MessageType.PR_MERGED).toBe("PR_MERGED");
    expect(MessageType.CI_FAILED).toBe("CI_FAILED");
    expect(MessageType.SPAWN_FIXUP).toBe("SPAWN_FIXUP");
    expect(MessageType.BROADCAST).toBe("BROADCAST");
    expect(MessageType.REVIEW_COMPLETE).toBe("REVIEW_COMPLETE");
    expect(MessageType.SPAWN_WORKER).toBe("SPAWN_WORKER");
    expect(MessageType.SECURITY_REVIEW_REQUEST).toBe("SECURITY_REVIEW_REQUEST");
    expect(MessageType.SECURITY_REVIEW_PASSED).toBe("SECURITY_REVIEW_PASSED");
    expect(MessageType.SECURITY_REVIEW_FAILED).toBe("SECURITY_REVIEW_FAILED");
    expect(MessageType.WORKER_ACTIVITY).toBe("WORKER_ACTIVITY");
    expect(MessageType.CODE_REVIEW_REQUEST).toBe("CODE_REVIEW_REQUEST");
    expect(MessageType.README_UPDATED).toBe("README_UPDATED");
    expect(MessageType.README_UPDATE_REQUEST).toBe("README_UPDATE_REQUEST");
  });

  it("has exactly 20 message types", () => {
    const values = Object.values(MessageType);
    expect(values).toHaveLength(20);
  });
});

describe("channel helpers", () => {
  it("agentChannel builds correct channel name", () => {
    expect(agentChannel("Snickers")).toBe(`${CHANNEL_PREFIX}:Snickers`);
    expect(agentChannel("chocolatier")).toBe(`${CHANNEL_PREFIX}:chocolatier`);
  });

  it("streamChannel builds correct stream channel name", () => {
    expect(streamChannel("Snickers")).toBe(`${STREAM_CHANNEL_PREFIX}:Snickers`);
  });

  it("BROADCAST_CHANNEL uses wildcard", () => {
    expect(BROADCAST_CHANNEL).toBe(`${CHANNEL_PREFIX}:*`);
  });

  it("COMPLETIONS_CHANNEL is defined", () => {
    expect(COMPLETIONS_CHANNEL).toBe("cocopilot:completions");
  });
});
