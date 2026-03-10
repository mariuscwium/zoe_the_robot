/**
 * Integration tests for Features 3–7 of the Family Telegram Assistant.
 * Exercises invokeAgent + tool dispatch against digital twins.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RedisTwin } from "../../twins/redis.js";
import { CalendarTwin } from "../../twins/calendar.js";
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

function makeDeps(claude: StubClaude): AgentDeps {
  return {
    claude,
    redis: new RedisTwin(clock),
    calendar: new CalendarTwin(),
    clock,
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
    const claude = new StubClaude([
      toolUseResponse("create_event", {
        summary: "Call accountant",
        start_time: "2026-03-12T10:00:00+13:00",
        end_time: "2026-03-12T10:30:00+13:00",
        reminders: [{ method: "popup", minutes: 0 }],
      }),
      textResponse("Created: Call accountant on Thursday at 10am."),
    ]);
    const deps = makeDeps(claude);
    const result = await invokeAgent(deps, makeParams());

    expect(result).toContain("Call accountant");

    // Verify event was actually created in the calendar twin
    const events = await deps.calendar.listEvents({
      timeMin: "2026-03-01T00:00:00Z",
      timeMax: "2026-03-31T00:00:00Z",
    });
    expect(events.items).toHaveLength(1);
    const event = events.items[0];
    expect(event?.summary).toBe("Call accountant");
    expect(event?.reminders?.useDefault).toBe(false);
    expect(event?.reminders?.overrides).toEqual([
      { method: "popup", minutes: 0 },
    ]);
  });

  it("creates a recurring event", async () => {
    const claude = new StubClaude([
      toolUseResponse("create_recurring_event", {
        summary: "Take medication",
        start_time: "2026-03-10T08:00:00+13:00",
        end_time: "2026-03-10T08:15:00+13:00",
        recurrence: "RRULE:FREQ=DAILY",
      }),
      textResponse("Created daily medication reminder."),
    ]);
    const deps = makeDeps(claude);
    const result = await invokeAgent(deps, makeParams());

    expect(result).toContain("medication");

    const events = await deps.calendar.listEvents({
      timeMin: "2026-03-01T00:00:00Z",
      timeMax: "2026-03-31T00:00:00Z",
    });
    // The base recurring event exists
    const base = events.items.find((e) => e.summary === "Take medication");
    expect(base).toBeDefined();
    expect(base?.recurrence).toEqual(["RRULE:FREQ=DAILY"]);
  });

  it("deletes a calendar event", async () => {
    const deps = makeDeps(
      new StubClaude([]), // placeholder, replaced below
    );

    // Pre-create an event in the twin
    const created = await deps.calendar.insertEvent({
      summary: "Dentist",
      start: { dateTime: "2026-03-13T14:00:00+13:00" },
      end: { dateTime: "2026-03-13T15:00:00+13:00" },
    });

    const claude = new StubClaude([
      toolUseResponse("delete_calendar_event", {
        event_id: created.id,
      }),
      textResponse("Dentist appointment deleted."),
    ]);
    deps.claude = claude;

    const result = await invokeAgent(deps, makeParams());
    expect(result).toContain("deleted");

    // Verify event is gone
    const events = await deps.calendar.listEvents({
      timeMin: "2026-03-01T00:00:00Z",
      timeMax: "2026-03-31T00:00:00Z",
    });
    const dentist = events.items.find((e) => e.summary === "Dentist");
    expect(dentist).toBeUndefined();
  });

  it("returns fallback message when agent loop exceeds 8 tool calls", async () => {
    const looping = toolUseResponse("read_memory", {
      key: "family/todos",
    });
    // 9 responses: the agent should stop after 8 iterations and never reach the 9th
    const ninthResponse = textResponse("This should never be reached");
    const responses = Array.from({ length: 8 }, () => looping);
    responses.push(ninthResponse);
    const claude = new StubClaude(responses);
    const deps = makeDeps(claude);

    const result = await invokeAgent(deps, makeParams());
    expect(result).toContain("thinking too long");
    // Should have called Claude exactly 8 times (the max)
    expect(claude.receivedParams).toHaveLength(8);
  });

  it("mutating tool call triggers audit log entry", async () => {
    const claude = new StubClaude([
      toolUseResponse("write_memory", {
        key: "family/todos",
        content: "- Buy milk",
      }),
      textResponse("Saved your todo."),
    ]);
    const deps = makeDeps(claude);
    await invokeAgent(deps, makeParams());

    const auditEntries = await getAuditLog({ redis: deps.redis });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]?.action).toBe("write_memory");
    expect(auditEntries[0]?.memberId).toBe("marius");
  });
});

// --- Feature 5: Memory ---

describe("Feature 5 — Memory", () => {
  it("writes and reads memory via agent", async () => {
    const claude = new StubClaude([
      toolUseResponse("write_memory", {
        key: "family/todos",
        content: "- Buy milk\n- Walk dog",
      }),
      toolUseResponse("read_memory", { key: "family/todos" }),
      textResponse("Your todos: Buy milk, Walk dog"),
    ]);
    const deps = makeDeps(claude);
    const result = await invokeAgent(deps, makeParams());

    expect(result).toContain("todos");

    // Verify data persisted in Redis twin
    const stored = await readMemory({ redis: deps.redis }, "family/todos");
    expect(stored).toBe("- Buy milk\n- Walk dog");
  });

  it("lists memory keys with pattern matching", async () => {
    const deps = makeDeps(new StubClaude([]));

    // Pre-populate memory
    await deps.redis.execute(["SET", "memory:family:todos", "items"]);
    await deps.redis.execute(["SET", "memory:family:shopping", "list"]);
    await deps.redis.execute(["SET", "memory:members:marius:notes", "note"]);

    const claude = new StubClaude([
      toolUseResponse("list_memory_keys", {
        pattern: "memory:family:*",
      }),
      textResponse("Found 2 family documents."),
    ]);
    deps.claude = claude;

    const result = await invokeAgent(deps, makeParams());
    expect(result).toContain("2");

    // Verify the tool received matching keys
    const keys = await listMemoryKeys(
      { redis: deps.redis },
      "memory:family:*",
    );
    expect(keys).toContain("memory:family:todos");
    expect(keys).toContain("memory:family:shopping");
    expect(keys).not.toContain("memory:members:marius:notes");
  });

  it("appends to memory document", async () => {
    const deps = makeDeps(new StubClaude([]));

    // Pre-populate
    await deps.redis.execute([
      "SET",
      "family/shopping",
      "- Eggs\n",
    ]);

    const claude = new StubClaude([
      toolUseResponse("append_memory", {
        key: "family/shopping",
        content: "- Bread\n",
      }),
      textResponse("Added bread to shopping list."),
    ]);
    deps.claude = claude;

    const result = await invokeAgent(deps, makeParams());
    expect(result).toContain("bread");

    const stored = await readMemory(
      { redis: deps.redis },
      "family/shopping",
    );
    expect(stored).toBe("- Eggs\n- Bread\n");
  });

  it("deletes memory with audit logging", async () => {
    const deps = makeDeps(new StubClaude([]));

    // Pre-populate
    await deps.redis.execute([
      "SET",
      "family/old-notes",
      "Some old content",
    ]);

    const claude = new StubClaude([
      toolUseResponse("delete_memory", { key: "family/old-notes" }),
      textResponse("Old notes deleted."),
    ]);
    deps.claude = claude;

    const result = await invokeAgent(deps, makeParams());
    expect(result).toContain("deleted");

    // Key should be gone
    const stored = await readMemory(
      { redis: deps.redis },
      "family/old-notes",
    );
    expect(stored).toBeNull();

    // Audit log should record the deletion
    const auditEntries = await getAuditLog({ redis: deps.redis });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]?.action).toBe("delete_memory");
  });
});

// --- Feature 6: Calendar ---

describe("Feature 6 — Calendar", () => {
  it("calendar event preserves reminders.overrides", async () => {
    const claude = new StubClaude([
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
    ]);
    const deps = makeDeps(claude);
    await invokeAgent(deps, makeParams());

    const events = await deps.calendar.listEvents({
      timeMin: "2026-03-01T00:00:00Z",
      timeMax: "2026-03-31T00:00:00Z",
    });
    const standup = events.items.find((e) => e.summary === "Standup");
    expect(standup).toBeDefined();
    assertReminders(standup);
  });

  it("time filtering works with timezone-aware events", async () => {
    const deps = makeDeps(new StubClaude([]));

    // Insert events at different times
    await deps.calendar.insertEvent({
      summary: "Past event",
      start: { dateTime: "2026-03-05T10:00:00+13:00" },
      end: { dateTime: "2026-03-05T11:00:00+13:00" },
    });
    await deps.calendar.insertEvent({
      summary: "Future event",
      start: { dateTime: "2026-03-15T10:00:00+13:00" },
      end: { dateTime: "2026-03-15T11:00:00+13:00" },
    });

    // Query with a window that only includes the future event
    const events = await deps.calendar.listEvents({
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
    const claude = new StubClaude([
      toolUseResponse("write_memory", {
        key: "family/test",
        content: "data",
      }),
      textResponse("Done."),
    ]);
    const deps = makeDeps(claude);
    await invokeAgent(deps, makeParams());

    const audit = await getAuditLog({ redis: deps.redis });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("write_memory");
  });

  it("create_event writes to audit log", async () => {
    const claude = new StubClaude([
      toolUseResponse("create_event", {
        summary: "Test event",
        start_time: "2026-03-12T10:00:00+13:00",
        end_time: "2026-03-12T11:00:00+13:00",
      }),
      textResponse("Event created."),
    ]);
    const deps = makeDeps(claude);
    await invokeAgent(deps, makeParams());

    const audit = await getAuditLog({ redis: deps.redis });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("create_event");
  });

  it("delete_memory writes to audit log", async () => {
    const deps = makeDeps(new StubClaude([]));
    await deps.redis.execute(["SET", "family/todelete", "data"]);

    const claude = new StubClaude([
      toolUseResponse("delete_memory", { key: "family/todelete" }),
      textResponse("Deleted."),
    ]);
    deps.claude = claude;
    await invokeAgent(deps, makeParams());

    const audit = await getAuditLog({ redis: deps.redis });
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

    const claude = new StubClaude([
      toolUseResponse("write_memory", {
        key: "family/shopping",
        content: "- Apples",
      }),
      toolUseResponse("append_memory", {
        key: "family/shopping",
        content: "\n- Bananas",
      }),
      textResponse("Shopping list updated."),
    ]);
    const deps = makeDeps(claude);
    const result = await invokeAgent(
      deps,
      makeParams({ member: sarah }),
    );
    expect(result).toContain("Shopping list");

    const auditEntries = await getAuditLog({ redis: deps.redis });
    // append_memory and write_memory are both mutating
    expect(auditEntries).toHaveLength(2);

    // All entries should have Sarah's member ID
    for (const entry of auditEntries) {
      expect(entry.memberId).toBe("sarah");
    }

    // Verify correct actions recorded (LPUSH = newest first)
    const actions = auditEntries.map((e) => e.action);
    expect(actions).toContain("write_memory");
    expect(actions).toContain("append_memory");
  });
});
