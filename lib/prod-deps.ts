/**
 * Constructs production Deps from environment variables.
 * Throws on missing required vars so failures are loud and early.
 */

import type { Deps, CalendarProvider, CalendarClient, RedisClient, TranscriptionClient } from "./deps.js";
import type { DebugConfig, DebugDeps } from "../api/debug.js";
import {
  createRedisClient,
  createTelegramClient,
  createCalendarClient,
  createClaudeClient,
  createTranscriptionClient,
  createClock,
} from "./clients.js";
import { loadMemberTokens } from "./oauth.js";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name] ?? undefined;
}

function buildTranscriptionClient(): TranscriptionClient {
  const apiKey = optionalEnv("OPENAI_API_KEY");
  if (!apiKey) {
    return {
      transcribe: () => Promise.reject(new Error("Voice messages aren't configured yet.")),
    };
  }
  return createTranscriptionClient(apiKey);
}

function buildCalendarProvider(redis: RedisClient): CalendarProvider {
  const clientId = optionalEnv("GOOGLE_CLIENT_ID");
  const clientSecret = optionalEnv("GOOGLE_CLIENT_SECRET");
  const calendarId = optionalEnv("GOOGLE_CALENDAR_ID");

  if (!clientId || !clientSecret || !calendarId) {
    return { getClient: () => Promise.resolve(null) };
  }

  return {
    async getClient(memberId: string): Promise<CalendarClient | null> {
      const tokens = await loadMemberTokens({ redis }, memberId);
      if (!tokens) return null;
      return createCalendarClient(clientId, clientSecret, tokens.refreshToken, calendarId);
    },
  };
}

let _deps: Deps | null = null;

export function getProdDeps(): Deps {
  if (_deps) return _deps;

  const redis = createRedisClient(
    requireEnv("UPSTASH_REDIS_REST_URL"),
    requireEnv("UPSTASH_REDIS_REST_TOKEN"),
  );

  _deps = {
    redis,
    telegram: createTelegramClient(requireEnv("TELEGRAM_BOT_TOKEN")),
    calendar: buildCalendarProvider(redis),
    claude: createClaudeClient(requireEnv("ANTHROPIC_API_KEY")),
    transcription: buildTranscriptionClient(),
    clock: createClock(),
  };

  return _deps;
}

export function getWebhookConfig(): { webhookSecret: string } {
  return { webhookSecret: requireEnv("TELEGRAM_WEBHOOK_SECRET") };
}

export function getDebugDeps(): DebugDeps {
  const deps = getProdDeps();
  return { redis: deps.redis, clock: deps.clock };
}

export function getDebugConfig(): DebugConfig {
  return {
    debugKey: requireEnv("DEBUG_PATH"),
    passwordHash: requireEnv("DEBUG_PASSWORD_HASH"),
    jwtSecret: requireEnv("DEBUG_JWT_SECRET"),
  };
}
