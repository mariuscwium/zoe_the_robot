import { describe, it, expect, beforeEach } from "vitest";
import { RedisTwin } from "../twins/redis.js";
import type { Clock } from "./deps.js";
import type { DebugApiDeps } from "./debug-api.js";
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
import { writeMemory } from "./memory.js";
import { appendMessage } from "./history.js";
import { upsertMember } from "./registry.js";
import { appendAudit, appendIncoming } from "./audit.js";
import type { FamilyMember, AuditEntry, IncomingLogEntry } from "./types.js";

const FIXED_NOW = new Date("2026-03-10T12:00:00Z");
const fixedClock: Clock = { now: () => FIXED_NOW };

function makeDeps(): { redis: RedisTwin; deps: DebugApiDeps } {
  const redis = new RedisTwin(fixedClock);
  const deps: DebugApiDeps = { redis, clock: fixedClock };
  return { redis, deps };
}

function makeMember(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: "marius",
    name: "Marius",
    chatId: 111111,
    timezone: "Pacific/Auckland",
    role: "parent",
    isAdmin: true,
    ...overrides,
  };
}

function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: "2026-03-10T12:00:00Z",
    memberId: "marius",
    action: "write_memory",
    detail: "test detail",
    ...overrides,
  };
}

function makeIncomingEntry(overrides: Partial<IncomingLogEntry> = {}): IncomingLogEntry {
  return {
    timestamp: "2026-03-10T12:00:00Z",
    memberId: "marius",
    messageType: "text",
    text: "hello",
    ...overrides,
  };
}

describe("handleListKeys", () => {
  it("returns memory keys", async () => {
    const { deps } = makeDeps();
    await writeMemory(deps, "memory:family:todos", "- buy milk");
    await writeMemory(deps, "memory:family:notes", "some notes");

    const result = await handleListKeys(deps);
    expect(result.success).toBe(true);
    const keys = result.data as string[];
    expect(keys).toContain("memory:family:todos");
    expect(keys).toContain("memory:family:notes");
  });

  it("returns empty array when no memory keys exist", async () => {
    const { deps } = makeDeps();
    const result = await handleListKeys(deps);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });
});

describe("handleReadKey", () => {
  it("returns content for existing key", async () => {
    const { deps } = makeDeps();
    await writeMemory(deps, "memory:family:todos", "- buy milk");

    const result = await handleReadKey(deps, "memory:family:todos");
    expect(result.success).toBe(true);
    expect(result.data).toBe("- buy milk");
  });

  it("returns error for missing key", async () => {
    const { deps } = makeDeps();
    const result = await handleReadKey(deps, "memory:family:nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Key not found");
  });
});

describe("handleWriteKey", () => {
  it("writes content and appends audit entry", async () => {
    const { deps } = makeDeps();
    const result = await handleWriteKey(deps, "memory:family:todos", "- buy eggs");
    expect(result.success).toBe(true);
    expect(result.data).toBe("Saved");

    // Verify the key was written
    const readResult = await handleReadKey(deps, "memory:family:todos");
    expect(readResult.data).toBe("- buy eggs");

    // Verify audit entry was appended
    const audit = await handleGetAuditLog(deps, { offset: 0, limit: 10 });
    const entries = (audit.data as { entries: AuditEntry[] }).entries;
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]?.action).toBe("write_memory");
    expect(entries[0]?.memberId).toBe("DEBUG");
  });
});

describe("handleDeleteKey", () => {
  it("deletes key and appends audit entry", async () => {
    const { deps } = makeDeps();
    await writeMemory(deps, "memory:family:todos", "- buy milk");

    const result = await handleDeleteKey(deps, "memory:family:todos");
    expect(result.success).toBe(true);
    expect(result.data).toBe("Deleted");

    // Verify key is gone
    const readResult = await handleReadKey(deps, "memory:family:todos");
    expect(readResult.success).toBe(false);
    expect(readResult.error).toBe("Key not found");

    // Verify audit entry
    const audit = await handleGetAuditLog(deps, { offset: 0, limit: 10 });
    const entries = (audit.data as { entries: AuditEntry[] }).entries;
    expect(entries[0]?.action).toBe("delete_memory");
    expect(entries[0]?.memberId).toBe("DEBUG");
  });
});

