import { describe, it, expect, beforeEach } from "vitest";
import type { Clock } from "./deps.js";
import { RedisTwin } from "../twins/redis.js";
import {
  loadHistory,
  saveHistory,
  appendMessage,
  trimHistory,
} from "./history.js";
import type { ConversationMessage } from "./history.js";

function createRedis(): RedisTwin {
  const clock: Clock = { now: () => new Date(1000000) };
  return new RedisTwin(clock);
}

function msg(
  role: "user" | "assistant",
  content: string,
  timestamp = "2026-03-10T12:00:00Z",
): ConversationMessage {
  return { role, content, timestamp };
}

describe("history", () => {
  let redis: RedisTwin;
  const chatId = 12345;

  beforeEach(() => {
    redis = createRedis();
  });

  describe("loadHistory", () => {
    it("returns empty array when no history exists", async () => {
      const result = await loadHistory({ redis }, chatId);
      expect(result).toEqual([]);
    });

    it("loads stored messages", async () => {
      const m1 = msg("user", "hello");
      const m2 = msg("assistant", "hi there");
      await redis.execute([
        "RPUSH",
        `conversation:${String(chatId)}`,
        JSON.stringify(m1),
        JSON.stringify(m2),
      ]);

      const result = await loadHistory({ redis }, chatId);
      expect(result).toEqual([m1, m2]);
    });

    it("skips malformed JSON entries gracefully", async () => {
      const valid = msg("user", "hello");
      await redis.execute([
        "RPUSH",
        `conversation:${String(chatId)}`,
        "not json",
        JSON.stringify(valid),
        "{invalid",
      ]);

      const result = await loadHistory({ redis }, chatId);
      expect(result).toEqual([valid]);
    });

    it("skips entries with missing fields", async () => {
      const valid = msg("user", "hello");
      await redis.execute([
        "RPUSH",
        `conversation:${String(chatId)}`,
        JSON.stringify({ role: "user" }), // missing content and timestamp
        JSON.stringify(valid),
      ]);

      const result = await loadHistory({ redis }, chatId);
      expect(result).toEqual([valid]);
    });

    it("skips entries with invalid role", async () => {
      const valid = msg("assistant", "hi");
      await redis.execute([
        "RPUSH",
        `conversation:${String(chatId)}`,
        JSON.stringify({
          role: "system",
          content: "nope",
          timestamp: "2026-03-10T12:00:00Z",
        }),
        JSON.stringify(valid),
      ]);

      const result = await loadHistory({ redis }, chatId);
      expect(result).toEqual([valid]);
    });
  });

  describe("saveHistory", () => {
    it("replaces existing history", async () => {
      const old = msg("user", "old");
      await appendMessage({ redis }, chatId, old);

      const newMsgs = [msg("user", "new1"), msg("assistant", "new2")];
      await saveHistory({ redis }, chatId, newMsgs);

      const result = await loadHistory({ redis }, chatId);
      expect(result).toEqual(newMsgs);
    });

    it("handles empty message array by clearing history", async () => {
      await appendMessage({ redis }, chatId, msg("user", "hello"));
      await saveHistory({ redis }, chatId, []);

      const result = await loadHistory({ redis }, chatId);
      expect(result).toEqual([]);
    });

    it("saves to correct key per chatId", async () => {
      const chatId2 = 99999;
      await saveHistory({ redis }, chatId, [msg("user", "for 12345")]);
      await saveHistory({ redis }, chatId2, [msg("user", "for 99999")]);

      const r1 = await loadHistory({ redis }, chatId);
      const r2 = await loadHistory({ redis }, chatId2);
      expect(r1[0]?.content).toBe("for 12345");
      expect(r2[0]?.content).toBe("for 99999");
    });
  });

  describe("appendMessage", () => {
    it("appends to empty history", async () => {
      const m = msg("user", "first");
      await appendMessage({ redis }, chatId, m);

      const result = await loadHistory({ redis }, chatId);
      expect(result).toEqual([m]);
    });

    it("appends to existing history", async () => {
      const m1 = msg("user", "first");
      const m2 = msg("assistant", "second");
      await appendMessage({ redis }, chatId, m1);
      await appendMessage({ redis }, chatId, m2);

      const result = await loadHistory({ redis }, chatId);
      expect(result).toEqual([m1, m2]);
    });
  });

  describe("trimHistory", () => {
    it("keeps only the last N messages", async () => {
      const messages = [
        msg("user", "1"),
        msg("assistant", "2"),
        msg("user", "3"),
        msg("assistant", "4"),
        msg("user", "5"),
      ];
      await saveHistory({ redis }, chatId, messages);
      await trimHistory({ redis }, chatId, 3);

      const result = await loadHistory({ redis }, chatId);
      expect(result).toHaveLength(3);
      expect(result[0]?.content).toBe("3");
      expect(result[1]?.content).toBe("4");
      expect(result[2]?.content).toBe("5");
    });

    it("is a no-op when history is shorter than max", async () => {
      const messages = [msg("user", "1"), msg("assistant", "2")];
      await saveHistory({ redis }, chatId, messages);
      await trimHistory({ redis }, chatId, 10);

      const result = await loadHistory({ redis }, chatId);
      expect(result).toEqual(messages);
    });

    it("keeps exactly maxMessages when history equals max", async () => {
      const messages = [msg("user", "1"), msg("assistant", "2")];
      await saveHistory({ redis }, chatId, messages);
      await trimHistory({ redis }, chatId, 2);

      const result = await loadHistory({ redis }, chatId);
      expect(result).toEqual(messages);
    });
  });
});
