import { describe, it, expect, beforeEach } from "vitest";
import { TelegramTwin } from "./telegram.js";

describe("TelegramTwin", () => {
  let twin: TelegramTwin;

  beforeEach(() => {
    twin = new TelegramTwin();
  });

  describe("sendMessage", () => {
    it("returns proper TelegramMessage with message_id, chat, date", async () => {
      const result = await twin.sendMessage(12345, "Hello");
      expect(result.ok).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result?.message_id).toBe(1);
      expect(result.result?.chat).toEqual({ id: 12345, type: "private" });
      expect(result.result?.date).toBeGreaterThan(0);
      expect(result.result?.text).toBe("Hello");
    });

    it("increments message_id for each message", async () => {
      const r1 = await twin.sendMessage(1, "first");
      const r2 = await twin.sendMessage(1, "second");
      expect(r1.result?.message_id).toBe(1);
      expect(r2.result?.message_id).toBe(2);
    });

    it("returns error when chatId is missing", async () => {
      const result = await twin.sendMessage(0, "Hello");
      expect(result.ok).toBe(false);
      expect(result.error_code).toBe(400);
      expect(result.description).toContain("chat_id");
    });

    it("returns error when text is empty", async () => {
      const result = await twin.sendMessage(12345, "");
      expect(result.ok).toBe(false);
      expect(result.error_code).toBe(400);
      expect(result.description).toContain("text");
    });
  });

  describe("getFile + downloadFile round-trip", () => {
    it("returns file metadata and downloads bytes", async () => {
      const imageBytes = Buffer.from("fake-png-data");
      twin.injectFile("photo_001", "photos/file_1.jpg", imageBytes);

      const fileResult = await twin.getFile("photo_001");
      expect(fileResult.ok).toBe(true);
      expect(fileResult.result?.file_id).toBe("photo_001");
      expect(fileResult.result?.file_path).toBe("photos/file_1.jpg");
      expect(fileResult.result?.file_size).toBe(imageBytes.length);
      expect(fileResult.result?.file_unique_id).toBe("uniq_photo_001");

      const downloaded = await twin.downloadFile("photos/file_1.jpg");
      expect(downloaded).toEqual(imageBytes);
    });

    it("getFile returns error for unknown file_id", async () => {
      const result = await twin.getFile("nonexistent");
      expect(result.ok).toBe(false);
      expect(result.error_code).toBe(400);
    });

    it("getFile returns error for empty file_id", async () => {
      const result = await twin.getFile("");
      expect(result.ok).toBe(false);
      expect(result.error_code).toBe(400);
    });

    it("downloadFile throws for unknown file_path", async () => {
      await expect(
        twin.downloadFile("nonexistent/path.jpg"),
      ).rejects.toThrow("File not found");
    });
  });

  describe("setWebhook", () => {
    it("stores webhook config correctly", async () => {
      const result = await twin.setWebhook({
        url: "https://example.com/webhook",
        secret_token: "mysecret",
        allowed_updates: ["message"],
      });
      expect(result.ok).toBe(true);
      expect(result.result).toBe(true);

      const config = twin.getWebhookConfig();
      expect(config).toEqual({
        url: "https://example.com/webhook",
        secretToken: "mysecret",
        allowedUpdates: ["message"],
      });
    });

    it("stores webhook without optional fields", async () => {
      await twin.setWebhook({ url: "https://example.com/hook" });
      const config = twin.getWebhookConfig();
      expect(config?.url).toBe("https://example.com/hook");
      expect(config?.secretToken).toBeUndefined();
      expect(config?.allowedUpdates).toBeUndefined();
    });

    it("returns error when url is empty", async () => {
      const result = await twin.setWebhook({ url: "" });
      expect(result.ok).toBe(false);
      expect(result.error_code).toBe(400);
    });
  });

  describe("test helpers", () => {
    it("getOutbox returns all sent messages", async () => {
      await twin.sendMessage(1, "msg1");
      await twin.sendMessage(2, "msg2");
      const outbox = twin.getOutbox();
      expect(outbox).toHaveLength(2);
      expect(outbox[0]?.text).toBe("msg1");
      expect(outbox[1]?.text).toBe("msg2");
    });

    it("getOutbox returns a copy, not the internal array", async () => {
      await twin.sendMessage(1, "msg1");
      const outbox = twin.getOutbox();
      outbox.pop();
      expect(twin.getOutbox()).toHaveLength(1);
    });

    it("clearOutbox resets sent messages", async () => {
      await twin.sendMessage(1, "msg1");
      expect(twin.getOutbox()).toHaveLength(1);
      twin.clearOutbox();
      expect(twin.getOutbox()).toHaveLength(0);
    });

    it("getWebhookConfig returns null before setWebhook", () => {
      expect(twin.getWebhookConfig()).toBeNull();
    });
  });
});
