/**
 * Log token usage from Claude API responses to Redis.
 * Used by both the main agent and the inference agent.
 */

import type { RedisClient, ClaudeMessage } from "./deps.js";

const LOG_KEY = "log:tokens";
const MAX_ENTRIES = 500;

interface TokenLogDeps {
  redis: RedisClient;
}

export async function logTokenUsage(
  deps: TokenLogDeps,
  agent: "zoe" | "inference",
  response: ClaudeMessage,
): Promise<void> {
  if (!response.usage) return;
  const entry = {
    timestamp: new Date().toISOString(),
    agent,
    model: response.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
  await deps.redis.execute(["LPUSH", LOG_KEY, JSON.stringify(entry)]);
  await deps.redis.execute(["LTRIM", LOG_KEY, "0", String(MAX_ENTRIES - 1)]);
}
