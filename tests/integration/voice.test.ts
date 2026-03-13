/**
 * Integration tests for voice message support.
 * Exercises: webhook → downloadVoice → transcription → agent → reply.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type {
  Deps,
  ClaudeClient,
  ClaudeMessage,
  ClaudeMessageParams,
  Clock,
} from "../../lib/deps.js";
import type { FamilyMember } from "../../lib/types.js";
import { RedisTwin } from "../../twins/redis.js";
import { TelegramTwin } from "../../twins/telegram.js";
import { CalendarTwin } from "../../twins/calendar.js";
import { CalendarProviderTwin } from "../../twins/calendar-provider.js";
import { TranscriptionTwin } from "../../twins/transcription.js";
import { createWebhookHandler } from "../../api/telegram.js";
import { upsertMember } from "../../lib/registry.js";
import { loadHistory } from "../../lib/history.js";
import { getIncomingLog } from "../../lib/audit.js";

// --- Constants ---

const WEBHOOK_SECRET = "test-secret";
const SECRET_HEADER = "x-telegram-bot-api-secret-token";
const CHAT_ID = 111111;
const FIXED_DATE = new Date("2026-03-10T12:00:00Z");

// --- StubClaude ---

class StubClaude implements ClaudeClient {
  receivedParams: ClaudeMessageParams[] = [];

  createMessage(params: ClaudeMessageParams): Promise<ClaudeMessage> {
    this.receivedParams.push(params);
    return Promise.resolve({
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Got your voice message!" }],
      model: "claude-sonnet-4-20250514",
      stop_reason: "end_turn",
    });
  }
}

// --- Mock request/response ---

function createMockReq(
  body: unknown,
  headers: Record<string, string> = {},
): VercelRequest {
  return { method: "POST", body, headers } as unknown as VercelRequest;
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

// --- Update builders ---

let nextMessageId = 1;

function makeVoiceUpdate(chatId = CHAT_ID) {
  return {
    message: {
      message_id: nextMessageId++,
      chat: { id: chatId, type: "private" },
      voice: {
        file_id: "voice_file_id",
        duration: 5,
        mime_type: "audio/ogg",
      },
    },
  };
}

// --- Test context ---

interface TestContext {
  redis: RedisTwin;
  telegram: TelegramTwin;
  claude: StubClaude;
  transcription: TranscriptionTwin;
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

function setup(): TestContext {
  const clock: Clock = { now: () => FIXED_DATE };
  const redis = new RedisTwin(clock);
  const telegram = new TelegramTwin();
  const calendar = new CalendarProviderTwin(new CalendarTwin());
  const claude = new StubClaude();
  const transcription = new TranscriptionTwin("Pick up groceries on the way home");
  const deps: Deps = { redis, telegram, calendar, claude, transcription, clock };
  const handler = createWebhookHandler(deps, { webhookSecret: WEBHOOK_SECRET });
  return { redis, telegram, claude, transcription, deps, handler };
}

// --- Tests ---

describe("Voice message support", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = setup();
    nextMessageId = 1;
    await upsertMember(ctx.deps, testMember);
  });

  it("transcribes voice and passes text with [Voice message] prefix to agent", async () => {
    ctx.telegram.injectFile("voice_file_id", "voice/file_0.oga", Buffer.from("fake-ogg-data"));
    const headers = { [SECRET_HEADER]: WEBHOOK_SECRET };
    const req = createMockReq(makeVoiceUpdate(), headers);
    const res = createMockRes();

    await ctx.handler(req, res);

    expect(res.statusCode).toBe(200);
    const outbox = ctx.telegram.getOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.text).toBe("Got your voice message!");

    // Verify agent received the transcript with prefix
    const agentParams = ctx.claude.receivedParams[0];
    expect(agentParams).toBeDefined();
    const userMsg = agentParams?.messages.at(-1);
    expect(userMsg?.role).toBe("user");
    const content = userMsg?.content;
    expect(typeof content === "string" ? content : "").toContain(
      "[Voice message] Pick up groceries on the way home",
    );

    // Verify transcription twin was called with correct data
    const calls = ctx.transcription.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.mimeType).toBe("audio/ogg");
  });

  it("falls back gracefully when transcription fails", async () => {
    ctx.telegram.injectFile("voice_file_id", "voice/file_0.oga", Buffer.from("fake-ogg-data"));
    ctx.transcription.setFail(true);

    const headers = { [SECRET_HEADER]: WEBHOOK_SECRET };
    const req = createMockReq(makeVoiceUpdate(), headers);
    const res = createMockRes();

    await ctx.handler(req, res);

    expect(res.statusCode).toBe(200);
    // Voice extraction returns null on failure, so no message is sent to agent
    // and no reply is produced (no text, no image, no voice transcript)
    const outbox = ctx.telegram.getOutbox();
    // Agent still invoked with empty message
    expect(outbox).toHaveLength(1);
  });

  it("logs voice message with messageType 'voice'", async () => {
    ctx.telegram.injectFile("voice_file_id", "voice/file_0.oga", Buffer.from("fake-ogg-data"));
    const headers = { [SECRET_HEADER]: WEBHOOK_SECRET };
    const req = createMockReq(makeVoiceUpdate(), headers);
    const res = createMockRes();

    await ctx.handler(req, res);

    const logs = await getIncomingLog(ctx.deps);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.messageType).toBe("voice");
  });

  it("stores [Voice] <transcript> in history, not raw audio", async () => {
    ctx.telegram.injectFile("voice_file_id", "voice/file_0.oga", Buffer.from("fake-ogg-data"));
    const headers = { [SECRET_HEADER]: WEBHOOK_SECRET };
    const req = createMockReq(makeVoiceUpdate(), headers);
    const res = createMockRes();

    await ctx.handler(req, res);

    const history = await loadHistory(ctx.deps, CHAT_ID);
    const userEntry = history.find((h) => h.role === "user");
    expect(userEntry?.content).toBe("[Voice] Pick up groceries on the way home");
  });

  it("handles missing voice file gracefully", async () => {
    // Don't inject the file — download will fail
    const headers = { [SECRET_HEADER]: WEBHOOK_SECRET };
    const req = createMockReq(makeVoiceUpdate(), headers);
    const res = createMockRes();

    await ctx.handler(req, res);

    expect(res.statusCode).toBe(200);
    // No transcription call since download failed
    expect(ctx.transcription.getCalls()).toHaveLength(0);
  });
});
