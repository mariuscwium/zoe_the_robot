/**
 * Digital twin for the Telegram Bot API.
 * Stateful in-memory behavioral clone implementing TelegramClient.
 */

import type {
  TelegramClient,
  TelegramMessage,
  TelegramFile,
  TelegramResult,
  SetWebhookParams,
} from "../lib/deps.js";

interface FileEntry {
  filePath: string;
  bytes: Buffer;
}

interface WebhookConfig {
  url: string;
  secretToken?: string;
  allowedUpdates?: string[];
}

const PRIVATE_CHAT_TYPE = "private";

function makeMessage(
  messageId: number,
  chatId: number,
  text: string,
): TelegramMessage {
  return {
    message_id: messageId,
    chat: { id: chatId, type: PRIVATE_CHAT_TYPE },
    date: Math.floor(Date.now() / 1000),
    text,
  };
}

function errorResult<T>(
  code: number,
  description: string,
): Promise<TelegramResult<T>> {
  return Promise.resolve({ ok: false as const, error_code: code, description });
}

export class TelegramTwin implements TelegramClient {
  private outbox: TelegramMessage[] = [];
  private nextMessageId = 1;
  private files = new Map<string, FileEntry>();
  private filePathIndex = new Map<string, FileEntry>();
  private webhook: WebhookConfig | null = null;

  sendMessage(
    chatId: number,
    text: string,
  ): Promise<TelegramResult<TelegramMessage>> {
    if (chatId === 0) {
      return errorResult(400, "Bad Request: chat_id is required");
    }
    if (text === "") {
      return errorResult(400, "Bad Request: text is required");
    }
    const msg = makeMessage(this.nextMessageId++, chatId, text);
    this.outbox.push(msg);
    return Promise.resolve({ ok: true, result: msg });
  }

  getFile(fileId: string): Promise<TelegramResult<TelegramFile>> {
    if (fileId === "") {
      return errorResult(400, "Bad Request: file_id is required");
    }
    const entry = this.files.get(fileId);
    if (entry === undefined) {
      return errorResult(400, "Bad Request: file not found");
    }
    const result: TelegramFile = {
      file_id: fileId,
      file_unique_id: `uniq_${fileId}`,
      file_size: entry.bytes.length,
      file_path: entry.filePath,
    };
    return Promise.resolve({ ok: true, result });
  }

  downloadFile(filePath: string): Promise<Buffer> {
    const entry = this.filePathIndex.get(filePath);
    if (entry === undefined) {
      return Promise.reject(new Error(`File not found: ${filePath}`));
    }
    return Promise.resolve(entry.bytes);
  }

  setWebhook(params: SetWebhookParams): Promise<TelegramResult<boolean>> {
    if (params.url === "") {
      return errorResult(400, "Bad Request: url is required");
    }
    this.webhook = {
      url: params.url,
      secretToken: params.secret_token,
      allowedUpdates: params.allowed_updates,
    };
    return Promise.resolve({ ok: true, result: true });
  }

  // --- Test helpers ---

  injectFile(fileId: string, filePath: string, bytes: Buffer): void {
    const entry: FileEntry = { filePath, bytes };
    this.files.set(fileId, entry);
    this.filePathIndex.set(filePath, entry);
  }

  getOutbox(): TelegramMessage[] {
    return [...this.outbox];
  }

  clearOutbox(): void {
    this.outbox = [];
  }

  getWebhookConfig(): WebhookConfig | null {
    return this.webhook ? { ...this.webhook } : null;
  }
}
