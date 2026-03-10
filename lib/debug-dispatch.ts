/**
 * Routes debug API action strings to handler functions.
 * Separated from api/debug.ts to stay under line limits.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { RedisClient, Clock } from "./deps.js";
import {
  handleListKeys,
  handleReadKey,
  handleWriteKey,
  handleDeleteKey,
  handleListMembers,
  handleGetHistory,
  handleClearHistory,
  handleGetAuditLog,
  handleArchiveAudit,
  handleGetIncoming,
  handleTrimIncoming,
} from "./debug-api.js";

interface DispatchDeps {
  redis: RedisClient;
  clock: Clock;
}

export async function dispatchAction(
  deps: DispatchDeps,
  action: string,
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const result = await routeAction(deps, action, req);
  res.status(200).json(result);
}

type ActionResult = Promise<{ success: boolean; data?: unknown; error?: string }>;

async function routeAction(
  deps: DispatchDeps,
  action: string,
  req: VercelRequest,
): ActionResult {
  const dataResult = await routeDataAction(deps, action, req);
  if (dataResult !== null) return dataResult;
  const logResult = await routeLogAction(deps, action, req);
  if (logResult !== null) return logResult;
  return { success: false, error: `Unknown action: ${action}` };
}

async function routeDataAction(
  deps: DispatchDeps,
  action: string,
  req: VercelRequest,
): Promise<{ success: boolean; data?: unknown; error?: string } | null> {
  switch (action) {
    case "list_keys":
      return handleListKeys(deps);
    case "read_key":
      return handleReadKey(deps, queryStr(req, "key"));
    case "write_key":
      return handleWriteKey(deps, bodyStr(req, "key"), bodyStr(req, "content"));
    case "delete_key":
      return handleDeleteKey(deps, bodyStr(req, "key"));
    case "list_members":
      return handleListMembers(deps);
    case "get_history":
      return handleGetHistory(deps, queryNum(req, "chatId"));
    case "clear_history":
      return handleClearHistory(deps, bodyNum(req, "chatId"));
    default:
      return null;
  }
}

async function routeLogAction(
  deps: DispatchDeps,
  action: string,
  req: VercelRequest,
): Promise<{ success: boolean; data?: unknown; error?: string } | null> {
  switch (action) {
    case "get_audit":
      return handleGetAuditLog(deps, {
        offset: queryNum(req, "offset"),
        limit: queryNumOr(req, "limit", 25),
        filter: queryStrOpt(req, "filter"),
      });
    case "archive_audit":
      return handleArchiveAudit(deps);
    case "get_incoming":
      return handleGetIncoming(deps, {
        offset: queryNum(req, "offset"),
        limit: queryNumOr(req, "limit", 25),
      });
    case "trim_incoming":
      return handleTrimIncoming(deps);
    default:
      return null;
  }
}

function queryStr(req: VercelRequest, key: string): string {
  const val = req.query[key];
  return typeof val === "string" ? val : "";
}

function queryStrOpt(req: VercelRequest, key: string): string | undefined {
  const val = req.query[key];
  return typeof val === "string" && val !== "" ? val : undefined;
}

function queryNum(req: VercelRequest, key: string): number {
  return Number(queryStr(req, key)) || 0;
}

function queryNumOr(req: VercelRequest, key: string, fallback: number): number {
  const val = queryStr(req, key);
  return val !== "" ? Number(val) || fallback : fallback;
}

function bodyStr(req: VercelRequest, key: string): string {
  const body = req.body as Record<string, unknown> | undefined;
  const val = body?.[key];
  return typeof val === "string" ? val : "";
}

function bodyNum(req: VercelRequest, key: string): number {
  const body = req.body as Record<string, unknown> | undefined;
  const val = body?.[key];
  return typeof val === "number" ? val : 0;
}
