/**
 * Minimal local dev server that mimics Vercel's function routing.
 * Usage: npx tsx scripts/local-dev.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Agent, setGlobalDispatcher } from "undici";
import { config } from "dotenv";

// Fix Node 22 undici autoSelectFamily issue with some hosts (e.g. Telegram)
setGlobalDispatcher(new Agent({ connect: { autoSelectFamily: false } }));

config(); // load .env

// Lazy-import handlers to ensure env is loaded first
const { default: telegramHandler } = await import("../api/telegram.js");
const { default: healthHandler } = await import("../api/health.js");

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        resolve(parsed);
      } catch (e) {
        console.error("JSON parse error, raw body:", JSON.stringify(raw));
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function adaptRequest(req: IncomingMessage, body: unknown): Record<string, unknown> {
  return {
    method: req.method,
    headers: req.headers,
    body,
    query: Object.fromEntries(new URL(req.url ?? "/", "http://localhost").searchParams),
  };
}

function adaptResponse(res: ServerResponse): Record<string, unknown> {
  const adapted = {
    status(code: number) {
      res.statusCode = code;
      return adapted;
    },
    json(data: unknown) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
      return adapted;
    },
    send(data: string) {
      res.end(data);
      return adapted;
    },
  };
  return adapted;
}

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";
  console.log(`${method} ${url}`);

  try {
    if (url.startsWith("/api/telegram")) {
      const body = await parseBody(req);
      console.log("Telegram body:", JSON.stringify(body, null, 2));
      await telegramHandler(adaptRequest(req, body) as never, adaptResponse(res) as never);
    } else if (url.startsWith("/api/health")) {
      await healthHandler(adaptRequest(req, {}) as never, adaptResponse(res) as never);
    } else {
      res.statusCode = 404;
      res.end("Not found");
    }
  } catch (err) {
    console.error("Handler error:", err);
    res.statusCode = 500;
    res.end("Internal server error");
  }
});

server.listen(PORT, () => {
  console.log(`Local dev server running on http://localhost:${PORT}`);
  console.log("Routes: POST /api/telegram, GET /api/health");
});
