import { describe, it, expect, beforeEach } from "vitest";
import type { Clock } from "../lib/deps.js";
import { RedisTwin } from "../twins/redis.js";
import { TelegramTwin } from "../twins/telegram.js";
import { getMember, getAllMembers } from "../lib/registry.js";
import { runBootstrap } from "./bootstrap.js";
import type { BootstrapConfig } from "./bootstrap.js";

const clock: Clock = { now: () => new Date(1000000) };

const BASE_CONFIG: BootstrapConfig = {
  webhookUrl: "https://example.vercel.app/api/telegram",
  webhookSecret: "test-secret-123",
};

describe("scripts/bootstrap", () => {
  let redis: RedisTwin;
  let telegram: TelegramTwin;

  beforeEach(() => {
    redis = new RedisTwin(clock);
    telegram = new TelegramTwin();
  });

  it("upserts member when args provided", async () => {
    const config: BootstrapConfig = {
      ...BASE_CONFIG,
      chatId: 111111,
      name: "Marius",
      timezone: "Pacific/Auckland",
    };

    await runBootstrap({ redis, telegram }, config);

    const member = await getMember({ redis }, 111111);
    expect(member).not.toBeNull();
    expect(member?.name).toBe("Marius");
    expect(member?.chatId).toBe(111111);
    expect(member?.timezone).toBe("Pacific/Auckland");
    expect(member?.isAdmin).toBe(true);
  });

  it("only registers webhook when no member args provided", async () => {
    await runBootstrap({ redis, telegram }, BASE_CONFIG);

    const members = await getAllMembers({ redis });
    expect(members).toHaveLength(0);

    const webhook = telegram.getWebhookConfig();
    expect(webhook).not.toBeNull();
    expect(webhook?.url).toBe(BASE_CONFIG.webhookUrl);
  });

  it("is idempotent — running twice does not duplicate members", async () => {
    const config: BootstrapConfig = {
      ...BASE_CONFIG,
      chatId: 111111,
      name: "Marius",
      timezone: "Pacific/Auckland",
    };

    await runBootstrap({ redis, telegram }, config);
    await runBootstrap({ redis, telegram }, config);

    const members = await getAllMembers({ redis });
    expect(members).toHaveLength(1);
    expect(members[0]?.name).toBe("Marius");
  });

  it("registers webhook with correct URL and secret", async () => {
    await runBootstrap({ redis, telegram }, BASE_CONFIG);

    const webhook = telegram.getWebhookConfig();
    expect(webhook).not.toBeNull();
    expect(webhook?.url).toBe("https://example.vercel.app/api/telegram");
    expect(webhook?.secretToken).toBe("test-secret-123");
    expect(webhook?.allowedUpdates).toEqual(["message"]);
  });

  it("preserves existing members when adding a new one", async () => {
    const config1: BootstrapConfig = {
      ...BASE_CONFIG,
      chatId: 111111,
      name: "Marius",
      timezone: "Pacific/Auckland",
    };
    await runBootstrap({ redis, telegram }, config1);

    const config2: BootstrapConfig = {
      ...BASE_CONFIG,
      chatId: 222222,
      name: "Sarah",
      timezone: "Pacific/Auckland",
    };
    await runBootstrap({ redis, telegram }, config2);

    const members = await getAllMembers({ redis });
    expect(members).toHaveLength(2);
  });
});
