/**
 * Shared and personal memory documents backed by Redis strings.
 * Key patterns: `memory:family:*` (shared), `memory:members:<memberId>:*` (personal)
 *
 * Memory docs are markdown strings stored as plain Redis string values.
 * No JSON wrapping. Never generate or imply public URLs for memory keys.
 */

import type { RedisClient } from "./deps.js";

interface MemoryDeps {
  redis: RedisClient;
}

export async function readMemory(
  deps: MemoryDeps,
  key: string,
): Promise<string | null> {
  const res = await deps.redis.execute(["GET", key]);
  if (res.error !== undefined) {
    throw new Error(`Redis error reading memory: ${res.error}`);
  }
  if (res.result === null || res.result === undefined) {
    return null;
  }
  return res.result as string;
}

export async function writeMemory(
  deps: MemoryDeps,
  key: string,
  content: string,
): Promise<void> {
  const res = await deps.redis.execute(["SET", key, content]);
  if (res.error !== undefined) {
    throw new Error(`Redis error writing memory: ${res.error}`);
  }
}

export async function deleteMemory(
  deps: MemoryDeps,
  key: string,
): Promise<void> {
  const res = await deps.redis.execute(["DEL", key]);
  if (res.error !== undefined) {
    throw new Error(`Redis error deleting memory: ${res.error}`);
  }
}

export async function listMemoryKeys(
  deps: MemoryDeps,
  pattern: string,
): Promise<string[]> {
  const res = await deps.redis.execute(["KEYS", pattern]);
  if (res.error !== undefined) {
    throw new Error(`Redis error listing memory keys: ${res.error}`);
  }
  const keys = (res.result as string[]) ?? [];
  return keys.sort();
}

export async function appendToMemory(
  deps: MemoryDeps,
  key: string,
  content: string,
): Promise<void> {
  const res = await deps.redis.execute(["APPEND", key, content]);
  if (res.error !== undefined) {
    throw new Error(`Redis error appending to memory: ${res.error}`);
  }
}
