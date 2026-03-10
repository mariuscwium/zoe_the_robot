/**
 * Key management command handlers for the Redis twin.
 */

import type { RedisResult } from "../lib/deps.js";
import type { StoreEntry } from "./redis-types.js";
import { ok, err, isExpired } from "./redis-types.js";

export function handleDel(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  let count = 0;
  for (const key of args) {
    const entry = store.get(key);
    if (entry !== undefined && !isExpired(entry, nowMs)) {
      count++;
    }
    store.delete(key);
  }
  return ok(count);
}

export function handleExists(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  let count = 0;
  for (const key of args) {
    const entry = store.get(key);
    if (entry !== undefined && !isExpired(entry, nowMs)) {
      count++;
    } else if (entry !== undefined && isExpired(entry, nowMs)) {
      store.delete(key);
    }
  }
  return ok(count);
}

export function handleKeys(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const pattern = args[0] ?? "*";
  const regex = patternToRegex(pattern);
  const result: string[] = [];
  for (const [key, entry] of store) {
    if (isExpired(entry, nowMs)) {
      store.delete(key);
      continue;
    }
    if (regex.test(key)) result.push(key);
  }
  return ok(result);
}

interface ScanParams {
  cursor: number;
  pattern: string;
  count: number;
}

function parseScanArgs(args: string[]): ScanParams {
  let pattern = "*";
  let count = 10;
  const cursor = parseInt(args[0] ?? "0", 10);

  for (let i = 1; i < args.length; i++) {
    const flag = args[i]?.toUpperCase();
    const next = args[i + 1];
    if (flag === "MATCH" && next !== undefined) {
      pattern = next;
      i++;
    } else if (flag === "COUNT" && next !== undefined) {
      count = parseInt(next, 10);
      i++;
    }
  }
  return { cursor, pattern, count };
}

export function handleScan(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const { cursor, pattern, count } = parseScanArgs(args);
  const regex = patternToRegex(pattern);
  const allKeys = collectMatchingKeys(store, regex, nowMs);

  const start = cursor;
  const end = Math.min(start + count, allKeys.length);
  const page = allKeys.slice(start, end);
  const nextCursor = end >= allKeys.length ? 0 : end;
  return ok([String(nextCursor), page]);
}

function collectMatchingKeys(
  store: Map<string, StoreEntry>,
  regex: RegExp,
  nowMs: number,
): string[] {
  const result: string[] = [];
  for (const [key, entry] of store) {
    if (isExpired(entry, nowMs)) {
      store.delete(key);
      continue;
    }
    if (regex.test(key)) result.push(key);
  }
  return result;
}

export function handleExpire(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const [key, secondsStr] = args;
  if (key === undefined || secondsStr === undefined) {
    return err("ERR wrong number of arguments for 'expire' command");
  }
  const entry = store.get(key);
  if (entry === undefined || isExpired(entry, nowMs)) return ok(0);
  entry.expiresAt = nowMs + parseInt(secondsStr, 10) * 1000;
  return ok(1);
}

export function handleTtl(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const key = args[0];
  if (key === undefined) return err("ERR wrong number of arguments for 'ttl' command");
  const entry = store.get(key);
  if (entry === undefined || isExpired(entry, nowMs)) return ok(-2);
  if (entry.expiresAt === undefined) return ok(-1);
  return ok(Math.ceil((entry.expiresAt - nowMs) / 1000));
}

export function handlePttl(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const key = args[0];
  if (key === undefined) return err("ERR wrong number of arguments for 'pttl' command");
  const entry = store.get(key);
  if (entry === undefined || isExpired(entry, nowMs)) return ok(-2);
  if (entry.expiresAt === undefined) return ok(-1);
  return ok(entry.expiresAt - nowMs);
}

export function handlePersist(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const key = args[0];
  if (key === undefined) return err("ERR wrong number of arguments for 'persist' command");
  const entry = store.get(key);
  if (entry === undefined || isExpired(entry, nowMs)) return ok(0);
  if (entry.expiresAt === undefined) return ok(0);
  entry.expiresAt = undefined;
  return ok(1);
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${regexStr}$`);
}
