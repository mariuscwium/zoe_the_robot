import { describe, it, expect } from "vitest";
import type {
  ClaudeClient,
  ClaudeMessage,
  ClaudeMessageParams,
  ClaudeContentBlock,
  RedisClient,
  RedisResult,
  CalendarClient,
  CalendarProvider,
  CalendarEvent,
  CalendarEventInput,
  CalendarEventList,
  ListEventsParams,
  Clock,
} from "./deps.js";
import type { FamilyMember } from "./types.js";
import type { ConversationMessage } from "./history.js";
import { invokeAgent } from "./agent.js";
import type { AgentDeps, AgentParams } from "./agent.js";

// --- Stubs ---

class StubClaude implements ClaudeClient {
  private responses: ClaudeMessage[];
  private callIndex = 0;
  readonly receivedParams: ClaudeMessageParams[] = [];

  constructor(responses: ClaudeMessage[]) {
    this.responses = responses;
  }

  createMessage(params: ClaudeMessageParams): Promise<ClaudeMessage> {
    this.receivedParams.push(params);
    const response = this.responses[this.callIndex++];
    if (!response) throw new Error("No more stub responses");
    return Promise.resolve(response);
  }
}

class StubRedis implements RedisClient {
  readonly commands: string[][] = [];

  execute(command: string[]): Promise<RedisResult> {
    this.commands.push(command);
    const op = command[0];
    if (op === "GET") return Promise.resolve({ result: "stored content" });
    if (op === "SET") return Promise.resolve({ result: "OK" });
    if (op === "DEL") return Promise.resolve({ result: 1 });
    if (op === "APPEND") return Promise.resolve({ result: 15 });
    if (op === "SCAN") return Promise.resolve({ result: ["0", []] });
    if (op === "LPUSH") return Promise.resolve({ result: 1 });
    return Promise.resolve({ result: null });
  }

  pipeline(commands: string[][]): Promise<RedisResult[]> {
    return Promise.resolve(commands.map(() => ({ result: "OK" })));
  }
}

class StubCalendarClient implements CalendarClient {
  listEvents(_params: ListEventsParams): Promise<CalendarEventList> {
    return Promise.resolve({ kind: "calendar#events", items: [] });
  }

  insertEvent(event: CalendarEventInput): Promise<CalendarEvent> {
    return Promise.resolve({
      ...event,
      id: "evt-123",
      status: "confirmed",
      htmlLink: "https://cal.google.com/evt-123",
      created: "2026-03-10T00:00:00Z",
      updated: "2026-03-10T00:00:00Z",
    });
  }

  getEvent(_eventId: string): Promise<CalendarEvent> {
    return Promise.resolve({
      id: "evt-123",
      summary: "Test",
      start: { dateTime: "2026-03-10T10:00:00Z" },
      end: { dateTime: "2026-03-10T11:00:00Z" },
      status: "confirmed",
      htmlLink: "https://cal.google.com/evt-123",
      created: "2026-03-10T00:00:00Z",
      updated: "2026-03-10T00:00:00Z",
    });
  }

  deleteEvent(_eventId: string): Promise<void> {
    return Promise.resolve();
  }
}

class StubCalendarProvider implements CalendarProvider {
  getClient(_memberId: string): Promise<CalendarClient | null> {
    return Promise.resolve(new StubCalendarClient());
  }
}

const FIXED_DATE = new Date("2026-03-10T12:00:00Z");
const stubClock: Clock = { now: () => FIXED_DATE };

const testMember: FamilyMember = {
  id: "member-1",
  name: "Marius",
  chatId: 111111,
  timezone: "Pacific/Auckland",
  role: "admin",
  isAdmin: true,
};

const emptyHistory: ConversationMessage[] = [];

function makeDeps(claude: StubClaude): { deps: AgentDeps; redis: StubRedis } {
  const redis = new StubRedis();
  return {
    deps: { claude, redis, calendar: new StubCalendarProvider(), clock: stubClock },
    redis,
  };
}

function makeParams(overrides?: Partial<AgentParams>): AgentParams {
  return {
    member: testMember,
    userMessage: "Hello",
    conversationHistory: emptyHistory,
    ...overrides,
  };
}

function textResponse(text: string): ClaudeMessage {
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
  };
}

