/**
 * Constructs production Deps from environment variables.
 * Throws on missing required vars so failures are loud and early.
 */

import type { Deps } from "./deps.js";
import type { DebugConfig, DebugDeps } from "../api/debug.js";
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

let _deps: Deps | null = null;

export function getProdDeps(): Deps {
  if (_deps) return _deps;

  _deps = {
    redis: createRedisClient(
      requireEnv("UPSTASH_REDIS_REST_URL"),
      requireEnv("UPSTASH_REDIS_REST_TOKEN"),
    ),
    telegram: createTelegramClient(requireEnv("TELEGRAM_BOT_TOKEN")),
    calendar: createCalendarClient(
      requireEnv("GOOGLE_CLIENT_ID"),
      requireEnv("GOOGLE_CLIENT_SECRET"),
      requireEnv("GOOGLE_REFRESH_TOKEN"),
      requireEnv("GOOGLE_CALENDAR_ID"),
    ),
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
