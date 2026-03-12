/**
 * Integration tests covering Features 0, 1, and 2 of the Gherkin spec.
 * Exercises the full stack: webhook handler -> registry -> agent -> tools -> twins.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type {
  Deps,
  ClaudeClient,
  ClaudeMessage,
  ClaudeMessageParams,
  ClaudeContentBlock,
  Clock,
} from "../../lib/deps.js";
import type { FamilyMember } from "../../lib/types.js";
import { RedisTwin } from "../../twins/redis.js";
import { TelegramTwin } from "../../twins/telegram.js";
import { CalendarTwin } from "../../twins/calendar.js";
import { CalendarProviderTwin } from "../../twins/calendar-provider.js";
import { createWebhookHandler } from "../../api/telegram.js";
import { upsertMember, getMember } from "../../lib/registry.js";
import { runBootstrap } from "../../scripts/bootstrap.js";

// --- Constants ---

const WEBHOOK_SECRET = "test-secret";
const SECRET_HEADER = "x-telegram-bot-api-secret-token";
const CHAT_ID = 111111;
const FIXED_DATE = new Date("2026-03-10T12:00:00Z");

// --- StubClaude ---

class StubClaude implements ClaudeClient {
  private responses: ClaudeMessage[];
  private callIndex = 0;
  receivedParams: ClaudeMessageParams[] = [];
  invoked = false;

  constructor(responses: ClaudeMessage[]) {
    this.responses = responses;
  }

  createMessage(params: ClaudeMessageParams): Promise<ClaudeMessage> {
    this.invoked = true;
    this.receivedParams.push(params);
    const response = this.responses[this.callIndex++];
    if (!response) throw new Error("No more stub responses");
    return Promise.resolve(response);
  }
}

// --- Response helpers ---

function textResponse(text: string): ClaudeMessage {
  return {
    id: "msg_test",
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
  toolCallId = "call_1",
): ClaudeMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: toolCallId, name: toolName, input }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "tool_use",
  };
}

// --- Mock request/response ---

function createMockReq(
  body: unknown,
  headers: Record<string, string> = {},
  method = "POST",
): VercelRequest {
  return { method, body, headers } as unknown as VercelRequest;
}

function createMockRes(): VercelResponse & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
    end() {
      return res;
    },
  };
  return res as unknown as VercelResponse & { statusCode: number; body: unknown };
}

// --- Update builders ---

let nextMessageId = 1;

function makeUpdate(text: string, chatId = CHAT_ID, chatType = "private") {
  return {
    message: {
      message_id: nextMessageId++,
      chat: { id: chatId, type: chatType },
      text,
    },
  };
}

function makePhotoUpdate(chatId = CHAT_ID, caption?: string) {
  return {
    message: {
      message_id: nextMessageId++,
      chat: { id: chatId, type: "private" },
      text: caption,
      photo: [
        { file_id: "small_id", width: 100, height: 100 },
        { file_id: "large_id", width: 800, height: 600 },
      ],
    },
  };
}

// --- Test context ---

interface TestContext {
  clock: { now(): Date };
  redis: RedisTwin;
  telegram: TelegramTwin;
  calendar: CalendarTwin;
  claude: StubClaude;
  deps: Deps;
  handler: (req: VercelRequest, res: VercelResponse) => Promise<void>;
}

const testMember: FamilyMember = {
  id: "marius",
  name: "Marius",
  chatId: CHAT_ID,
  timezone: "Pacific/Auckland",
  role: "admin",
  isAdmin: true,
};

function setup(claudeResponses: ClaudeMessage[] = [textResponse("OK")]): TestContext {
  const clock: Clock = { now: () => FIXED_DATE };
  const redis = new RedisTwin(clock);
  const telegram = new TelegramTwin();
  const calendarTwin = new CalendarTwin();
  const calendar = new CalendarProviderTwin(calendarTwin);
  const claude = new StubClaude(claudeResponses);
  const deps: Deps = { redis, telegram, calendar, claude, clock };
  const handler = createWebhookHandler(deps, { webhookSecret: WEBHOOK_SECRET });
  return { clock, redis, telegram, calendar: calendarTwin, claude, deps, handler };
}

// ─────────────────────────────────────────────
// FEATURE 0: Family Member Registry & Whitelist
// ─────────────────────────────────────────────

describe("Feature 0 — Registry", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setup();
    nextMessageId = 1;
  });

  it("bootstrap adds member, subsequent messages work", async () => {
    // Run bootstrap to add the member
    await runBootstrap(
      { redis: ctx.redis, telegram: ctx.telegram },
      {
        chatId: CHAT_ID,
        name: "Marius",
        timezone: "Pacific/Auckland",
        webhookUrl: "https://example.com/api/telegram",
        webhookSecret: WEBHOOK_SECRET,
      },
    );

    // Verify member was added to registry
    const member = await getMember(ctx.deps, CHAT_ID);
    expect(member).not.toBeNull();
    expect(member?.name).toBe("Marius");
    expect(member?.chatId).toBe(CHAT_ID);

    // Verify webhook was registered
    const webhook = ctx.telegram.getWebhookConfig();
    expect(webhook).not.toBeNull();
    expect(webhook?.url).toBe("https://example.com/api/telegram");

    // Now send a message — it should be processed normally
    const req = createMockReq(makeUpdate("hello"), { [SECRET_HEADER]: WEBHOOK_SECRET });
    const res = createMockRes();
    await ctx.handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(ctx.claude.invoked).toBe(true);
    expect(ctx.telegram.getOutbox()).toHaveLength(1);
    expect(ctx.telegram.getOutbox()[0]?.text).toBe("OK");

    // Re-running bootstrap is idempotent
    await runBootstrap(
      { redis: ctx.redis, telegram: ctx.telegram },
      {
        chatId: CHAT_ID,
        name: "Marius",
        timezone: "Pacific/Auckland",
        webhookUrl: "https://example.com/api/telegram",
        webhookSecret: WEBHOOK_SECRET,
      },
    );
    const memberAfter = await getMember(ctx.deps, CHAT_ID);
    expect(memberAfter?.name).toBe("Marius");
  });

  it("message from unregistered chat_id returns 200 with no reply", async () => {
    // No member registered — send from unknown chat_id
    const req = createMockReq(makeUpdate("hello", 999999), {
      [SECRET_HEADER]: WEBHOOK_SECRET,
    });
    const res = createMockRes();
    await ctx.handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(ctx.telegram.getOutbox()).toHaveLength(0);
    expect(ctx.claude.invoked).toBe(false);
  });

  it("group chat update returns 200 with no reply, Claude not invoked", async () => {
    // Register the member so we can verify group chat is rejected regardless
    await upsertMember(ctx.deps, testMember);

    const req = createMockReq(makeUpdate("hello", CHAT_ID, "group"), {
      [SECRET_HEADER]: WEBHOOK_SECRET,
    });
    const res = createMockRes();
    await ctx.handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(ctx.telegram.getOutbox()).toHaveLength(0);
    expect(ctx.claude.invoked).toBe(false);
  });
});

// ─────────────────────────────────────────────
// FEATURE 1: Telegram Webhook Ingestion
// ─────────────────────────────────────────────

describe("Feature 1 — Webhook Ingestion", () => {
  it("registered member sends text: agent invoked, reply sent, incoming log appended", async () => {
    const ctx = setup([textResponse("Here is your shopping list.")]);
    await upsertMember(ctx.deps, testMember);

    const req = createMockReq(makeUpdate("what's on the shopping list?"), {
      [SECRET_HEADER]: WEBHOOK_SECRET,
    });
    const res = createMockRes();
    await ctx.handler(req, res);

    // HTTP 200
    expect(res.statusCode).toBe(200);

    // Agent was invoked with the text
    expect(ctx.claude.invoked).toBe(true);
    const params = ctx.claude.receivedParams[0];
    expect(params).toBeDefined();
    const lastMsg = params?.messages[params.messages.length - 1];
    expect(lastMsg?.role).toBe("user");
    expect(lastMsg?.content).toBe("what's on the shopping list?");

    // Reply sent via Telegram
    const outbox = ctx.telegram.getOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.text).toBe("Here is your shopping list.");

    // Incoming log appended (check Redis for log:incoming)
    const logRes = await ctx.redis.execute(["LRANGE", "log:incoming", "0", "-1"]);
    const logs = logRes.result as Record<string, unknown>[];
    expect(logs).toHaveLength(1);
    const entry = logs[0]!;
    expect(entry.memberId).toBe("marius");
    expect(entry.messageType).toBe("text");
    expect(entry.text).toBe("what's on the shopping list?");
  });

  it("registered member sends photo: image downloaded, passed to agent as vision", async () => {
    const ctx = setup([textResponse("I see a birthday party invite.")]);
    await upsertMember(ctx.deps, testMember);

    // Inject a file for the largest photo
    const imageBytes = Buffer.from("fake-jpeg-image-data");
    ctx.telegram.injectFile("large_id", "photos/large.jpg", imageBytes);

    const req = createMockReq(makePhotoUpdate(CHAT_ID, "What is this?"), {
      [SECRET_HEADER]: WEBHOOK_SECRET,
    });
    const res = createMockRes();
    await ctx.handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(ctx.claude.invoked).toBe(true);

    // Verify Claude received image content block
    const params = ctx.claude.receivedParams[0];
    expect(params).toBeDefined();
    if (params === undefined) return;
    const lastMsg = params.messages[params.messages.length - 1];
    expect(lastMsg).toBeDefined();
    if (lastMsg === undefined) return;
    expect(lastMsg.role).toBe("user");
    expect(Array.isArray(lastMsg.content)).toBe(true);

    const blocks = lastMsg.content as ClaudeContentBlock[];
    const imageBlock = blocks.find((b) => b.type === "image");
    expect(imageBlock).toBeDefined();
    if (imageBlock !== undefined) {
      expect((imageBlock.source as Record<string, unknown>).type).toBe("base64");
    }

    const textBlock = blocks.find((b) => b.type === "text");
    expect(textBlock).toBeDefined();

    // Incoming log records photo type
    const logRes = await ctx.redis.execute(["LRANGE", "log:incoming", "0", "-1"]);
    const logs = logRes.result as Record<string, unknown>[];
    expect(logs).toHaveLength(1);
    const photoEntry = logs[0]!;
    expect(photoEntry.messageType).toBe("photo");
  });

  it("photo with no caption sends image block without empty text block", async () => {
    const ctx = setup([textResponse("I see an image.")]);
    await upsertMember(ctx.deps, testMember);

    const imageBytes = Buffer.from("fake-jpeg-no-caption");
    ctx.telegram.injectFile("large_id", "photos/large.jpg", imageBytes);

    const req = createMockReq(makePhotoUpdate(CHAT_ID), {
      [SECRET_HEADER]: WEBHOOK_SECRET,
    });
    const res = createMockRes();
    await ctx.handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(ctx.claude.invoked).toBe(true);

    const params = ctx.claude.receivedParams[0];
    expect(params).toBeDefined();
    if (params === undefined) return;
    const lastMsg = params.messages[params.messages.length - 1];
    expect(lastMsg).toBeDefined();
    if (lastMsg === undefined) return;

    const blocks = lastMsg.content as ClaudeContentBlock[];
    const imageBlock = blocks.find((b) => b.type === "image");
    expect(imageBlock).toBeDefined();

    // No empty text block should be present
    const textBlock = blocks.find((b) => b.type === "text");
    expect(textBlock).toBeUndefined();
  });

  it("webhook secret missing returns 403", async () => {
    const ctx = setup();
    const req = createMockReq(makeUpdate("hello"), {});
    const res = createMockRes();
    await ctx.handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(ctx.claude.invoked).toBe(false);
  });

  it("webhook secret wrong returns 403", async () => {
    const ctx = setup();
    const req = createMockReq(makeUpdate("hello"), {
      [SECRET_HEADER]: "wrong-secret",
    });
    const res = createMockRes();
    await ctx.handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(ctx.claude.invoked).toBe(false);
  });

  it("non-POST method returns 405", async () => {
    const ctx = setup();
    const req = createMockReq({}, {}, "GET");
    const res = createMockRes();
    await ctx.handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(ctx.claude.invoked).toBe(false);
  });
});

// ─────────────────────────────────────────────
// FEATURE 2: Image Ingestion & Autonomous Action
// ─────────────────────────────────────────────

describe("Feature 2 — Image Ingestion & Autonomous Action", () => {
  it("agent receives image and creates a single calendar event via tool_use", async () => {
    const createEventInput = {
      summary: "Birthday Party",
      start_time: "2026-03-14T15:00:00+13:00",
      end_time: "2026-03-14T17:00:00+13:00",
      location: "42 Oak St",
    };

    const ctx = setup([
      // First response: agent calls create_event
      toolUseResponse("create_event", createEventInput),
      // Second response: agent returns final text after tool result
      textResponse("Done! I've added 'Birthday Party' on Saturday at 3pm at 42 Oak St to the calendar."),
    ]);
    await upsertMember(ctx.deps, testMember);

    // Inject a photo
    const imageBytes = Buffer.from("fake-birthday-invite-image");
    ctx.telegram.injectFile("large_id", "photos/invite.jpg", imageBytes);

    const req = createMockReq(makePhotoUpdate(CHAT_ID, ""), {
      [SECRET_HEADER]: WEBHOOK_SECRET,
    });
    const res = createMockRes();
    await ctx.handler(req, res);

    expect(res.statusCode).toBe(200);

    // Agent was invoked twice (tool_use + final text)
    expect(ctx.claude.receivedParams).toHaveLength(2);

    // Second call should include tool_result in messages
    const secondCallMessages = ctx.claude.receivedParams[1]?.messages;
    expect(secondCallMessages).toBeDefined();
    const toolResultMsg = secondCallMessages?.find((m) => {
      if (!Array.isArray(m.content)) return false;
      return m.content.some((b) => b.type === "tool_result");
    });
    expect(toolResultMsg).toBeDefined();

    // Verify the reply was sent
    const outbox = ctx.telegram.getOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.text).toContain("Birthday Party");

    // Verify the calendar event was actually created in the twin
    const events = await ctx.calendar.listEvents({});
    expect(events.items).toHaveLength(1);
    expect(events.items[0]?.summary).toBe("Birthday Party - Zoe");
    expect(events.items[0]?.location).toBe("42 Oak St");
  });

  it("max tool calls reached returns fallback message", async () => {
    // Create 16 tool_use responses that never end — agent hits MAX_ITERATIONS
    const loopingResponses = Array.from({ length: 16 }, (_, i) =>
      toolUseResponse("read_memory", { key: "family/todos" }, `call_${String(i + 1)}`),
    );

    const ctx = setup(loopingResponses);
    await upsertMember(ctx.deps, testMember);

    const req = createMockReq(makeUpdate("do something complex"), {
      [SECRET_HEADER]: WEBHOOK_SECRET,
    });
    const res = createMockRes();
    await ctx.handler(req, res);

    expect(res.statusCode).toBe(200);

    // Agent was called 16 times (max iterations)
    expect(ctx.claude.receivedParams).toHaveLength(16);

    // Fallback message sent to user
    const outbox = ctx.telegram.getOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.text).toContain("thinking too long");
  });
});
