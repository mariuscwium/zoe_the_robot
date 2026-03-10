import { describe, it, expect, beforeEach } from "vitest";
import type { Clock } from "./deps.js";
import { RedisTwin } from "../twins/redis.js";
import {
  readMemory,
  writeMemory,
  deleteMemory,
  listMemoryKeys,
  appendToMemory,
} from "./memory.js";

function createRedis(): RedisTwin {
  const clock: Clock = { now: () => new Date(1000000) };
  return new RedisTwin(clock);
}

describe("memory", () => {
  let redis: RedisTwin;

  beforeEach(() => {
    redis = createRedis();
  });

  describe("readMemory", () => {
    it("returns null for non-existent key", async () => {
      const result = await readMemory({ redis }, "memory:family:todos");
      expect(result).toBeNull();
    });

    it("returns stored markdown content", async () => {
      const content = "# Todos\n- Buy milk\n- Walk dog";
      await redis.execute(["SET", "memory:family:todos", content]);

      const result = await readMemory({ redis }, "memory:family:todos");
      expect(result).toBe(content);
    });

    it("reads personal memory keys", async () => {
      const content = "Prefers dark mode";
      await redis.execute([
        "SET",
        "memory:members:sarah:preferences",
        content,
      ]);

      const result = await readMemory(
        { redis },
        "memory:members:sarah:preferences",
      );
      expect(result).toBe(content);
    });
  });

  describe("writeMemory", () => {
    it("creates a new memory document", async () => {
      await writeMemory({ redis }, "memory:family:todos", "# Todos\n- Test");

      const res = await redis.execute(["GET", "memory:family:todos"]);
      expect(res.result).toBe("# Todos\n- Test");
    });

    it("overwrites existing content", async () => {
      await writeMemory({ redis }, "memory:family:todos", "old");
      await writeMemory({ redis }, "memory:family:todos", "new");

      const result = await readMemory({ redis }, "memory:family:todos");
      expect(result).toBe("new");
    });
  });

  describe("deleteMemory", () => {
    it("removes a memory key", async () => {
      await writeMemory({ redis }, "memory:family:todos", "content");
      await deleteMemory({ redis }, "memory:family:todos");

      const result = await readMemory({ redis }, "memory:family:todos");
      expect(result).toBeNull();
    });

    it("does not throw when deleting non-existent key", async () => {
      await expect(
        deleteMemory({ redis }, "memory:family:nonexistent"),
      ).resolves.toBeUndefined();
    });
  });

  describe("listMemoryKeys", () => {
    it("returns empty array when no keys match", async () => {
      const result = await listMemoryKeys({ redis }, "memory:family:*");
      expect(result).toEqual([]);
    });

    it("returns matching shared memory keys", async () => {
      await writeMemory({ redis }, "memory:family:todos", "todos");
      await writeMemory({ redis }, "memory:family:docs:camp", "camp");
      await writeMemory({ redis }, "memory:members:sarah:prefs", "prefs");

      const result = await listMemoryKeys({ redis }, "memory:family:*");
      expect(result).toEqual([
        "memory:family:docs:camp",
        "memory:family:todos",
      ]);
    });

    it("returns matching personal memory keys", async () => {
      await writeMemory({ redis }, "memory:family:todos", "todos");
      await writeMemory({ redis }, "memory:members:sarah:prefs", "prefs");
      await writeMemory({ redis }, "memory:members:sarah:notes", "notes");

      const result = await listMemoryKeys(
        { redis },
        "memory:members:sarah:*",
      );
      expect(result).toEqual([
        "memory:members:sarah:notes",
        "memory:members:sarah:prefs",
      ]);
    });

    it("returns keys sorted alphabetically", async () => {
      await writeMemory({ redis }, "memory:family:c", "c");
      await writeMemory({ redis }, "memory:family:a", "a");
      await writeMemory({ redis }, "memory:family:b", "b");

      const result = await listMemoryKeys({ redis }, "memory:family:*");
      expect(result).toEqual([
        "memory:family:a",
        "memory:family:b",
        "memory:family:c",
      ]);
    });
  });

  describe("appendToMemory", () => {
    it("creates key if it does not exist", async () => {
      await appendToMemory({ redis }, "memory:family:log", "first entry\n");

      const result = await readMemory({ redis }, "memory:family:log");
      expect(result).toBe("first entry\n");
    });

    it("appends to existing content", async () => {
      await writeMemory({ redis }, "memory:family:log", "line 1\n");
      await appendToMemory({ redis }, "memory:family:log", "line 2\n");

      const result = await readMemory({ redis }, "memory:family:log");
      expect(result).toBe("line 1\nline 2\n");
    });
  });
});
