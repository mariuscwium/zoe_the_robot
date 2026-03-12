/**
 * Internal types for the Redis digital twin.
 */

import type { RedisResult } from "../lib/deps.js";

export interface StringEntry {
  kind: "string";
  value: string;
  expiresAt?: number;
}

export interface ListEntry {
  kind: "list";
  items: string[];
  expiresAt?: number;
}

export type StoreEntry = StringEntry | ListEntry;

export type CommandHandler = (
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
) => RedisResult;

export function isExpired(entry: StoreEntry, nowMs: number): boolean {
  return entry.expiresAt !== undefined && nowMs >= entry.expiresAt;
}

export function getString(
  store: Map<string, StoreEntry>,
  key: string,
  nowMs: number,
): string | null {
  const entry = store.get(key);
  if (entry === undefined || isExpired(entry, nowMs)) {
    if (entry !== undefined && isExpired(entry, nowMs)) {
      store.delete(key);
    }
    return null;
  }
  if (entry.kind !== "string") return null;
  return entry.value;
}

export function getList(
  store: Map<string, StoreEntry>,
  key: string,
  nowMs: number,
): string[] | null {
  const entry = store.get(key);
  if (entry === undefined || isExpired(entry, nowMs)) {
    if (entry !== undefined && isExpired(entry, nowMs)) {
      store.delete(key);
    }
    return null;
  }
  if (entry.kind !== "list") return null;
  return entry.items;
}

/**
 * Auto-deserialize a string value the way the Upstash SDK does.
 * If the string is valid JSON, return the parsed value; otherwise return as-is.
 */
export function autoDeserialize(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function ok(result: unknown): RedisResult {
  return { result };
}

export function err(error: string): RedisResult {
  return { result: null, error };
}

export const WRONG_TYPE_MSG =
  "WRONGTYPE Operation against a key holding the wrong kind of value";
