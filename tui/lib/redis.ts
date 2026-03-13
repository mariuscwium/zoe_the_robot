import { Redis } from "@upstash/redis";
import type {
  IncomingLogEntry,
  AuditEntry,
  InferenceLogEntry,
  TokenLogEntry,
  UnifiedLogEntry,
} from "./types.js";

let redis: Redis | null = null;

export function initRedis(url: string, token: string): void {
  redis = new Redis({ url, token });
}

function getRedis(): Redis {
  if (!redis) throw new Error("Redis not initialized");
  return redis;
}

function parseEntries<T>(raw: unknown[]): T[] {
  return raw.map((item) => {
    if (typeof item === "string") return JSON.parse(item) as T;
    return item as T;
  });
}

export async function fetchIncomingLog(limit = 50): Promise<IncomingLogEntry[]> {
  const raw = await getRedis().lrange("log:incoming", 0, limit - 1);
  return parseEntries<IncomingLogEntry>(raw);
}

export async function fetchAuditLog(limit = 50): Promise<AuditEntry[]> {
  const raw = await getRedis().lrange("log:audit", 0, limit - 1);
  return parseEntries<AuditEntry>(raw);
}

export async function fetchInferenceLog(limit = 50): Promise<InferenceLogEntry[]> {
  const raw = await getRedis().lrange("log:inference", 0, limit - 1);
  return parseEntries<InferenceLogEntry>(raw);
}

export async function fetchTokenLog(limit = 50): Promise<TokenLogEntry[]> {
  const raw = await getRedis().lrange("log:tokens", 0, limit - 1);
  return parseEntries<TokenLogEntry>(raw);
}

export async function fetchMemoryKeys(): Promise<string[]> {
  const keys = await getRedis().keys("family/*");
  const memberKeys = await getRedis().keys("members/*");
  return [...keys, ...memberKeys].sort();
}

export async function fetchMemoryContent(key: string): Promise<string> {
  const content = await getRedis().get<string>(key);
  return content ?? "(empty)";
}

export async function fetchUnifiedLogs(limit = 100): Promise<UnifiedLogEntry[]> {
  const [incoming, audit, inference] = await Promise.all([
    fetchIncomingLog(limit),
    fetchAuditLog(limit),
    fetchInferenceLog(limit),
  ]);

  const unified: UnifiedLogEntry[] = [
    ...incoming.map((d) => ({ timestamp: d.timestamp, kind: "incoming" as const, data: d })),
    ...audit.map((d) => ({ timestamp: d.timestamp, kind: "audit" as const, data: d })),
    ...inference.map((d) => ({ timestamp: d.timestamp, kind: "inference" as const, data: d })),
  ];

  unified.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return unified.slice(0, limit);
}

export async function testConnection(): Promise<boolean> {
  try {
    await getRedis().ping();
    return true;
  } catch {
    return false;
  }
}
