import { describe, it, expect, beforeEach } from "vitest";
import { TelegramTwin } from "../twins/telegram.js";
import { sendReply, downloadImage, registerWebhook } from "./telegram.js";

describe("sendReply", () => {
  let telegram: TelegramTwin;

  beforeEach(() => {
    telegram = new TelegramTwin();
  });

  it("sends message to outbox", async () => {
    await sendReply({ telegram }, 123, "Hello");

    const outbox = telegram.getOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.text).toBe("Hello");
    expect(outbox[0]?.chat.id).toBe(123);
  });

  it("splits messages over 4096 chars", async () => {
    const longText = "A".repeat(4096) + "\n" + "B".repeat(100);
    await sendReply({ telegram }, 123, longText);

    const outbox = telegram.getOutbox();
    expect(outbox.length).toBeGreaterThanOrEqual(2);
    for (const msg of outbox) {
      expect((msg.text ?? "").length).toBeLessThanOrEqual(4096);
    }
    expect(outbox[0]?.text).toBe("A".repeat(4096));
    expect(outbox[1]?.text).toBe("\n" + "B".repeat(100));
  });

  it("handles errors gracefully and does not throw", async () => {
    // chatId 0 triggers an error in the twin
    await expect(sendReply({ telegram }, 0, "test")).resolves.toBeUndefined();
  });
});

describe("downloadImage", () => {
  let telegram: TelegramTwin;

  beforeEach(() => {
    telegram = new TelegramTwin();
  });

  it("returns base64 data URI", async () => {
    const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    telegram.injectFile("file123", "photos/test.jpg", imageBytes);

    const result = await downloadImage({ telegram }, "file123");

    expect(result).not.toBeNull();
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
    const base64Part = result?.replace("data:image/jpeg;base64,", "") ?? "";
    const decoded = Buffer.from(base64Part, "base64");
    expect(decoded).toEqual(imageBytes);
  });

  it("returns null for missing file", async () => {
    const result = await downloadImage({ telegram }, "nonexistent");
    expect(result).toBeNull();
  });
});

describe("registerWebhook", () => {
  let telegram: TelegramTwin;

  beforeEach(() => {
    telegram = new TelegramTwin();
  });

  it("returns true on success", async () => {
    const result = await registerWebhook(
      { telegram },
      { url: "https://example.com/api/telegram", secretToken: "secret123" },
    );

    expect(result).toBe(true);

    const config = telegram.getWebhookConfig();
    expect(config?.url).toBe("https://example.com/api/telegram");
    expect(config?.secretToken).toBe("secret123");
  });

  it("returns false on error", async () => {
    // Empty URL triggers error in the twin
    const result = await registerWebhook(
      { telegram },
      { url: "", secretToken: "secret123" },
    );

    expect(result).toBe(false);
  });
});
