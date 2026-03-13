/**
 * Integration tests for Features 3–7 of the Family Telegram Assistant.
 * Exercises invokeAgent + tool dispatch against digital twins.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RedisTwin } from "../../twins/redis.js";
import { CalendarTwin } from "../../twins/calendar.js";
import { CalendarProviderTwin } from "../../twins/calendar-provider.js";
import { createNotionTwin } from "../../twins/notion.js";
import { invokeAgent } from "../../lib/agent.js";
import type { AgentDeps, AgentParams } from "../../lib/agent.js";
import { loadHistory, saveHistory } from "../../lib/history.js";
import { getAuditLog } from "../../lib/audit.js";
import { readMemory, listMemoryKeys } from "../../lib/memory.js";
import type {
  ClaudeClient,
  ClaudeMessage,
  ClaudeMessageParams,
  Clock,
} from "../../lib/deps.js";
import type { CalendarEvent } from "../../lib/deps.js";
import type { FamilyMember } from "../../lib/types.js";
import type { ConversationMessage } from "../../lib/history.js";

function assertReminders(event: CalendarEvent | undefined): void {
  expect(event).toBeDefined();
  if (event === undefined) return;
  const r = event.reminders;
  expect(r?.useDefault).toBe(false);
  expect(r?.overrides).toHaveLength(2);
  expect(r?.overrides?.[0]).toEqual({ method: "popup", minutes: 0 });
  expect(r?.overrides?.[1]).toEqual({ method: "popup", minutes: 10 });
}

// --- StubClaude ---

class StubClaude implements ClaudeClient {
  private responses: ClaudeMessage[];
  private callIndex = 0;
  receivedParams: ClaudeMessageParams[] = [];

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

// --- Helpers ---

const MODEL = "claude-sonnet-4-20250514";
const STOP_END = "end_turn";
const STOP_TOOL = "tool_use";

function textResponse(text: string): ClaudeMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    model: MODEL,
    stop_reason: STOP_END,
  };
}

function toolUseResponse(
  toolName: string,
  input: Record<string, unknown>,
): ClaudeMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [
      { type: "tool_use", id: `call_${toolName}`, name: toolName, input },
    ],
    model: MODEL,
    stop_reason: STOP_TOOL,
  };
}

const testMember: FamilyMember = {
  id: "marius",
  name: "Marius",
  chatId: 111111,
  timezone: "Pacific/Auckland",
  role: "admin",
  isAdmin: true,
};

const clock: Clock = { now: () => new Date("2026-03-10T12:00:00Z") };

interface TestContext {
  agentDeps: AgentDeps;
  calendarTwin: CalendarTwin;
  redis: RedisTwin;
  claude: StubClaude;
}

function setup(claude: StubClaude): TestContext {
  const calendarTwin = new CalendarTwin();
  const redis = new RedisTwin(clock);
  const { client: notion } = createNotionTwin();
  return {
    agentDeps: {
      claude,
      redis,
      calendar: new CalendarProviderTwin(calendarTwin),
      clock,
      notion,
    },
    calendarTwin,
    redis,
    claude,
  };
}

function makeParams(overrides: Partial<AgentParams> = {}): AgentParams {
  return {
    member: testMember,
    userMessage: "test message",
    conversationHistory: [],
    ...overrides,
  };
}

// --- Feature 3: Conversation History ---

describe("Feature 3 — Conversation History", () => {
  let redis: RedisTwin;

  beforeEach(() => {
    redis = new RedisTwin(clock);
  });

  it("loads empty history when Redis contains malformed JSON", async () => {
    await redis.execute(["RPUSH", "conversation:111111", "not-json"]);
    await redis.execute([
      "RPUSH",
      "conversation:111111",
      "{broken: true",
    ]);

    const history = await loadHistory({ redis }, 111111);
    expect(history).toEqual([]);
  });

  it("persists history across save and load", async () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "Hello", timestamp: "2026-03-10T12:00:00Z" },
      {
        role: "assistant",
        content: "Hi there!",
        timestamp: "2026-03-10T12:00:01Z",
      },
    ];

    await saveHistory({ redis }, 111111, messages);
    const loaded = await loadHistory({ redis }, 111111);

    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.role).toBe("user");
    expect(loaded[0]?.content).toBe("Hello");
    expect(loaded[1]?.role).toBe("assistant");
    expect(loaded[1]?.content).toBe("Hi there!");
  });
});

// --- Feature 4: Agent & Tools ---

describe("Feature 4 — Agent & Tools", () => {
  it("creates a calendar event with reminders", async () => {
    const ctx = setup(new StubClaude([
      toolUseResponse("create_event", {
        summary: "Call accountant",
        start_time: "2026-03-12T10:00:00+13:00",
        end_time: "2026-03-12T10:30:00+13:00",
        reminders: [{ method: "popup", minutes: 0 }],
      }),
      textResponse("Created: Call accountant on Thursday at 10am."),
    ]));
    const result = await invokeAgent(ctx.agentDeps, makeParams());

    expect(result).toContain("Call accountant");

    const events = await ctx.calendarTwin.listEvents({
      timeMin: "2026-03-01T00:00:00Z",
      timeMax: "2026-03-31T00:00:00Z",
    });
    expect(events.items).toHaveLength(1);
    const event = events.items[0];
    expect(event?.summary).toBe("Call accountant - Zoe");
    expect(event?.reminders?.useDefault).toBe(false);
    expect(event?.reminders?.overrides).toEqual([
      { method: "popup", minutes: 0 },
    ]);
  });

  it("creates a recurring event", async () => {
    const ctx = setup(new StubClaude([
      toolUseResponse("create_recurring_event", {
        summary: "Take medication",
        start_time: "2026-03-10T08:00:00+13:00",
        end_time: "2026-03-10T08:15:00+13:00",
        recurrence: "RRULE:FREQ=DAILY",
      }),
      textResponse("Created daily medication reminder."),
    ]));
    const result = await invokeAgent(ctx.agentDeps, makeParams());

    expect(result).toContain("medication");

    const events = await ctx.calendarTwin.listEvents({
      timeMin: "2026-03-01T00:00:00Z",
      timeMax: "2026-03-31T00:00:00Z",
    });
    const base = events.items.find((e: CalendarEvent) => e.summary === "Take medication - Zoe");
    expect(base).toBeDefined();
    expect(base?.recurrence).toEqual(["RRULE:FREQ=DAILY"]);
  });

  it("deletes a calendar event", async () => {
    const ctx = setup(new StubClaude([]));

    const created = await ctx.calendarTwin.insertEvent({
      summary: "Dentist",
      start: { dateTime: "2026-03-13T14:00:00+13:00" },
      end: { dateTime: "2026-03-13T15:00:00+13:00" },
    });

    ctx.agentDeps.claude = new StubClaude([
      toolUseResponse("delete_calendar_event", {
        event_id: created.id,
      }),
      textResponse("Dentist appointment deleted."),
    ]);

    const result = await invokeAgent(ctx.agentDeps, makeParams());
    expect(result).toContain("deleted");

    const events = await ctx.calendarTwin.listEvents({
      timeMin: "2026-03-01T00:00:00Z",
      timeMax: "2026-03-31T00:00:00Z",
    });
    const dentist = events.items.find((e: CalendarEvent) => e.summary === "Dentist");
    expect(dentist).toBeUndefined();
  });

  it("returns fallback message when agent loop exceeds 8 tool calls", async () => {
    const looping = toolUseResponse("read_memory", {
      key: "family/todos",
    });
    const ninthResponse = textResponse("This should never be reached");
    const responses = Array.from({ length: 16 }, () => looping);
    responses.push(ninthResponse);
    const claude = new StubClaude(responses);
    const ctx = setup(claude);

    const result = await invokeAgent(ctx.agentDeps, makeParams());
    expect(result).toContain("thinking too long");
    expect(claude.receivedParams).toHaveLength(16);
  });

  it("mutating tool call triggers audit log entry", async () => {
    const ctx = setup(new StubClaude([
      toolUseResponse("write_memory", {
        key: "family/todos",
        content: "- Buy milk",
      }),
      textResponse("Saved your todo."),
    ]));
    await invokeAgent(ctx.agentDeps, makeParams());

    const auditEntries = await getAuditLog({ redis: ctx.redis });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]?.action).toBe("write_memory");
    expect(auditEntries[0]?.memberId).toBe("marius");
  });
});

// --- Feature 5: Memory ---

describe("Feature 5 — Memory", () => {
  it("writes and reads memory via agent", async () => {
    const ctx = setup(new StubClaude([
      toolUseResponse("write_memory", {
        key: "family/todos",
        content: "- Buy milk\n- Walk dog",
      }),
      toolUseResponse("read_memory", { key: "family/todos" }),
      textResponse("Your todos: Buy milk, Walk dog"),
    ]));
    const result = await invokeAgent(ctx.agentDeps, makeParams());

    expect(result).toContain("todos");

    const stored = await readMemory({ redis: ctx.redis }, "family/todos");
    expect(stored).toBe("- Buy milk\n- Walk dog");
  });

  it("lists memory keys with pattern matching", async () => {
    const ctx = setup(new StubClaude([]));

    await ctx.redis.execute(["SET", "memory:family:todos", "items"]);
    await ctx.redis.execute(["SET", "memory:family:shopping", "list"]);
    await ctx.redis.execute(["SET", "memory:members:marius:notes", "note"]);

    ctx.agentDeps.claude = new StubClaude([
      toolUseResponse("list_memory_keys", {
        pattern: "memory:family:*",
      }),
      textResponse("Found 2 family documents."),
    ]);

    const result = await invokeAgent(ctx.agentDeps, makeParams());
    expect(result).toContain("2");

    const keys = await listMemoryKeys(
      { redis: ctx.redis },
      "memory:family:*",
    );
    expect(keys).toContain("memory:family:todos");
    expect(keys).toContain("memory:family:shopping");
    expect(keys).not.toContain("memory:members:marius:notes");
  });

  it("appends to memory document", async () => {
    const ctx = setup(new StubClaude([]));

    await ctx.redis.execute([
      "SET",
      "family/shopping",
      "- Eggs\n",
    ]);

    ctx.agentDeps.claude = new StubClaude([
      toolUseResponse("append_memory", {
        key: "family/shopping",
        content: "- Bread\n",
      }),
      textResponse("Added bread to shopping list."),
    ]);

    const result = await invokeAgent(ctx.agentDeps, makeParams());
    expect(result).toContain("bread");

    const stored = await readMemory(
      { redis: ctx.redis },
      "family/shopping",
    );
    expect(stored).toBe("- Eggs\n- Bread\n");
  });

  it("deletes memory with audit logging", async () => {
    const ctx = setup(new StubClaude([]));

    await ctx.redis.execute([
      "SET",
      "family/old-notes",
      "Some old content",
    ]);

    ctx.agentDeps.claude = new StubClaude([
      toolUseResponse("delete_memory", { key: "family/old-notes" }),
      textResponse("Old notes deleted."),
    ]);

    const result = await invokeAgent(ctx.agentDeps, makeParams());
    expect(result).toContain("deleted");

    const stored = await readMemory(
      { redis: ctx.redis },
      "family/old-notes",
    );
    expect(stored).toBeNull();

    const auditEntries = await getAuditLog({ redis: ctx.redis });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]?.action).toBe("delete_memory");
  });
});

// --- Feature 6: Calendar ---

describe("Feature 6 — Calendar", () => {
  it("calendar event preserves reminders.overrides", async () => {
    const ctx = setup(new StubClaude([
      toolUseResponse("create_event", {
        summary: "Standup",
        start_time: "2026-03-11T09:00:00+13:00",
        end_time: "2026-03-11T09:15:00+13:00",
        reminders: [
          { method: "popup", minutes: 0 },
          { method: "popup", minutes: 10 },
        ],
      }),
      textResponse("Created standup with reminders."),
    ]));
    await invokeAgent(ctx.agentDeps, makeParams());

    const events = await ctx.calendarTwin.listEvents({
      timeMin: "2026-03-01T00:00:00Z",
      timeMax: "2026-03-31T00:00:00Z",
    });
    const standup = events.items.find((e: CalendarEvent) => e.summary === "Standup - Zoe");
    expect(standup).toBeDefined();
    assertReminders(standup);
  });

  it("time filtering works with timezone-aware events", async () => {
    const ctx = setup(new StubClaude([]));

    await ctx.calendarTwin.insertEvent({
      summary: "Past event",
      start: { dateTime: "2026-03-05T10:00:00+13:00" },
      end: { dateTime: "2026-03-05T11:00:00+13:00" },
    });
    await ctx.calendarTwin.insertEvent({
      summary: "Future event",
      start: { dateTime: "2026-03-15T10:00:00+13:00" },
      end: { dateTime: "2026-03-15T11:00:00+13:00" },
    });

    const events = await ctx.calendarTwin.listEvents({
      timeMin: "2026-03-10T12:00:00Z",
      timeMax: "2026-03-20T00:00:00Z",
      singleEvents: true,
      orderBy: "startTime",
    });

    expect(events.items).toHaveLength(1);
    expect(events.items[0]?.summary).toBe("Future event");
  });
});

// --- Feature 7: Audit Log ---

describe("Feature 7 — Audit Log", () => {
  it("write_memory writes to audit log", async () => {
    const ctx = setup(new StubClaude([
      toolUseResponse("write_memory", {
        key: "family/test",
        content: "data",
      }),
      textResponse("Done."),
    ]));
    await invokeAgent(ctx.agentDeps, makeParams());

    const audit = await getAuditLog({ redis: ctx.redis });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("write_memory");
  });

  it("create_event writes to audit log", async () => {
    const ctx = setup(new StubClaude([
      toolUseResponse("create_event", {
        summary: "Test event",
        start_time: "2026-03-12T10:00:00+13:00",
        end_time: "2026-03-12T11:00:00+13:00",
      }),
      textResponse("Event created."),
    ]));
    await invokeAgent(ctx.agentDeps, makeParams());

    const audit = await getAuditLog({ redis: ctx.redis });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("create_event");
  });

  it("delete_memory writes to audit log", async () => {
    const ctx = setup(new StubClaude([]));
    await ctx.redis.execute(["SET", "family/todelete", "data"]);

    ctx.agentDeps.claude = new StubClaude([
      toolUseResponse("delete_memory", { key: "family/todelete" }),
      textResponse("Deleted."),
    ]);
    await invokeAgent(ctx.agentDeps, makeParams());

    const audit = await getAuditLog({ redis: ctx.redis });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("delete_memory");
  });

  it("audit log entries have correct member ID and action", async () => {
    const sarah: FamilyMember = {
      id: "sarah",
      name: "Sarah",
      chatId: 222222,
      timezone: "Pacific/Auckland",
      role: "parent",
      isAdmin: false,
    };

    const ctx = setup(new StubClaude([
      toolUseResponse("write_memory", {
        key: "family/shopping",
        content: "- Apples",
      }),
      toolUseResponse("append_memory", {
        key: "family/shopping",
        content: "\n- Bananas",
      }),
      textResponse("Shopping list updated."),
    ]));
    const result = await invokeAgent(
      ctx.agentDeps,
      makeParams({ member: sarah }),
    );
    expect(result).toContain("Shopping list");

    const auditEntries = await getAuditLog({ redis: ctx.redis });
    expect(auditEntries).toHaveLength(2);

    for (const entry of auditEntries) {
      expect(entry.memberId).toBe("sarah");
    }

    const actions = auditEntries.map((e) => e.action);
    expect(actions).toContain("write_memory");
    expect(actions).toContain("append_memory");
  });
});
