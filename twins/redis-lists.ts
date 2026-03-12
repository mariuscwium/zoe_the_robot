/**
 * List command handlers for the Redis twin.
 */

import type { RedisResult } from "../lib/deps.js";
import type { StoreEntry } from "./redis-types.js";
import { ok, err, getList, isExpired, autoDeserialize, WRONG_TYPE_MSG } from "./redis-types.js";

export function handleLpush(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const key = args[0];
  if (key === undefined || args.length < 2) {
    return err("ERR wrong number of arguments for 'lpush' command");
  }
  return pushItems(key, args.slice(1), "left", { store, nowMs });
}

export function handleRpush(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const key = args[0];
  if (key === undefined || args.length < 2) {
    return err("ERR wrong number of arguments for 'rpush' command");
  }
  return pushItems(key, args.slice(1), "right", { store, nowMs });
}

interface PushContext {
  store: Map<string, StoreEntry>;
  nowMs: number;
}

function pushItems(
  key: string,
  values: string[],
  side: "left" | "right",
  ctx: PushContext,
): RedisResult {
  const { store, nowMs } = ctx;
  const entry = store.get(key);
  if (entry !== undefined && !isExpired(entry, nowMs) && entry.kind !== "list") {
    return err(WRONG_TYPE_MSG);
  }
  const items = getList(store, key, nowMs) ?? [];
  for (const v of values) {
    if (side === "left") {
      items.unshift(v);
    } else {
      items.push(v);
    }
  }
  const expiresAt = entry !== undefined && !isExpired(entry, nowMs) ? entry.expiresAt : undefined;
  store.set(key, { kind: "list", items, expiresAt });
  return ok(items.length);
}

export function handleLpop(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const key = args[0];
  if (key === undefined) return err("ERR wrong number of arguments for 'lpop' command");
  const items = getList(store, key, nowMs);
  if (items === null) return ok(null);
  const entry = store.get(key);
  if (entry !== undefined && entry.kind !== "list") return err(WRONG_TYPE_MSG);
  const val = items.shift() ?? null;
  if (items.length === 0) store.delete(key);
  return ok(autoDeserialize(val));
}

export function handleRpop(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const key = args[0];
  if (key === undefined) return err("ERR wrong number of arguments for 'rpop' command");
  const items = getList(store, key, nowMs);
  if (items === null) return ok(null);
  const entry = store.get(key);
  if (entry !== undefined && entry.kind !== "list") return err(WRONG_TYPE_MSG);
  const val = items.pop() ?? null;
  if (items.length === 0) store.delete(key);
  return ok(autoDeserialize(val));
}

export function handleLrange(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const [key, startStr, stopStr] = args;
  if (key === undefined || startStr === undefined || stopStr === undefined) {
    return err("ERR wrong number of arguments for 'lrange' command");
  }
  const items = getList(store, key, nowMs);
  if (items === null) return ok([]);
  const len = items.length;
  let start = parseInt(startStr, 10);
  let stop = parseInt(stopStr, 10);
  if (start < 0) start = Math.max(0, len + start);
  if (stop < 0) stop = len + stop;
  return ok(items.slice(start, stop + 1).map(autoDeserialize));
}

export function handleLtrim(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const [key, startStr, stopStr] = args;
  if (key === undefined || startStr === undefined || stopStr === undefined) {
    return err("ERR wrong number of arguments for 'ltrim' command");
  }
  const entry = store.get(key);
  if (entry === undefined || isExpired(entry, nowMs)) return ok("OK");
  if (entry.kind !== "list") return err(WRONG_TYPE_MSG);
  const len = entry.items.length;
  let start = parseInt(startStr, 10);
  let stop = parseInt(stopStr, 10);
  if (start < 0) start = Math.max(0, len + start);
  if (stop < 0) stop = len + stop;
  entry.items.splice(0, entry.items.length, ...entry.items.slice(start, stop + 1));
  if (entry.items.length === 0) store.delete(key);
  return ok("OK");
}

export function handleLlen(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const key = args[0];
  if (key === undefined) return err("ERR wrong number of arguments for 'llen' command");
  const items = getList(store, key, nowMs);
  if (items === null) {
    const entry = store.get(key);
    if (entry !== undefined && !isExpired(entry, nowMs) && entry.kind !== "list") {
      return err(WRONG_TYPE_MSG);
    }
    return ok(0);
  }
  return ok(items.length);
}
