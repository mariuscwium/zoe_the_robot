import { describe, it, expect, beforeEach } from "vitest";
import type { Clock } from "../lib/deps.js";
import { RedisTwin } from "./redis.js";

function createTwin(): RedisTwin {
  const clock: Clock = { now: () => new Date(1000000) };
  return new RedisTwin(clock);
}

describe("RedisTwin", () => {
  let twin: RedisTwin;

  beforeEach(() => {
    twin = createTwin();
  });

  describe("GET / SET", () => {
    it("returns null for missing key", async () => {
      const res = await twin.execute(["GET", "missing"]);
      expect(res.result).toBeNull();
    });

    it("sets and gets a string value", async () => {
      await twin.execute(["SET", "foo", "bar"]);
      const res = await twin.execute(["GET", "foo"]);
      expect(res.result).toBe("bar");
    });

    it("SET with EX expires after tick", async () => {
      await twin.execute(["SET", "k", "v", "EX", "5"]);
      const before = await twin.execute(["GET", "k"]);
      expect(before.result).toBe("v");

      twin.tick(4999);
      const still = await twin.execute(["GET", "k"]);
      expect(still.result).toBe("v");

      twin.tick(1);
      const after = await twin.execute(["GET", "k"]);
      expect(after.result).toBeNull();
    });

    it("SET with PX expires after tick in milliseconds", async () => {
      await twin.execute(["SET", "k", "v", "PX", "100"]);
      twin.tick(99);
      expect((await twin.execute(["GET", "k"])).result).toBe("v");
      twin.tick(1);
      expect((await twin.execute(["GET", "k"])).result).toBeNull();
    });

    it("SET NX only sets if key does not exist", async () => {
      await twin.execute(["SET", "k", "first"]);
      const res = await twin.execute(["SET", "k", "second", "NX"]);
      expect(res.result).toBeNull();
      expect((await twin.execute(["GET", "k"])).result).toBe("first");
    });

    it("SET XX only sets if key exists", async () => {
      const res = await twin.execute(["SET", "k", "v", "XX"]);
      expect(res.result).toBeNull();
      await twin.execute(["SET", "k", "v"]);
      const res2 = await twin.execute(["SET", "k", "v2", "XX"]);
      expect(res2.result).toBe("OK");
    });
  });

  describe("DEL / EXISTS", () => {
    it("DEL removes keys and returns count", async () => {
      await twin.execute(["SET", "a", "1"]);
      await twin.execute(["SET", "b", "2"]);
      const res = await twin.execute(["DEL", "a", "b", "c"]);
      expect(res.result).toBe(2);
    });

    it("EXISTS returns count of existing keys", async () => {
      await twin.execute(["SET", "a", "1"]);
      const res = await twin.execute(["EXISTS", "a", "missing"]);
      expect(res.result).toBe(1);
    });
  });

  describe("EXPIRE / TTL / PTTL / PERSIST", () => {
    it("EXPIRE sets TTL, TTL returns remaining seconds", async () => {
      await twin.execute(["SET", "k", "v"]);
      await twin.execute(["EXPIRE", "k", "10"]);
      const ttl = await twin.execute(["TTL", "k"]);
      expect(ttl.result).toBe(10);
    });

    it("TTL returns -1 for key without expiry", async () => {
      await twin.execute(["SET", "k", "v"]);
      expect((await twin.execute(["TTL", "k"])).result).toBe(-1);
    });

    it("TTL returns -2 for missing key", async () => {
      expect((await twin.execute(["TTL", "missing"])).result).toBe(-2);
    });

    it("PTTL returns milliseconds remaining", async () => {
      await twin.execute(["SET", "k", "v", "PX", "5000"]);
      expect((await twin.execute(["PTTL", "k"])).result).toBe(5000);
    });

    it("PERSIST removes TTL", async () => {
      await twin.execute(["SET", "k", "v", "EX", "10"]);
      await twin.execute(["PERSIST", "k"]);
      expect((await twin.execute(["TTL", "k"])).result).toBe(-1);
    });
  });

  describe("KEYS / SCAN", () => {
    it("KEYS with pattern matches correctly", async () => {
      await twin.execute(["SET", "memory:family:todos", "x"]);
      await twin.execute(["SET", "memory:family:notes", "y"]);
      await twin.execute(["SET", "other:key", "z"]);
      const res = await twin.execute(["KEYS", "memory:family:*"]);
      const keys = res.result as string[];
      expect(keys).toHaveLength(2);
      expect(keys).toContain("memory:family:todos");
      expect(keys).toContain("memory:family:notes");
    });

    it("SCAN with MATCH pattern returns matching keys", async () => {
      await twin.execute(["SET", "memory:family:a", "1"]);
      await twin.execute(["SET", "memory:family:b", "2"]);
      await twin.execute(["SET", "other:c", "3"]);
      const res = await twin.execute(["SCAN", "0", "MATCH", "memory:*"]);
      const [cursor, keys] = res.result as [string, string[]];
      expect(keys).toContain("memory:family:a");
      expect(keys).toContain("memory:family:b");
      expect(keys).not.toContain("other:c");
      expect(cursor).toBe("0");
    });

    it("SCAN paginates with COUNT", async () => {
      for (let i = 0; i < 5; i++) {
        await twin.execute(["SET", `k${String(i)}`, String(i)]);
      }
      const res = await twin.execute(["SCAN", "0", "COUNT", "2"]);
      const [cursor, keys] = res.result as [string, string[]];
      expect(keys).toHaveLength(2);
      expect(Number(cursor)).toBeGreaterThan(0);
    });
  });

  describe("LPUSH / RPUSH / LPOP / RPOP / LRANGE / LTRIM / LLEN", () => {
    it("LPUSH adds to head, LRANGE returns elements", async () => {
      await twin.execute(["LPUSH", "list", "c", "b", "a"]);
      const res = await twin.execute(["LRANGE", "list", "0", "-1"]);
      expect(res.result).toEqual(["a", "b", "c"]);
    });

    it("RPUSH adds to tail", async () => {
      await twin.execute(["RPUSH", "list", "a", "b", "c"]);
      const res = await twin.execute(["LRANGE", "list", "0", "-1"]);
      expect(res.result).toEqual(["a", "b", "c"]);
    });

    it("LPOP removes from head", async () => {
      await twin.execute(["RPUSH", "list", "a", "b"]);
      const val = await twin.execute(["LPOP", "list"]);
      expect(val.result).toBe("a");
    });

    it("RPOP removes from tail", async () => {
      await twin.execute(["RPUSH", "list", "a", "b"]);
      const val = await twin.execute(["RPOP", "list"]);
      expect(val.result).toBe("b");
    });

    it("LTRIM keeps only the specified range", async () => {
      await twin.execute(["RPUSH", "list", "a", "b", "c", "d", "e"]);
      await twin.execute(["LTRIM", "list", "0", "2"]);
      const res = await twin.execute(["LRANGE", "list", "0", "-1"]);
      expect(res.result).toEqual(["a", "b", "c"]);
    });

    it("LLEN returns list length", async () => {
      await twin.execute(["RPUSH", "list", "a", "b", "c"]);
      expect((await twin.execute(["LLEN", "list"])).result).toBe(3);
    });

    it("LLEN returns 0 for missing key", async () => {
      expect((await twin.execute(["LLEN", "missing"])).result).toBe(0);
    });

    it("LPOP returns null for missing key", async () => {
      expect((await twin.execute(["LPOP", "missing"])).result).toBeNull();
    });

    it("RPOP returns null for missing key", async () => {
      expect((await twin.execute(["RPOP", "missing"])).result).toBeNull();
    });
  });

  describe("APPEND", () => {
    it("appends to existing string", async () => {
      await twin.execute(["SET", "k", "hello"]);
      const res = await twin.execute(["APPEND", "k", " world"]);
      expect(res.result).toBe(11);
      expect((await twin.execute(["GET", "k"])).result).toBe("hello world");
    });

    it("creates key if it does not exist", async () => {
      await twin.execute(["APPEND", "k", "new"]);
      expect((await twin.execute(["GET", "k"])).result).toBe("new");
    });
  });

  describe("MGET / MSET", () => {
    it("MSET sets multiple keys, MGET retrieves them", async () => {
      await twin.execute(["MSET", "a", "1", "b", "2"]);
      const res = await twin.execute(["MGET", "a", "b", "c"]);
      expect(res.result).toEqual([1, 2, null]);
    });
  });

  describe("INCR / INCRBY", () => {
    it("INCR increments by 1", async () => {
      await twin.execute(["SET", "counter", "5"]);
      const res = await twin.execute(["INCR", "counter"]);
      expect(res.result).toBe(6);
    });

    it("INCR creates key at 0 and increments", async () => {
      const res = await twin.execute(["INCR", "counter"]);
      expect(res.result).toBe(1);
    });

    it("INCRBY increments by specified amount", async () => {
      await twin.execute(["SET", "counter", "10"]);
      const res = await twin.execute(["INCRBY", "counter", "5"]);
      expect(res.result).toBe(15);
    });

    it("INCR errors on non-integer value", async () => {
      await twin.execute(["SET", "k", "abc"]);
      const res = await twin.execute(["INCR", "k"]);
      expect(res.error).toContain("not an integer");
    });
  });

  describe("WRONGTYPE errors", () => {
    it("GET on list key returns null", async () => {
      await twin.execute(["RPUSH", "list", "a"]);
      const res = await twin.execute(["GET", "list"]);
      expect(res.result).toBeNull();
    });

    it("LPUSH on string key returns error", async () => {
      await twin.execute(["SET", "str", "v"]);
      const res = await twin.execute(["LPUSH", "str", "a"]);
      expect(res.error).toContain("WRONGTYPE");
    });
  });

  describe("pipeline", () => {
    it("returns results in order", async () => {
      const results = await twin.pipeline([
        ["SET", "a", "1"],
        ["SET", "b", "2"],
        ["GET", "a"],
        ["GET", "b"],
      ]);
      expect(results).toHaveLength(4);
      expect(results[0]?.result).toBe("OK");
      expect(results[1]?.result).toBe("OK");
      expect(results[2]?.result).toBe(1);
      expect(results[3]?.result).toBe(2);
    });

    it("continues on individual errors", async () => {
      await twin.execute(["RPUSH", "list", "a"]);
      const results = await twin.pipeline([
        ["LPUSH", "list", "b"],
        ["APPEND", "list", "x"],
        ["LLEN", "list"],
      ]);
      expect(results).toHaveLength(3);
      expect(results[0]?.result).toBe(2);
      expect(results[1]?.error).toContain("WRONGTYPE");
      expect(results[2]?.result).toBe(2);
    });
  });

  describe("unknown command", () => {
    it("returns error for unknown command", async () => {
      const res = await twin.execute(["FLUSHALL"]);
      expect(res.error).toContain("unknown command");
    });
  });

  describe("tick and TTL expiry", () => {
    it("expired keys are cleaned up on access", async () => {
      await twin.execute(["SET", "temp", "val", "EX", "2"]);
      twin.tick(2000);
      const exists = await twin.execute(["EXISTS", "temp"]);
      expect(exists.result).toBe(0);
    });
  });

  describe("reset", () => {
    it("clears all state", async () => {
      await twin.execute(["SET", "k", "v"]);
      twin.reset();
      const res = await twin.execute(["GET", "k"]);
      expect(res.result).toBeNull();
    });
  });
});
