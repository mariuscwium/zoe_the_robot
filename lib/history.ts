/**
 * Per-member conversation history backed by Redis lists.
 * Key pattern: `conversation:<chatId>`
 */

import type { RedisClient } from "./deps.js";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface HistoryDeps {
  redis: RedisClient;
}

function keyFor(chatId: number): string {
  return `conversation:${String(chatId)}`;
}

function isValidRole(value: unknown): value is "user" | "assistant" {
  return value === "user" || value === "assistant";
}

function isMessageShape(v: unknown): v is ConversationMessage {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    isValidRole(obj.role) &&
    typeof obj.content === "string" &&
    typeof obj.timestamp === "string"
  );
}

function parseMessage(raw: unknown): ConversationMessage | null {
  // Redis client (twin or Upstash SDK) auto-deserializes JSON from lists
  if (isMessageShape(raw)) {
    return { role: raw.role, content: raw.content, timestamp: raw.timestamp };
  }
  return null;
}

export async function loadHistory(
  deps: HistoryDeps,
  chatId: number,
): Promise<ConversationMessage[]> {
  const key = keyFor(chatId);
  const res = await deps.redis.execute(["LRANGE", key, "0", "-1"]);
  if (res.error !== undefined) {
    throw new Error(`Redis error loading history: ${res.error}`);
  }
  if (!Array.isArray(res.result)) {
    return [];
  }
  const messages: ConversationMessage[] = [];
  for (const raw of res.result) {
    const msg = parseMessage(raw);
    if (msg !== null) {
      messages.push(msg);
    }
  }
  return messages;
}

export async function saveHistory(
  deps: HistoryDeps,
  chatId: number,
  messages: ConversationMessage[],
): Promise<void> {
  const key = keyFor(chatId);
  const commands: string[][] = [["DEL", key]];
  if (messages.length > 0) {
    commands.push(["RPUSH", key, ...messages.map((m) => JSON.stringify(m))]);
  }
  const results = await deps.redis.pipeline(commands);
  for (const r of results) {
    if (r.error !== undefined) {
      throw new Error(`Redis error saving history: ${r.error}`);
    }
  }
}

export async function appendMessage(
  deps: HistoryDeps,
  chatId: number,
  message: ConversationMessage,
): Promise<void> {
  const key = keyFor(chatId);
  const res = await deps.redis.execute([
    "RPUSH",
    key,
    JSON.stringify(message),
  ]);
  if (res.error !== undefined) {
    throw new Error(`Redis error appending message: ${res.error}`);
  }
}

export async function trimHistory(
  deps: HistoryDeps,
  chatId: number,
  maxMessages: number,
): Promise<void> {
  const key = keyFor(chatId);
  const start = -maxMessages;
  const res = await deps.redis.execute([
    "LTRIM",
    key,
    String(start),
    "-1",
  ]);
  if (res.error !== undefined) {
    throw new Error(`Redis error trimming history: ${res.error}`);
  }
}
