/**
 * Debug UI handler (GET/POST /api/debug).
 * Password-protected single-page dashboard for inspecting Redis state.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { RedisClient, Clock } from "../lib/deps.js";
import {
  isLockedOut,
  recordFailedAttempt,
  resetLockout,
  verifyPassword,
  signToken,
  verifyToken,
  parseCookie,
  extractIp,
} from "../lib/debug-auth.js";
import { renderLoginPage, renderDashboard } from "../lib/debug-html.js";
import { dispatchAction } from "../lib/debug-dispatch.js";

export interface DebugConfig {
  debugKey: string;
  passwordHash: string;
  jwtSecret: string;
}

export interface DebugDeps {
  redis: RedisClient;
  clock: Clock;
}

const COOKIE_NAME = "debug_token";

export function createDebugHandler(deps: DebugDeps, config: DebugConfig) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    const key = asString(req.query.key);
    if (key !== config.debugKey) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (req.method === "POST" && asString(req.query.action) === "") {
      await handleLogin(deps, config, req, res);
      return;
    }
    const token = parseCookie(req.headers.cookie, COOKIE_NAME);
    const valid = token !== null && await verifyToken(token, config.jwtSecret);
    if (!valid) {
      sendHtml(res, renderLoginPage());
      return;
    }
    const action = asString(req.query.action);
    if (action !== "") {
      await dispatchAction(deps, action, req, res);
      return;
    }
    sendHtml(res, renderDashboard());
  };
}

async function handleLogin(
  deps: DebugDeps,
  config: DebugConfig,
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const ip = extractIp(req.headers["x-forwarded-for"], "unknown");
  if (await isLockedOut(deps, ip)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }
  const body = req.body as Record<string, unknown> | undefined;
  const password = typeof body?.password === "string" ? body.password : "";
  const ok = await verifyPassword(password, config.passwordHash);
  if (!ok) {
    await recordFailedAttempt(deps, ip);
    sendHtml(res, renderLoginPage("Invalid password"));
    return;
  }
  await resetLockout(deps, ip);
  const token = await signToken(config.jwtSecret, deps.clock);
  const cookie = `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`;
  res.setHeader("Set-Cookie", cookie);
  sendHtml(res, renderDashboard());
}

function sendHtml(res: VercelResponse, html: string): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function asString(val: unknown): string {
  if (typeof val === "string") return val;
  if (Array.isArray(val) && typeof val[0] === "string") return val[0];
  return "";
}

export default function handler(
  _req: VercelRequest,
  res: VercelResponse,
): void {
  res.status(404).json({ error: "Not found" });
}
