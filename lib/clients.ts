/**
 * Production implementations of the dependency interfaces.
 * Each client wraps a real external service using HTTP or SDK calls.
 */

import { Redis } from "@upstash/redis";
import Anthropic from "@anthropic-ai/sdk";
import type {
  RedisClient,
  RedisResult,
  TelegramClient,
  TelegramResult,
  TelegramMessage,
  TelegramFile,
  SetWebhookParams,
  CalendarClient,
  CalendarEvent,
  CalendarEventInput,
  CalendarEventList,
  ListEventsParams,
  ClaudeClient,
  ClaudeMessage,
  ClaudeMessageParams,
  Clock,
} from "./deps.js";

// --- Redis (Upstash REST) ---

type RedisMethod = (...args: string[]) => Promise<unknown>;
type PipelineMethod = (...args: string[]) => unknown;

export function createRedisClient(url: string, token: string): RedisClient {
  const redis = new Redis({ url, token });

  return {
    async execute(command: string[]): Promise<RedisResult> {
      try {
        const [cmd, ...args] = command;
        if (!cmd) return { result: null, error: "Empty command" };
        const method = (redis as unknown as Record<string, RedisMethod>)[cmd.toLowerCase()];
        if (!method) return { result: null, error: `Unknown command: ${cmd}` };
        const result = await method(...args);
        return { result };
      } catch (err) {
        return { result: null, error: String(err) };
      }
    },

    async pipeline(commands: string[][]): Promise<RedisResult[]> {
      const p = redis.pipeline();
      for (const [cmd, ...args] of commands) {
        if (!cmd) continue;
        const method = (p as unknown as Record<string, PipelineMethod>)[cmd.toLowerCase()];
        if (method) method(...args);
      }
      const results = await p.exec();
      return results.map((r) => ({ result: r }));
    },
  };
}

// --- Telegram Bot API (native fetch) ---

export function createTelegramClient(botToken: string): TelegramClient {
  const base = `https://api.telegram.org/bot${botToken}`;
  const fileBase = `https://api.telegram.org/file/bot${botToken}`;

  async function call<T>(method: string, body: Record<string, unknown>): Promise<TelegramResult<T>> {
    const res = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as TelegramResult<T>;
  }

  return {
    sendMessage(chatId: number, text: string): Promise<TelegramResult<TelegramMessage>> {
      return call<TelegramMessage>("sendMessage", { chat_id: chatId, text });
    },

    getFile(fileId: string): Promise<TelegramResult<TelegramFile>> {
      return call<TelegramFile>("getFile", { file_id: fileId });
    },

    async downloadFile(filePath: string): Promise<Buffer> {
      const res = await fetch(`${fileBase}/${filePath}`);
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    },

    setWebhook(params: SetWebhookParams): Promise<TelegramResult<boolean>> {
      return call<boolean>("setWebhook", params as unknown as Record<string, unknown>);
    },
  };
}

// --- Google Calendar API v3 (native fetch + OAuth2 refresh) ---

interface GoogleTokenCache {
  accessToken: string;
  expiresAt: number;
}

async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  return (await res.json()) as { access_token: string; expires_in: number };
}

async function calFetch<T>(
  calBase: string,
  path: string,
  tokenGetter: () => Promise<string>,
  init?: RequestInit,
): Promise<T> {
  const token = await tokenGetter();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (init?.headers) {
    Object.assign(headers, init.headers);
  }
  const res = await fetch(`${calBase}${path}`, { ...init, headers });
  if (init?.method === "DELETE") return undefined as T;
  return (await res.json()) as T;
}

export function createCalendarClient(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  calendarId: string,
): CalendarClient {
  let tokenCache: GoogleTokenCache | null = null;
  const calBase = "https://www.googleapis.com/calendar/v3";
  const encodedCal = encodeURIComponent(calendarId);

  async function getAccessToken(): Promise<string> {
    if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
      return tokenCache.accessToken;
    }
    const data = await refreshAccessToken(clientId, clientSecret, refreshToken);
    tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return tokenCache.accessToken;
  }

  return {
    listEvents(params: ListEventsParams): Promise<CalendarEventList> {
      const qs = new URLSearchParams();
      if (params.timeMin) qs.set("timeMin", params.timeMin);
      if (params.timeMax) qs.set("timeMax", params.timeMax);
      if (params.singleEvents) qs.set("singleEvents", "true");
      if (params.orderBy) qs.set("orderBy", params.orderBy);
      if (params.maxResults) qs.set("maxResults", String(params.maxResults));
      if (params.q) qs.set("q", params.q);
      return calFetch<CalendarEventList>(calBase, `/calendars/${encodedCal}/events?${qs.toString()}`, getAccessToken);
    },

    insertEvent(event: CalendarEventInput): Promise<CalendarEvent> {
      return calFetch<CalendarEvent>(calBase, `/calendars/${encodedCal}/events`, getAccessToken, {
        method: "POST",
        body: JSON.stringify(event),
      });
    },

    getEvent(eventId: string): Promise<CalendarEvent> {
      return calFetch<CalendarEvent>(calBase, `/calendars/${encodedCal}/events/${encodeURIComponent(eventId)}`, getAccessToken);
    },

    async deleteEvent(eventId: string): Promise<void> {
      await calFetch<undefined>(calBase, `/calendars/${encodedCal}/events/${encodeURIComponent(eventId)}`, getAccessToken, {
        method: "DELETE",
      });
    },
  };
}

// --- Claude (Anthropic SDK) ---

export function createClaudeClient(apiKey: string): ClaudeClient {
  const client = new Anthropic({ apiKey });

  return {
    async createMessage(params: ClaudeMessageParams): Promise<ClaudeMessage> {
      const response = await client.messages.create({
        model: params.model,
        max_tokens: params.max_tokens,
        system: params.system,
        messages: params.messages as Anthropic.MessageParam[],
        tools: params.tools as Anthropic.Tool[],
      });
      return response as unknown as ClaudeMessage;
    },
  };
}

// --- Clock ---

export function createClock(): Clock {
  return { now: () => new Date() };
}
