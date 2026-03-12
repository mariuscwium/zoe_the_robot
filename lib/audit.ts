/**
 * Audit and incoming message logging backed by Redis lists.
 * Keys: `log:audit` and `log:incoming`.
 */

import type { RedisClient } from "./deps.js";
import type { AuditEntry, IncomingLogEntry } from "./types.js";

const AUDIT_KEY = "log:audit";
const INCOMING_KEY = "log:incoming";
const DEFAULT_LIMIT = 50;

interface AuditDeps {
  redis: RedisClient;
}

export async function appendAudit(
  deps: AuditDeps,
  entry: AuditEntry,
): Promise<void> {
  const res = await deps.redis.execute([
    "LPUSH",
    AUDIT_KEY,
    JSON.stringify(entry),
  ]);
  if (res.error !== undefined) {
    throw new Error(`Redis error appending audit: ${res.error}`);
  }
}

export async function appendIncoming(
  deps: AuditDeps,
  entry: IncomingLogEntry,
): Promise<void> {
  const res = await deps.redis.execute([
    "LPUSH",
    INCOMING_KEY,
    JSON.stringify(entry),
  ]);
  if (res.error !== undefined) {
    throw new Error(`Redis error appending incoming: ${res.error}`);
  }
}

async function fetchLog<T>(
  deps: AuditDeps,
  key: string,
  limit: number,
): Promise<T[]> {
  const res = await deps.redis.execute([
    "LRANGE",
    key,
    "0",
    String(limit - 1),
  ]);
  if (res.error !== undefined) {
    throw new Error(`Redis error reading ${key}: ${res.error}`);
  }
  // Redis client (twin or Upstash SDK) auto-deserializes JSON from lists
  const items = res.result as T[];
  return items;
}

export async function getAuditLog(
  deps: AuditDeps,
  limit: number = DEFAULT_LIMIT,
): Promise<AuditEntry[]> {
  return fetchLog<AuditEntry>(deps, AUDIT_KEY, limit);
}

export async function getIncomingLog(
  deps: AuditDeps,
  limit: number = DEFAULT_LIMIT,
): Promise<IncomingLogEntry[]> {
  return fetchLog<IncomingLogEntry>(deps, INCOMING_KEY, limit);
}
