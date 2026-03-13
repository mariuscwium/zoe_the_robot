/**
 * Log inference agent runs to Redis for debugging.
 */

import type { RedisClient } from "./deps.js";
import type { MemoryWrite } from "./inference.js";

const LOG_KEY = "log:inference";
const MAX_ENTRIES = 500;

interface InferenceLogDeps {
  redis: RedisClient;
}

export async function logInferenceRun(
  deps: InferenceLogDeps,
  memberId: string,
  keysLoaded: string[],
  writes: MemoryWrite[],
): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(),
    memberId,
    keysLoaded,
    writes: writes.map((w) => ({ key: w.key, contentLength: w.content.length })),
    skipped: writes.length === 0,
  };
  await deps.redis.execute(["LPUSH", LOG_KEY, JSON.stringify(entry)]);
  await deps.redis.execute(["LTRIM", LOG_KEY, "0", String(MAX_ENTRIES - 1)]);
}
