/* eslint-disable no-console */

/**
 * Idempotent deploy script.
 * Registers Telegram webhook and optionally upserts a member into the registry.
 *
 * Usage:
 *   npm run bootstrap -- --chatid=111111 --name=Marius --timezone=Pacific/Auckland
 */

import type { RedisClient, TelegramClient } from "../lib/deps.js";
import type { FamilyMember } from "../lib/types.js";
import { upsertMember } from "../lib/registry.js";
import { registerWebhook } from "../lib/telegram.js";

export interface BootstrapConfig {
  chatId?: number;
  name?: string;
  timezone?: string;
  webhookUrl: string;
  webhookSecret: string;
}

interface BootstrapDeps {
  redis: RedisClient;
  telegram: TelegramClient;
}

function parseArgs(argv: string[]): Partial<BootstrapConfig> {
  const config: Partial<BootstrapConfig> = {};

  for (const arg of argv) {
    if (arg.startsWith("--chatid=")) {
      config.chatId = Number(arg.slice("--chatid=".length));
    } else if (arg.startsWith("--name=")) {
      config.name = arg.slice("--name=".length);
    } else if (arg.startsWith("--timezone=")) {
      config.timezone = arg.slice("--timezone=".length);
    }
  }

  return config;
}

function validateMemberArgs(
  config: Partial<BootstrapConfig>,
): { chatId: number; name: string; timezone: string } {
  if (config.chatId === undefined || config.name === undefined || config.timezone === undefined) {
    throw new Error("All member args required: --chatid, --name, --timezone");
  }
  if (isNaN(config.chatId)) {
    throw new Error("--chatid must be a number");
  }
  return { chatId: config.chatId, name: config.name, timezone: config.timezone };
}

export async function runBootstrap(
  deps: BootstrapDeps,
  config: BootstrapConfig,
): Promise<void> {
  if (config.chatId !== undefined) {
    const memberArgs = validateMemberArgs(config);
    const member: FamilyMember = {
      id: memberArgs.name.toLowerCase(),
      name: memberArgs.name,
      chatId: memberArgs.chatId,
      timezone: memberArgs.timezone,
      role: "parent",
      isAdmin: true,
    };

    await upsertMember({ redis: deps.redis }, member);
    console.log(`Upserted member: ${member.name} (chatId=${String(member.chatId)})`);
  } else {
    console.log("No member args provided, skipping registry update.");
  }

  const ok = await registerWebhook(
    { telegram: deps.telegram },
    { url: config.webhookUrl, secretToken: config.webhookSecret },
  );

  if (ok) {
    console.log(`Webhook registered: ${config.webhookUrl}`);
  } else {
    throw new Error("Failed to register Telegram webhook");
  }
}

function buildWebhookUrl(): string {
  const explicit = process.env.WEBHOOK_URL;
  if (explicit) {
    return `${explicit}/api/telegram`;
  }
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    return `https://${vercelUrl}/api/telegram`;
  }
  throw new Error("Set WEBHOOK_URL or VERCEL_URL env var");
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing env var: ${key}`);
  }
  return val;
}

function notUsed(): never {
  throw new Error("Not used in bootstrap");
}

function createRedisClient(url: string, token: string): RedisClient {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return {
    async execute(command: string[]) {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(command) });
      return (await res.json()) as { result: unknown; error?: string };
    },
    async pipeline(commands: string[][]) {
      const res = await fetch(`${url}/pipeline`, { method: "POST", headers, body: JSON.stringify(commands) });
      return (await res.json()) as { result: unknown; error?: string }[];
    },
  };
}

function createTelegramClient(token: string): TelegramClient {
  return {
    sendMessage: () => notUsed(),
    getFile: () => notUsed(),
    downloadFile: () => notUsed(),
    async setWebhook(params) {
      const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      return (await res.json()) as { ok: boolean; result?: boolean; description?: string };
    },
  };
}

async function main(): Promise<void> {
  const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const secret = requireEnv("TELEGRAM_WEBHOOK_SECRET");
  const redisUrl = requireEnv("UPSTASH_REDIS_REST_URL");
  const redisToken = requireEnv("UPSTASH_REDIS_REST_TOKEN");

  const config: BootstrapConfig = {
    ...parseArgs(process.argv.slice(2)),
    webhookUrl: buildWebhookUrl(),
    webhookSecret: secret,
  };

  await runBootstrap(
    { redis: createRedisClient(redisUrl, redisToken), telegram: createTelegramClient(botToken) },
    config,
  );
  console.log("Bootstrap complete.");
}

// Only run when executed directly, not when imported by tests
const isDirectRun = process.argv[1]?.includes("bootstrap");
if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error("Bootstrap failed:", err);
    process.exit(1);
  });
}
