/**
 * Server-side API handlers for the debug UI.
 * Each function reads/writes Redis and returns a JSON result.
 */

import type { RedisClient, Clock } from "./deps.js";
import type { AuditEntry } from "./types.js";
import { readMemory, writeMemory, deleteMemory, listMemoryKeys } from "./memory.js";
import { loadHistory } from "./history.js";
import { getAllMembers } from "./registry.js";
import { appendAudit, getAuditLog, getIncomingLog } from "./audit.js";

export interface DebugApiDeps {
  redis: RedisClient;
  clock: Clock;
}

export interface ApiResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface PaginationParams {
  offset: number;
  limit: number;
  filter?: string;
}

export async function handleListKeys(deps: DebugApiDeps): Promise<ApiResult> {
  const keys = await listMemoryKeys(deps, "memory:*");
  return { success: true, data: keys };
}

export async function handleReadKey(
  deps: DebugApiDeps,
  key: string,
): Promise<ApiResult> {
  const content = await readMemory(deps, key);
  if (content === null) {
    return { success: false, error: "Key not found" };
  }
  return { success: true, data: content };
}

export async function handleWriteKey(
  deps: DebugApiDeps,
  key: string,
  content: string,
): Promise<ApiResult> {
  await writeMemory(deps, key, content);
  await auditDebugAction(deps, "write_memory", `${key} (via debug UI)`);
  return { success: true, data: "Saved" };
}

export async function handleDeleteKey(
  deps: DebugApiDeps,
  key: string,
): Promise<ApiResult> {
  await deleteMemory(deps, key);
  await auditDebugAction(deps, "delete_memory", `${key} (via debug UI)`);
  return { success: true, data: "Deleted" };
}

export async function handleListMembers(
  deps: DebugApiDeps,
): Promise<ApiResult> {
  const members = await getAllMembers(deps);
  return { success: true, data: members };
}

export async function handleGetHistory(
  deps: DebugApiDeps,
  chatId: number,
): Promise<ApiResult> {
  const history = await loadHistory(deps, chatId);
  return { success: true, data: history };
}

export async function handleClearHistory(
  deps: DebugApiDeps,
  chatId: number,
): Promise<ApiResult> {
  await deps.redis.execute(["DEL", `conversation:${String(chatId)}`]);
  await auditDebugAction(deps, "clear_history", `chatId=${String(chatId)}`);
  return { success: true, data: "Cleared" };
}

export async function handleGetAuditLog(
  deps: DebugApiDeps,
  params: PaginationParams,
): Promise<ApiResult> {
  const all = await getAuditLog(deps, 500);
  const filtered = filterAudit(all, params.filter);
  const page = filtered.slice(params.offset, params.offset + params.limit);
  return { success: true, data: { entries: page, total: filtered.length } };
}

function filterAudit(entries: AuditEntry[], filter?: string): AuditEntry[] {
  if (filter === undefined || filter === "") return entries;
  const lower = filter.toLowerCase();
  return entries.filter((e) =>
    e.memberId.toLowerCase().includes(lower) ||
    e.action.toLowerCase().includes(lower),
  );
}

export async function handleArchiveAudit(
  deps: DebugApiDeps,
): Promise<ApiResult> {
  const all = await getAuditLog(deps, 10000);
  const cutoff = deps.clock.now().getTime() - 30 * 24 * 60 * 60 * 1000;
  const old = all.filter((e) => new Date(e.timestamp).getTime() < cutoff);
  if (old.length === 0) {
    return { success: true, data: "Nothing to archive" };
  }
  await writeArchiveEntries(deps, old);
  await rewriteAuditLog(deps, all, old.length);
  return { success: true, data: `Archived ${String(old.length)} entries` };
}

async function writeArchiveEntries(
  deps: DebugApiDeps,
  entries: AuditEntry[],
): Promise<void> {
  const byMonth = new Map<string, string[]>();
  for (const e of entries) {
    const month = e.timestamp.slice(0, 7);
    const key = `memory:archive:log-${month}`;
    const arr = byMonth.get(key) ?? [];
    arr.push(JSON.stringify(e));
    byMonth.set(key, arr);
  }
  for (const [key, lines] of byMonth) {
    const existing = await readMemory(deps, key);
    const combined = existing ? `${existing}\n${lines.join("\n")}` : lines.join("\n");
    await writeMemory(deps, key, combined);
  }
}

async function rewriteAuditLog(
  deps: DebugApiDeps,
  all: AuditEntry[],
  removeCount: number,
): Promise<void> {
  const keep = all.slice(0, all.length - removeCount);
  await deps.redis.execute(["DEL", "log:audit"]);
  if (keep.length > 0) {
    const items = keep.map((e) => JSON.stringify(e));
    await deps.redis.execute(["RPUSH", "log:audit", ...items]);
  }
}

export async function handleGetIncoming(
  deps: DebugApiDeps,
  params: PaginationParams,
): Promise<ApiResult> {
  const all = await getIncomingLog(deps, 1000);
  const page = all.slice(params.offset, params.offset + params.limit);
  return { success: true, data: { entries: page, total: all.length } };
}

export async function handleTrimIncoming(
  deps: DebugApiDeps,
): Promise<ApiResult> {
  await deps.redis.execute(["LTRIM", "log:incoming", "0", "499"]);
  await auditDebugAction(deps, "trim_incoming", "Trimmed to 500 entries");
  return { success: true, data: "Trimmed" };
}

async function auditDebugAction(
  deps: DebugApiDeps,
  action: string,
  detail: string,
): Promise<void> {
  await appendAudit(deps, {
    timestamp: deps.clock.now().toISOString(),
    memberId: "DEBUG",
    action,
    detail,
  });
}
