/** Telegram webhook handler (POST /api/telegram). */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Deps } from "../lib/deps.js";
import type { FamilyMember } from "../lib/types.js";
import { getMember } from "../lib/registry.js";
import { loadHistory, appendMessage } from "../lib/history.js";
import { sendReply, downloadImage, downloadVoice } from "../lib/telegram.js";
import { appendAudit, appendIncoming } from "../lib/audit.js";
import { invokeAgent } from "../lib/agent.js";
import { runInference } from "../lib/inference.js";
import { getProdDeps, getWebhookConfig } from "../lib/prod-deps.js";

interface WebhookConfig { webhookSecret: string }
interface TelegramPhoto { file_id: string; width: number; height: number }
interface TelegramVoice { file_id: string; duration: number; mime_type?: string }

interface TelegramUpdate {
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    text?: string;
    caption?: string;
    photo?: TelegramPhoto[];
    voice?: TelegramVoice;
  };
}

const ERROR_REPLY = "Sorry, something went wrong. Please try again.";
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export function createWebhookHandler(deps: Deps, config: WebhookConfig) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const secret = req.headers[SECRET_HEADER];
    if (secret !== config.webhookSecret) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await handleUpdate(deps, req.body as TelegramUpdate, res);
  };
}

async function handleUpdate(
  deps: Deps,
  update: TelegramUpdate,
  res: VercelResponse,
): Promise<void> {
  const message = update.message;
  if (message?.chat.type !== "private") {
    res.status(200).json({ ok: true });
    return;
  }
  const chatId = message.chat.id;
  const isDuplicate = await claimMessage(deps, chatId, message.message_id);
  if (isDuplicate) {
    res.status(200).json({ ok: true });
    return;
  }
  const member = await getMember(deps, chatId);
  if (member === null) {
    await appendAudit(deps, {
      timestamp: deps.clock.now().toISOString(),
      memberId: "unknown",
      action: "rejected_unknown_chat",
      detail: JSON.stringify({ chatId }),
    });
    res.status(200).json({ ok: true });
    return;
  }
  try {
    await processMessage(deps, chatId, member, message);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await appendAudit(deps, {
      timestamp: deps.clock.now().toISOString(),
      memberId: member.id,
      action: "processing_error",
      detail: errMsg,
    });
    await sendReply(deps, chatId, ERROR_REPLY);
  }
  res.status(200).json({ ok: true });
}

function resolveHistoryText(
  voiceTranscript: string | null,
  userText: string,
  hasImage: boolean,
): string {
  if (voiceTranscript !== null) return `[Voice] ${voiceTranscript}`;
  if (userText !== "") return userText;
  if (hasImage) return "[Image]";
  return "";
}

function resolveMessageType(message: NonNullable<TelegramUpdate["message"]>): string {
  if (message.voice) return "voice";
  if (message.photo) return "photo";
  return "text";
}

async function processMessage(
  deps: Deps,
  chatId: number,
  member: FamilyMember,
  message: NonNullable<TelegramUpdate["message"]>,
): Promise<void> {
  const imageDataUri = await extractImage(deps, message.photo);
  const voiceTranscript = await extractVoice(deps, message.voice);
  const userText = voiceTranscript !== null
    ? `[Voice message] ${voiceTranscript}`
    : message.text ?? message.caption ?? "";

  const history = await loadHistory(deps, chatId);
  const reply = await invokeAgent(deps, {
    member,
    userMessage: userText,
    imageBase64: imageDataUri ?? undefined,
    conversationHistory: history,
  });
  const now = deps.clock.now().toISOString();
  const historyText = resolveHistoryText(voiceTranscript, userText, imageDataUri !== null);
  if (historyText !== "") {
    await appendMessage(deps, chatId, { role: "user", content: historyText, timestamp: now });
  }
  await appendMessage(deps, chatId, { role: "assistant", content: reply, timestamp: now });
  await logIncoming(deps, member.id, userText, resolveMessageType(message));
  await sendReply(deps, chatId, reply);
  if (userText !== "") {
    await runInferenceSafe(deps, member, userText, reply);
  }
}

async function runInferenceSafe(
  deps: Deps,
  member: FamilyMember,
  userText: string,
  reply: string,
): Promise<void> {
  try {
    await runInference(deps, member, { userMessage: userText, assistantReply: reply });
  } catch {
    // Inference failure is non-critical — don't affect the user
  }
}

async function claimMessage(
  deps: Deps,
  chatId: number,
  messageId: number,
): Promise<boolean> {
  const key = `dedup:${String(chatId)}:${String(messageId)}`;
  const res = await deps.redis.execute(["SETNX", key, "1"]);
  if (res.result === 0) return true;
  await deps.redis.execute(["EXPIRE", key, "300"]);
  return false;
}

async function extractImage(
  deps: Deps,
  photos: TelegramPhoto[] | undefined,
): Promise<string | null> {
  if (!photos || photos.length === 0) return null;
  const largest = photos[photos.length - 1];
  if (!largest) return null;
  return downloadImage(deps, largest.file_id);
}

async function extractVoice(deps: Deps, voice: TelegramVoice | undefined): Promise<string | null> {
  if (!voice) return null;
  const voiceData = await downloadVoice(deps, voice.file_id);
  if (!voiceData) return null;
  try {
    return await deps.transcription.transcribe(voiceData.buffer, voiceData.mimeType);
  } catch {
    return null;
  }
}

async function logIncoming(deps: Deps, memberId: string, text: string, messageType: string): Promise<void> {
  await appendIncoming(deps, { timestamp: deps.clock.now().toISOString(), memberId, messageType, text });
}

let prodHandler: ((req: VercelRequest, res: VercelResponse) => Promise<void>) | null = null;

function getHandler(): (req: VercelRequest, res: VercelResponse) => Promise<void> {
  prodHandler ??= createWebhookHandler(getProdDeps(), getWebhookConfig());
  return prodHandler;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  await getHandler()(req, res);
}
