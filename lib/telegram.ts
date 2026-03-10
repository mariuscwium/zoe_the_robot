/**
 * Telegram API helper functions.
 * Used by the webhook handler and bootstrap script.
 */

import type { TelegramClient } from "./deps.js";

const MAX_MESSAGE_LENGTH = 4096;

interface TelegramDeps {
  telegram: TelegramClient;
}

/**
 * Split text into chunks that fit within Telegram's message limit.
 * Splits on newline boundaries when possible.
 */
function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    const slice = remaining.slice(0, MAX_MESSAGE_LENGTH);
    const lastNewline = slice.lastIndexOf("\n");
    const splitAt = lastNewline > 0 ? lastNewline : MAX_MESSAGE_LENGTH;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt === lastNewline ? splitAt + 1 : splitAt);
  }

  return chunks;
}

/**
 * Send a text reply to a Telegram chat.
 * Splits long messages and never throws — errors are logged silently.
 */
export async function sendReply(
  deps: TelegramDeps,
  chatId: number,
  text: string,
): Promise<void> {
  try {
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await deps.telegram.sendMessage(chatId, chunk);
    }
  } catch {
    // Swallow errors — webhook must return 200
  }
}

/**
 * Download an image from Telegram and return it as a base64 data URI.
 * Returns null on any error.
 */
export async function downloadImage(
  deps: TelegramDeps,
  fileId: string,
): Promise<string | null> {
  try {
    const fileResult = await deps.telegram.getFile(fileId);
    if (!fileResult.ok || !fileResult.result?.file_path) {
      return null;
    }

    const buffer = await deps.telegram.downloadFile(fileResult.result.file_path);
    const base64 = buffer.toString("base64");
    return `data:image/jpeg;base64,${base64}`;
  } catch {
    return null;
  }
}

interface WebhookParams {
  url: string;
  secretToken: string;
}

/**
 * Register a Telegram webhook. Returns true on success, false on error.
 */
export async function registerWebhook(
  deps: TelegramDeps,
  params: WebhookParams,
): Promise<boolean> {
  try {
    const result = await deps.telegram.setWebhook({
      url: params.url,
      secret_token: params.secretToken,
      allowed_updates: ["message"],
    });
    return result.ok;
  } catch {
    return false;
  }
}