function toolUseResponse(
  toolName: string,
  input: Record<string, unknown>,
): ClaudeMessage {
  return {
    id: "msg-tu",
    type: "message",
    role: "assistant",
    content: [
      { type: "tool_use", id: "call-1", name: toolName, input },
    ],
    model: "claude-sonnet-4-20250514",
    stop_reason: "tool_use",
  };
}

// --- Tests ---

describe("invokeAgent", () => {
  it("returns text for a simple response with no tool use", async () => {
    const claude = new StubClaude([textResponse("Hi Marius!")]);
    const { deps } = makeDeps(claude);
    const result = await invokeAgent(deps, makeParams());
    expect(result).toBe("Hi Marius!");
  });

  it("handles a single tool call and returns final text", async () => {
    const claude = new StubClaude([
      toolUseResponse("read_memory", { key: "family/todos" }),
      textResponse("Here are your todos: stored content"),
    ]);
    const { deps } = makeDeps(claude);
    const result = await invokeAgent(deps, makeParams());
    expect(result).toBe("Here are your todos: stored content");
    expect(claude.receivedParams).toHaveLength(2);
  });

  it("handles multiple sequential tool calls", async () => {
    const claude = new StubClaude([
      toolUseResponse("read_memory", { key: "family/todos" }),
      toolUseResponse("read_memory", { key: "family/shopping" }),
      textResponse("Found both documents."),
    ]);
    const { deps } = makeDeps(claude);
    const result = await invokeAgent(deps, makeParams());
    expect(result).toBe("Found both documents.");
    expect(claude.receivedParams).toHaveLength(3);
  });

  it("returns fallback when max iterations reached", async () => {
    const looping = toolUseResponse("read_memory", { key: "family/todos" });
    const responses = Array.from({ length: 16 }, () => looping);
    const claude = new StubClaude(responses);
    const { deps } = makeDeps(claude);
    const result = await invokeAgent(deps, makeParams());
    expect(result).toContain("thinking too long");
  });

  it("handles tool errors gracefully", async () => {
    const claude = new StubClaude([
      toolUseResponse("read_memory", {}),
      textResponse("Sorry, I could not read that document."),
    ]);
    const { deps } = makeDeps(claude);
    const result = await invokeAgent(deps, makeParams());
    expect(result).toBe("Sorry, I could not read that document.");
  });

  it("appends audit log for mutating tool calls", async () => {
    const claude = new StubClaude([
      toolUseResponse("write_memory", {
        key: "family/todos",
        content: "- Buy milk",
      }),
      textResponse("Done, saved your todo."),
    ]);
    const { deps, redis } = makeDeps(claude);
    await invokeAgent(deps, makeParams());
    const auditCmds = redis.commands.filter(
      (c) => c[0] === "LPUSH" && c[1] === "log:audit",
    );
    expect(auditCmds).toHaveLength(1);
  });

  it("includes image content block when imageBase64 is provided", async () => {
    const claude = new StubClaude([textResponse("I see a photo.")]);
    const { deps } = makeDeps(claude);
    await invokeAgent(
      deps,
      makeParams({ imageBase64: "abc123", userMessage: "What is this?" }),
    );
    const params = claude.receivedParams[0];
    expect(params).toBeDefined();
    if (params === undefined) return;
    const lastMsg = params.messages[params.messages.length - 1];
    expect(lastMsg).toBeDefined();
    if (lastMsg === undefined) return;
    expect(Array.isArray(lastMsg.content)).toBe(true);
    const blocks = lastMsg.content as ClaudeContentBlock[];
    expect(blocks[0]?.type).toBe("image");
    expect(blocks[1]?.type).toBe("text");
  });

  it("passes conversation history as prior messages", async () => {
    const history: ConversationMessage[] = [
      { role: "user", content: "Hi", timestamp: "2026-03-10T00:00:00Z" },
      {
        role: "assistant",
        content: "Hello!",
        timestamp: "2026-03-10T00:00:01Z",
      },
    ];
    const claude = new StubClaude([textResponse("Continuing our chat.")]);
    const { deps } = makeDeps(claude);
    await invokeAgent(deps, makeParams({ conversationHistory: history }));
    const params = claude.receivedParams[0];
    expect(params).toBeDefined();
    if (params === undefined) return;
    // 2 history + 1 current = 3 messages
    expect(params.messages).toHaveLength(3);
  });
});
