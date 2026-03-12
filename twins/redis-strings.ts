/**
 * String command handlers for the Redis twin.
 */

import type { RedisResult } from "../lib/deps.js";
import type { StoreEntry } from "./redis-types.js";
import { ok, err, getString, isExpired, autoDeserialize, WRONG_TYPE_MSG } from "./redis-types.js";

export function handleGet(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const key = args[0];
  if (key === undefined) return err("ERR wrong number of arguments for 'get' command");
  return ok(autoDeserialize(getString(store, key, nowMs)));
}

export function handleSet(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const key = args[0];
  const value = args[1];
  if (key === undefined || value === undefined) {
    return err("ERR wrong number of arguments for 'set' command");
  }
  return applySetOptions(args.slice(2), { key, value, store }, nowMs);
}

interface SetOptions {
  expiresAt?: number;
  nx: boolean;
  xx: boolean;
}

function parseSetFlags(opts: string[], nowMs: number): SetOptions {
  let expiresAt: number | undefined;
  let nx = false;
  let xx = false;

  for (let i = 0; i < opts.length; i++) {
    const flag = opts[i]?.toUpperCase();
    const next = opts[i + 1];
    if (flag === "EX" && next !== undefined) {
      expiresAt = nowMs + parseInt(next, 10) * 1000;
      i++;
    } else if (flag === "PX" && next !== undefined) {
      expiresAt = nowMs + parseInt(next, 10);
      i++;
    } else if (flag === "NX") {
      nx = true;
    } else if (flag === "XX") {
      xx = true;
    }
  }
  return { expiresAt, nx, xx };
}

interface SetContext {
  key: string;
  value: string;
  store: Map<string, StoreEntry>;
}

function applySetOptions(
  opts: string[],
  ctx: SetContext,
  nowMs: number,
): RedisResult {
  const { expiresAt, nx, xx } = parseSetFlags(opts, nowMs);

  const existing = ctx.store.get(ctx.key);
  const exists = existing !== undefined && !isExpired(existing, nowMs);
  if (nx && exists) return ok(null);
  if (xx && !exists) return ok(null);

  ctx.store.set(ctx.key, { kind: "string", value: ctx.value, expiresAt });
  return ok("OK");
}

export function handleAppend(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const key = args[0];
  const value = args[1];
  if (key === undefined || value === undefined) {
    return err("ERR wrong number of arguments for 'append' command");
  }
  const existing = getString(store, key, nowMs);
  const entry = store.get(key);
  if (entry !== undefined && !isExpired(entry, nowMs) && entry.kind !== "string") {
    return err(WRONG_TYPE_MSG);
  }
  const newVal = (existing ?? "") + value;
  const expiresAt = entry !== undefined && !isExpired(entry, nowMs) ? entry.expiresAt : undefined;
  store.set(key, { kind: "string", value: newVal, expiresAt });
  return ok(newVal.length);
}

export function handleMget(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const results = args.map((key) => autoDeserialize(getString(store, key, nowMs)));
  return ok(results);
}

export function handleMset(
  args: string[],
  store: Map<string, StoreEntry>,
): RedisResult {
  if (args.length % 2 !== 0) {
    return err("ERR wrong number of arguments for 'mset' command");
  }
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (key === undefined || value === undefined) break;
    store.set(key, { kind: "string", value });
  }
  return ok("OK");
}

export function handleIncr(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  return handleIncrby([args[0] ?? "", "1"], store, nowMs);
}

const INT_ERR = "ERR value is not an integer or out of range";

function parseIntOrErr(s: string): number | null {
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function checkStringType(
  store: Map<string, StoreEntry>,
  key: string,
  nowMs: number,
): RedisResult | null {
  const entry = store.get(key);
  if (entry !== undefined && !isExpired(entry, nowMs) && entry.kind !== "string") {
    return err(WRONG_TYPE_MSG);
  }
  return null;
}

export function handleIncrby(
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
): RedisResult {
  const key = args[0];
  const increment = args[1];
  if (key === undefined || increment === undefined) {
    return err("ERR wrong number of arguments for 'incrby' command");
  }
  const typeErr = checkStringType(store, key, nowMs);
  if (typeErr !== null) return typeErr;

  const current = getString(store, key, nowMs) ?? "0";
  const num = parseIntOrErr(current);
  if (num === null) return err(INT_ERR);
  const inc = parseIntOrErr(increment);
  if (inc === null) return err(INT_ERR);
  const newVal = String(num + inc);
  const entry = store.get(key);
  const expiresAt =
    entry !== undefined && !isExpired(entry, nowMs) ? entry.expiresAt : undefined;
  store.set(key, { kind: "string", value: newVal, expiresAt });
  return ok(num + inc);
}
