/**
 * Constructs production Deps from environment variables.
 * Throws on missing required vars so failures are loud and early.
 */

import type { Deps } from "./deps.js";
import type { DebugConfig, DebugDeps } from "../api/debug.js";
import type { CalendarClient } from "./deps.js";
import {
  createRedisClient,
  createTelegramClient,
  createCalendarClient,
  createClaudeClient,
  createClock,
} from "./clients.js";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

function buildCalendarClient(): CalendarClient {
  const clientId = optionalEnv("GOOGLE_CLIENT_ID");
  const clientSecret = optionalEnv("GOOGLE_CLIENT_SECRET");
  const refreshToken = optionalEnv("GOOGLE_REFRESH_TOKEN");
  const calendarId = optionalEnv("GOOGLE_CALENDAR_ID");

  if (clientId && clientSecret && refreshToken && calendarId) {
    return createCalendarClient(clientId, clientSecret, refreshToken, calendarId);
  }

  const stub = (): never => {
    throw new Error("Google Calendar not configured — set GOOGLE_* env vars");
  };
  return {
    listEvents: stub,
    insertEvent: stub,
    getEvent: stub,
    deleteEvent: stub,
  };
}

let _deps: Deps | null = null;

export function getProdDeps(): Deps {
  if (_deps) return _deps;

  _deps = {
    redis: createRedisClient(
      requireEnv("UPSTASH_REDIS_REST_URL"),
      requireEnv("UPSTASH_REDIS_REST_TOKEN"),
    ),
    telegram: createTelegramClient(requireEnv("TELEGRAM_BOT_TOKEN")),
    calendar: buildCalendarClient(),
    claude: createClaudeClient(requireEnv("ANTHROPIC_API_KEY")),
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
