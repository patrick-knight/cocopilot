type SessionEventHandler = (event: unknown) => void;

class MockSession {
  readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  on(_handler: SessionEventHandler): () => void {
    return () => {};
  }
}

export class CopilotClient {
  constructor(_options: unknown = {}) {}

  async start(): Promise<void> {}

  async stop(): Promise<Error[]> {
    return [];
  }

  async forceStop(): Promise<void> {}

  async createSession(config: { sessionId?: string } = {}): Promise<MockSession> {
    return new MockSession(config.sessionId ?? "mock-session");
  }

  async resumeSession(
    sessionId: string,
    _config: unknown = {},
  ): Promise<MockSession> {
    return new MockSession(sessionId);
  }

  async deleteSession(_sessionId: string): Promise<void> {}

  async ping(_message?: string): Promise<{ message: string; timestamp: string; protocolVersion?: number }> {
    return { message: "pong", timestamp: new Date().toISOString() };
  }

  async getStatus(): Promise<{ version: string; protocolVersion: number }> {
    return { version: "1.0.0", protocolVersion: 1 };
  }

  async listModels(): Promise<unknown[]> {
    return [];
  }
}

export class CopilotSession {}

export function defineTool<
  TArgs extends Record<string, unknown>,
  TResult = unknown,
>(
  name: string,
  config: {
    description?: string;
    parameters?: unknown;
    handler: (args: TArgs) => TResult | Promise<TResult>;
  },
): {
  name: string;
  description?: string;
  parameters?: unknown;
  handler: (args: TArgs) => TResult | Promise<TResult>;
} {
  return {
    name,
    description: config.description,
    parameters: config.parameters,
    handler: config.handler,
  };
}

export function approveAll(): { kind: "allow" } {
  return { kind: "allow" };
}