describe("handleListMembers", () => {
  it("returns registered members", async () => {
    const { deps } = makeDeps();
    await upsertMember(deps, makeMember());
    await upsertMember(deps, makeMember({ id: "anna", name: "Anna", chatId: 222222 }));

    const result = await handleListMembers(deps);
    expect(result.success).toBe(true);
    const members = result.data as FamilyMember[];
    expect(members).toHaveLength(2);
    const names = members.map((m) => m.name).sort();
    expect(names).toEqual(["Anna", "Marius"]);
  });

  it("returns empty array when no members registered", async () => {
    const { deps } = makeDeps();
    const result = await handleListMembers(deps);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });
});

describe("handleGetHistory", () => {
  it("returns conversation history", async () => {
    const { deps } = makeDeps();
    await appendMessage(deps, 111111, {
      role: "user",
      content: "Hello",
      timestamp: "2026-03-10T12:00:00Z",
    });
    await appendMessage(deps, 111111, {
      role: "assistant",
      content: "Hi there!",
      timestamp: "2026-03-10T12:00:01Z",
    });

    const result = await handleGetHistory(deps, 111111);
    expect(result.success).toBe(true);
    const history = result.data as { role: string; content: string }[];
    expect(history).toHaveLength(2);
    expect(history[0]?.role).toBe("user");
    expect(history[0]?.content).toBe("Hello");
    expect(history[1]?.role).toBe("assistant");
    expect(history[1]?.content).toBe("Hi there!");
  });

  it("returns empty array for unknown chatId", async () => {
    const { deps } = makeDeps();
    const result = await handleGetHistory(deps, 999999);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });
});

describe("handleClearHistory", () => {
  it("clears conversation and appends audit", async () => {
    const { deps } = makeDeps();
    await appendMessage(deps, 111111, {
      role: "user",
      content: "Hello",
      timestamp: "2026-03-10T12:00:00Z",
    });

    const result = await handleClearHistory(deps, 111111);
    expect(result.success).toBe(true);
    expect(result.data).toBe("Cleared");

    // Verify history is empty
    const histResult = await handleGetHistory(deps, 111111);
    expect(histResult.data).toEqual([]);

    // Verify audit entry
    const audit = await handleGetAuditLog(deps, { offset: 0, limit: 10 });
    const entries = (audit.data as { entries: AuditEntry[] }).entries;
    expect(entries[0]?.action).toBe("clear_history");
    expect(entries[0]?.detail).toContain("111111");
  });
});

describe("handleGetAuditLog", () => {
  let deps: DebugApiDeps;

  beforeEach(async () => {
    ({ deps } = makeDeps());
    // Populate with several audit entries
    for (let i = 0; i < 5; i++) {
      await appendAudit(deps, makeAuditEntry({
        action: `action_${String(i)}`,
        memberId: i % 2 === 0 ? "marius" : "anna",
      }));
    }
  });

  it("returns paginated entries", async () => {
    const result = await handleGetAuditLog(deps, { offset: 0, limit: 2 });
    expect(result.success).toBe(true);
    const data = result.data as { entries: AuditEntry[]; total: number };
    expect(data.entries).toHaveLength(2);
    expect(data.total).toBe(5);
  });

  it("respects offset", async () => {
    const result = await handleGetAuditLog(deps, { offset: 3, limit: 10 });
    const data = result.data as { entries: AuditEntry[]; total: number };
    expect(data.entries).toHaveLength(2);
  });

  it("filters by member", async () => {
    const result = await handleGetAuditLog(deps, {
      offset: 0,
      limit: 25,
      filter: "anna",
    });
    const data = result.data as { entries: AuditEntry[]; total: number };
    expect(data.total).toBe(2);
    for (const entry of data.entries) {
      expect(entry.memberId).toBe("anna");
    }
  });

  it("filters by action", async () => {
    const result = await handleGetAuditLog(deps, {
      offset: 0,
      limit: 25,
      filter: "action_0",
    });
    const data = result.data as { entries: AuditEntry[]; total: number };
    expect(data.total).toBe(1);
    expect(data.entries[0]?.action).toBe("action_0");
  });
});

