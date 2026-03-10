import { describe, it, expect, beforeEach } from "vitest";
import { hashSync } from "bcryptjs";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { RedisTwin } from "../twins/redis.js";
import type { Clock } from "../lib/deps.js";
import { createDebugHandler, type DebugConfig, type DebugDeps } from "./debug.js";
import { writeMemory } from "../lib/memory.js";

const PASSWORD = "test-password";
const PASSWORD_HASH = hashSync(PASSWORD, 10);
const DEBUG_KEY = "test-debug-key";
const JWT_SECRET = "test-jwt-secret";

const FIXED_NOW = new Date("2026-03-10T12:00:00Z");
const fixedClock: Clock = { now: () => FIXED_NOW };

const config: DebugConfig = {
  debugKey: DEBUG_KEY,
  passwordHash: PASSWORD_HASH,
  jwtSecret: JWT_SECRET,
};

function createMockReq(opts: {
  method?: string;
  query?: Record<string, string>;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}): VercelRequest {
  return {
    method: opts.method ?? "GET",
    query: opts.query ?? {},
    headers: opts.headers ?? {},
    body: opts.body,
  } as unknown as VercelRequest;
}

interface MockRes extends VercelResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

function createMockRes(): MockRes {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
    send(data: unknown) {
      res.body = data;
      return res;
    },
    setHeader(key: string, value: string) {
      res.headers[key] = value;
      return res;
    },
    end() {
      return res;
    },
  };
  return res as unknown as MockRes;
}

interface TestContext {
  redis: RedisTwin;
  deps: DebugDeps;
  handle: (req: VercelRequest, res: VercelResponse) => Promise<void>;
}

function setup(): TestContext {
  const redis = new RedisTwin(fixedClock);
  const deps: DebugDeps = { redis, clock: fixedClock };
  const handle = createDebugHandler(deps, config);
  return { redis, deps, handle };
}

async function loginAndGetCookie(ctx: TestContext): Promise<string> {
  const req = createMockReq({
    method: "POST",
    query: { key: DEBUG_KEY },
    headers: { "x-forwarded-for": "1.2.3.4" },
    body: { password: PASSWORD },
  });
  const res = createMockRes();
  await ctx.handle(req, res);
  // Extract the cookie value from Set-Cookie header
  const setCookie = res.headers["Set-Cookie"] ?? "";
  const regex = /debug_token=([^;]+)/;
  const match = regex.exec(setCookie);
  return match ? `debug_token=${match[1] ?? ""}` : "";
}

describe("GET/POST /api/debug", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setup();
  });

  it("returns 404 when debug key is missing", async () => {
    const req = createMockReq({ query: {} });
    const res = createMockRes();
    await ctx.handle(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("returns 404 when debug key is wrong", async () => {
    const req = createMockReq({ query: { key: "wrong-key" } });
    const res = createMockRes();
    await ctx.handle(req, res);
    expect(res.statusCode).toBe(404);
  });

  it("serves login HTML when not authenticated", async () => {
    const req = createMockReq({ query: { key: DEBUG_KEY } });
    const res = createMockRes();
    await ctx.handle(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(typeof res.body).toBe("string");
    expect(res.body as string).toContain("password");
    expect(res.body as string).toContain("Login");
  });

  it("login with correct password sets cookie and returns dashboard", async () => {
    const req = createMockReq({
      method: "POST",
      query: { key: DEBUG_KEY },
      headers: { "x-forwarded-for": "1.2.3.4" },
      body: { password: PASSWORD },
    });
    const res = createMockRes();
    await ctx.handle(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Set-Cookie"]).toContain("debug_token=");
    expect(res.headers["Set-Cookie"]).toContain("HttpOnly");
    expect(typeof res.body).toBe("string");
    expect(res.body as string).toContain("Debug");
  });

  it("login with wrong password returns login page with error", async () => {
    const req = createMockReq({
      method: "POST",
      query: { key: DEBUG_KEY },
      headers: { "x-forwarded-for": "1.2.3.4" },
      body: { password: "wrong-password" },
    });
    const res = createMockRes();
    await ctx.handle(req, res);
    expect(res.statusCode).toBe(200);
    expect(typeof res.body).toBe("string");
    expect(res.body as string).toContain("Invalid password");
  });

  it("three failed logins returns 429", async () => {
    for (let i = 0; i < 3; i++) {
      const req = createMockReq({
        method: "POST",
        query: { key: DEBUG_KEY },
        headers: { "x-forwarded-for": "10.0.0.1" },
        body: { password: "wrong" },
      });
      const res = createMockRes();
      await ctx.handle(req, res);
    }

    // Fourth attempt should be locked out
    const req = createMockReq({
      method: "POST",
      query: { key: DEBUG_KEY },
      headers: { "x-forwarded-for": "10.0.0.1" },
      body: { password: "wrong" },
    });
    const res = createMockRes();
    await ctx.handle(req, res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: "Too many attempts. Try again later." });
  });

  it("authenticated request without action returns dashboard HTML", async () => {
    const cookie = await loginAndGetCookie(ctx);
    const req = createMockReq({
      query: { key: DEBUG_KEY },
      headers: { cookie },
    });
    const res = createMockRes();
    await ctx.handle(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(typeof res.body).toBe("string");
    expect(res.body as string).toContain("Debug");
  });

  it("authenticated request with action=list_keys returns JSON", async () => {
    // Seed a memory key
    await writeMemory(ctx.deps, "memory:family:todos", "- buy milk");

    const cookie = await loginAndGetCookie(ctx);
    const req = createMockReq({
      query: { key: DEBUG_KEY, action: "list_keys" },
      headers: { cookie },
    });
    const res = createMockRes();
    await ctx.handle(req, res);
    expect(res.statusCode).toBe(200);
    const body = res.body as { success: boolean; data: string[] };
    expect(body.success).toBe(true);
    expect(body.data).toContain("memory:family:todos");
  });
});

