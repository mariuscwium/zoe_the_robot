import { describe, it, expect, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Deps, ClaudeClient, ClaudeMessage, ClaudeMessageParams } from "../lib/deps.js";
import { RedisTwin } from "../twins/redis.js";
import { TelegramTwin } from "../twins/telegram.js";
import { CalendarTwin } from "../twins/calendar.js";
import { CalendarProviderTwin } from "../twins/calendar-provider.js";
import { TranscriptionTwin } from "../twins/transcription.js";
import { createNotionTwin } from "../twins/notion.js";
import { upsertMember } from "../lib/registry.js";
import type { FamilyMember } from "../lib/types.js";
import { createWebhookHandler } from "./telegram.js";

const WEBHOOK_SECRET = "test-secret-token";
const CHAT_ID = 111111;
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

class StubClaude implements ClaudeClient {
  lastParams: ClaudeMessageParams | null = null;
  allParams: ClaudeMessageParams[] = [];

  createMessage(params: ClaudeMessageParams): Promise<ClaudeMessage> {
    this.lastParams = params;
    this.allParams.push(params);
    return Promise.resolve({
      id: "msg_stub",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello from the assistant!" }],
      model: "claude-sonnet-4-20250514",
      stop_reason: "end_turn",
    });
  }
}

function makeMember(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: "marius",
    name: "Marius",
    chatId: CHAT_ID,
    timezone: "Pacific/Auckland",
    role: "parent",
    isAdmin: true,
    ...overrides,
  };
}

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
    status(code: number) { res.statusCode = code; return res; },
    json(data: unknown) { res.body = data; return res; },
    end() { return res; },
  };
  return res as unknown as VercelResponse & { statusCode: number; body: unknown };
}

let nextMessageId = 1;

function makeUpdate(text: string, chatType = "private") {
  return {
    message: {
      message_id: nextMessageId++,
      chat: { id: CHAT_ID, type: chatType },
      text,
    },
  };
}

function makePhotoUpdate() {
  return {
    message: {
      message_id: nextMessageId++,
      chat: { id: CHAT_ID, type: "private" },
      text: "What is this?",
      photo: [
        { file_id: "small_id", width: 100, height: 100 },
        { file_id: "large_id", width: 800, height: 600 },
      ],
    },
  };
}

interface TestContext {
  redis: RedisTwin;
  telegram: TelegramTwin;
  claude: StubClaude;
  deps: Deps;
  handler: (req: VercelRequest, res: VercelResponse) => Promise<void>;
}

function setup(): TestContext {
  const clock = { now: () => new Date("2026-03-10T12:00:00Z") };
  const redis = new RedisTwin(clock);
  const telegram = new TelegramTwin();
  const calendar = new CalendarProviderTwin(new CalendarTwin());
  const claude = new StubClaude();
  const transcription = new TranscriptionTwin();
  const deps: Deps = { redis, telegram, calendar, claude, transcription, clock, notion: createNotionTwin().client };
  const handler = createWebhookHandler(deps, { webhookSecret: WEBHOOK_SECRET });
  return { redis, telegram, claude, deps, handler };
}

describe("POST /api/telegram", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setup();
    nextMessageId = 1;
  });

  it("returns 405 for non-POST requests", async () => {
    const req = createMockReq({}, {}, "GET");
    const res = createMockRes();
    await ctx.handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it("returns 403 when secret token header is missing", async () => {
    const req = createMockReq(makeUpdate("hello"), {});
    const res = createMockRes();
    await ctx.handler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when secret token is wrong", async () => {
    const headers = { [SECRET_HEADER]: "wrong-secret" };
    const req = createMockReq(makeUpdate("hello"), headers);
    const res = createMockRes();
    await ctx.handler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it("returns 200 silently for non-private chat", async () => {
    await upsertMember(ctx.deps, makeMember());
    const headers = { [SECRET_HEADER]: WEBHOOK_SECRET };
    const req = createMockReq(makeUpdate("hello", "group"), headers);
    const res = createMockRes();
    await ctx.handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(ctx.telegram.getOutbox()).toHaveLength(0);
  });

  it("returns 200 silently for unknown chat_id", async () => {
    const headers = { [SECRET_HEADER]: WEBHOOK_SECRET };
    const update = {
      message: { chat: { id: 999999, type: "private" }, text: "hello" },
    };
    const req = createMockReq(update, headers);
    const res = createMockRes();
    await ctx.handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(ctx.telegram.getOutbox()).toHaveLength(0);
  });

  it("invokes agent and sends reply for valid message", async () => {
    await upsertMember(ctx.deps, makeMember());
    const headers = { [SECRET_HEADER]: WEBHOOK_SECRET };
    const req = createMockReq(makeUpdate("Hi there"), headers);
    const res = createMockRes();
    await ctx.handler(req, res);
    expect(res.statusCode).toBe(200);
    const outbox = ctx.telegram.getOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.text).toBe("Hello from the assistant!");
    expect(ctx.claude.lastParams).not.toBeNull();
  });

  it("downloads largest photo and passes to agent", async () => {
    await upsertMember(ctx.deps, makeMember());
    const imageBytes = Buffer.from("fake-image-data");
    ctx.telegram.injectFile("large_id", "photos/large.jpg", imageBytes);
    const headers = { [SECRET_HEADER]: WEBHOOK_SECRET };
    const req = createMockReq(makePhotoUpdate(), headers);
    const res = createMockRes();
    await ctx.handler(req, res);
    expect(res.statusCode).toBe(200);
    const agentParams = ctx.claude.allParams[0];
    expect(agentParams).toBeDefined();
    const userMsg = agentParams?.messages.at(-1);
    expect(userMsg?.role).toBe("user");
    const content = userMsg?.content;
    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      const imageBlock = content.find(
        (b: Record<string, unknown>) => b.type === "image",
      );
      expect(imageBlock).toBeDefined();
    }
  });

  it("deduplicates retried webhook with same message_id", async () => {
    await upsertMember(ctx.deps, makeMember());
    const headers = { [SECRET_HEADER]: WEBHOOK_SECRET };
    const update = makeUpdate("Hello");
    const req1 = createMockReq(update, headers);
    const req2 = createMockReq(update, headers);
    const res1 = createMockRes();
    const res2 = createMockRes();
    await ctx.handler(req1, res1);
    await ctx.handler(req2, res2);
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(ctx.telegram.getOutbox()).toHaveLength(1);
  });
});