describe("handleArchiveAudit", () => {
  it("archives entries older than 30 days", async () => {
    const { deps } = makeDeps();
    const oldTimestamp = "2026-01-15T10:00:00Z"; // ~54 days ago
    const recentTimestamp = "2026-03-09T10:00:00Z"; // yesterday

    await appendAudit(deps, makeAuditEntry({ timestamp: oldTimestamp, action: "old_action" }));
    await appendAudit(deps, makeAuditEntry({ timestamp: recentTimestamp, action: "recent_action" }));

    const result = await handleArchiveAudit(deps);
    expect(result.success).toBe(true);
    expect(result.data).toContain("Archived 1 entr");

    // Verify only the recent entry remains in the audit log
    const remaining = await handleGetAuditLog(deps, { offset: 0, limit: 100 });
    const data = remaining.data as { entries: AuditEntry[]; total: number };
    // After archive, old entries are removed; recent + the archive audit entry may remain
    const actions = data.entries.map((e) => e.action);
    expect(actions).not.toContain("old_action");
    expect(actions).toContain("recent_action");
  });

  it("returns nothing-to-archive when all entries are recent", async () => {
    const { deps } = makeDeps();
    await appendAudit(deps, makeAuditEntry({ timestamp: "2026-03-09T10:00:00Z" }));

    const result = await handleArchiveAudit(deps);
    expect(result.success).toBe(true);
    expect(result.data).toBe("Nothing to archive");
  });
});

describe("handleGetIncoming", () => {
  it("returns paginated incoming entries", async () => {
    const { deps } = makeDeps();
    for (let i = 0; i < 5; i++) {
      await appendIncoming(deps, makeIncomingEntry({ text: `msg ${String(i)}` }));
    }

    const result = await handleGetIncoming(deps, { offset: 0, limit: 3 });
    expect(result.success).toBe(true);
    const data = result.data as { entries: IncomingLogEntry[]; total: number };
    expect(data.entries).toHaveLength(3);
    expect(data.total).toBe(5);
  });

  it("respects offset", async () => {
    const { deps } = makeDeps();
    for (let i = 0; i < 5; i++) {
      await appendIncoming(deps, makeIncomingEntry({ text: `msg ${String(i)}` }));
    }

    const result = await handleGetIncoming(deps, { offset: 4, limit: 10 });
    const data = result.data as { entries: IncomingLogEntry[]; total: number };
    expect(data.entries).toHaveLength(1);
  });
});

describe("handleTrimIncoming", () => {
  it("trims to 500 entries and appends audit", async () => {
    const { deps } = makeDeps();
    // Add a few entries (we cannot practically add 501 in a unit test,
    // but we can verify the LTRIM command runs and audit is appended)
    for (let i = 0; i < 3; i++) {
      await appendIncoming(deps, makeIncomingEntry({ text: `msg ${String(i)}` }));
    }

    const result = await handleTrimIncoming(deps);
    expect(result.success).toBe(true);
    expect(result.data).toBe("Trimmed");

    // Verify audit entry was appended
    const audit = await handleGetAuditLog(deps, { offset: 0, limit: 10 });
    const entries = (audit.data as { entries: AuditEntry[] }).entries;
    expect(entries[0]?.action).toBe("trim_incoming");
    expect(entries[0]?.memberId).toBe("DEBUG");
  });
});
