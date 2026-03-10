import { describe, it, expect, beforeEach } from "vitest";
import type { Clock } from "./deps.js";
import { RedisTwin } from "../twins/redis.js";
import type { AuditEntry, IncomingLogEntry } from "./types.js";
import {
  appendAudit,
  appendIncoming,
  getAuditLog,
  getIncomingLog,
} from "./audit.js";

const clock: Clock = { now: () => new Date(1000000) };

function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: "2026-03-10T12:00:00Z",
    memberId: "marius",
    action: "delete_memory",
    detail: "Deleted memory:family:todos",
    ...overrides,
  };
}

function makeIncomingEntry(
  overrides: Partial<IncomingLogEntry> = {},
): IncomingLogEntry {
  return {
    timestamp: "2026-03-10T12:00:00Z",
    memberId: "sarah",
    messageType: "text",
    text: "Hello, assistant!",
    ...overrides,
  };
}

describe("audit", () => {
  let redis: RedisTwin;

  beforeEach(() => {
    redis = new RedisTwin(clock);
  });

  describe("appendAudit / getAuditLog", () => {
    it("returns empty array when no entries exist", async () => {
      const result = await getAuditLog({ redis });
      expect(result).toEqual([]);
    });

    it("appends and retrieves a single audit entry", async () => {
      const entry = makeAuditEntry();
      await appendAudit({ redis }, entry);
      const result = await getAuditLog({ redis });
      expect(result).toEqual([entry]);
    });

    it("returns entries in reverse chronological order (most recent first)", async () => {
      const first = makeAuditEntry({ action: "first" });
      const second = makeAuditEntry({ action: "second" });
      await appendAudit({ redis }, first);
      await appendAudit({ redis }, second);
      const result = await getAuditLog({ redis });
      expect(result).toHaveLength(2);
      expect(result[0]?.action).toBe("second");
      expect(result[1]?.action).toBe("first");
    });

    it("respects the limit parameter", async () => {
      const entries = Array.from({ length: 5 }, (_, i) =>
        makeAuditEntry({ action: `action-${String(i)}` }),
      );
      for (const entry of entries) {
        await appendAudit({ redis }, entry);
      }
      const result = await getAuditLog({ redis }, 3);
      expect(result).toHaveLength(3);
    });
  });

  describe("appendIncoming / getIncomingLog", () => {
    it("returns empty array when no entries exist", async () => {
      const result = await getIncomingLog({ redis });
      expect(result).toEqual([]);
    });

    it("appends and retrieves an incoming log entry", async () => {
      const entry = makeIncomingEntry();
      await appendIncoming({ redis }, entry);
      const result = await getIncomingLog({ redis });
      expect(result).toEqual([entry]);
    });

    it("returns entries in reverse chronological order", async () => {
      const first = makeIncomingEntry({ text: "first" });
      const second = makeIncomingEntry({ text: "second" });
      await appendIncoming({ redis }, first);
      await appendIncoming({ redis }, second);
      const result = await getIncomingLog({ redis });
      expect(result).toHaveLength(2);
      expect(result[0]?.text).toBe("second");
      expect(result[1]?.text).toBe("first");
    });

    it("respects the limit parameter", async () => {
      const entries = Array.from({ length: 5 }, (_, i) =>
        makeIncomingEntry({ text: `msg-${String(i)}` }),
      );
      for (const entry of entries) {
        await appendIncoming({ redis }, entry);
      }
      const result = await getIncomingLog({ redis }, 2);
      expect(result).toHaveLength(2);
    });
  });
});
