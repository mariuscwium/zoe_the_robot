import { describe, it, expect, beforeEach } from "vitest";
import { hashSync } from "bcryptjs";
import type { Clock } from "./deps.js";
import { RedisTwin } from "../twins/redis.js";
import type { AuthDeps } from "./debug-auth.js";
import {
  parseCookie,
  extractIp,
  isLockedOut,
  recordFailedAttempt,
  resetLockout,
  verifyPassword,
  signToken,
  verifyToken,
} from "./debug-auth.js";

const FIXED_NOW = new Date("2026-03-10T12:00:00Z");
const clock: Clock = { now: () => FIXED_NOW };

const TEST_PASSWORD = "correct-horse-battery-staple";
const TEST_HASH = hashSync(TEST_PASSWORD, 10);
const TEST_SECRET = "test-jwt-secret-that-is-long-enough";
const TEST_IP = "203.0.113.42";

describe("debug-auth", () => {
  let redis: RedisTwin;
  let deps: AuthDeps;

  beforeEach(() => {
    redis = new RedisTwin(clock);
    deps = { redis, clock };
  });

  describe("parseCookie", () => {
    it("finds a named cookie", () => {
      const result = parseCookie("session=abc123", "session");
      expect(result).toBe("abc123");
    });

    it("returns null for a missing cookie", () => {
      const result = parseCookie("session=abc123", "token");
      expect(result).toBeNull();
    });

    it("returns null when header is undefined", () => {
      const result = parseCookie(undefined, "session");
      expect(result).toBeNull();
    });

    it("handles multiple cookies", () => {
      const header = "theme=dark; session=abc123; lang=en";
      expect(parseCookie(header, "session")).toBe("abc123");
      expect(parseCookie(header, "theme")).toBe("dark");
      expect(parseCookie(header, "lang")).toBe("en");
    });
  });

  describe("extractIp", () => {
    it("extracts first IP from a string forwarded header", () => {
      const result = extractIp("203.0.113.42, 70.41.3.18, 150.172.238.178", "0.0.0.0");
      expect(result).toBe("203.0.113.42");
    });

    it("extracts first IP from an array forwarded header", () => {
      const result = extractIp(["10.0.0.1", "10.0.0.2"], "0.0.0.0");
      expect(result).toBe("10.0.0.1");
    });

    it("returns fallback when forwarded is undefined", () => {
      const result = extractIp(undefined, "127.0.0.1");
      expect(result).toBe("127.0.0.1");
    });

    it("returns fallback for empty array", () => {
      const result = extractIp([], "127.0.0.1");
      expect(result).toBe("127.0.0.1");
    });
  });

  describe("isLockedOut", () => {
    it("returns false when no state exists", async () => {
      expect(await isLockedOut(deps, TEST_IP)).toBe(false);
    });

    it("returns false when under threshold", async () => {
      await recordFailedAttempt(deps, TEST_IP);
      await recordFailedAttempt(deps, TEST_IP);
      expect(await isLockedOut(deps, TEST_IP)).toBe(false);
    });

    it("returns true when locked", async () => {
      await recordFailedAttempt(deps, TEST_IP);
      await recordFailedAttempt(deps, TEST_IP);
      await recordFailedAttempt(deps, TEST_IP);
      expect(await isLockedOut(deps, TEST_IP)).toBe(true);
    });
  });

  describe("recordFailedAttempt", () => {
    it("increments counter and returns false before threshold", async () => {
      const firstResult = await recordFailedAttempt(deps, TEST_IP);
      expect(firstResult).toBe(false);

      const secondResult = await recordFailedAttempt(deps, TEST_IP);
      expect(secondResult).toBe(false);
    });

    it("returns true on the 3rd attempt", async () => {
      await recordFailedAttempt(deps, TEST_IP);
      await recordFailedAttempt(deps, TEST_IP);
      const thirdResult = await recordFailedAttempt(deps, TEST_IP);
      expect(thirdResult).toBe(true);
    });

    it("locked out after 3 failures", async () => {
      await recordFailedAttempt(deps, TEST_IP);
      await recordFailedAttempt(deps, TEST_IP);
      await recordFailedAttempt(deps, TEST_IP);
      expect(await isLockedOut(deps, TEST_IP)).toBe(true);
    });
  });

  describe("resetLockout", () => {
    it("clears lockout state", async () => {
      await recordFailedAttempt(deps, TEST_IP);
      await recordFailedAttempt(deps, TEST_IP);
      await recordFailedAttempt(deps, TEST_IP);
      expect(await isLockedOut(deps, TEST_IP)).toBe(true);

      await resetLockout(deps, TEST_IP);
      expect(await isLockedOut(deps, TEST_IP)).toBe(false);
    });

    it("isLockedOut returns false after reset", async () => {
      await recordFailedAttempt(deps, TEST_IP);
      await recordFailedAttempt(deps, TEST_IP);
      await recordFailedAttempt(deps, TEST_IP);
      await resetLockout(deps, TEST_IP);

      // Should also be able to record new attempts from zero
      const result = await recordFailedAttempt(deps, TEST_IP);
      expect(result).toBe(false);
    });
  });

  describe("verifyPassword", () => {
    it("returns true for correct password", async () => {
      expect(await verifyPassword(TEST_PASSWORD, TEST_HASH)).toBe(true);
    });

    it("returns false for wrong password", async () => {
      expect(await verifyPassword("wrong-password", TEST_HASH)).toBe(false);
    });
  });

  describe("signToken + verifyToken", () => {
    it("valid token verifies", async () => {
      const token = await signToken(TEST_SECRET, clock);
      const valid = await verifyToken(token, TEST_SECRET);
      expect(valid).toBe(true);
    });

    it("invalid token fails", async () => {
      const valid = await verifyToken("not-a-valid-jwt", TEST_SECRET);
      expect(valid).toBe(false);
    });

    it("different secret fails", async () => {
      const token = await signToken(TEST_SECRET, clock);
      const valid = await verifyToken(token, "completely-different-secret");
      expect(valid).toBe(false);
    });
  });

  describe("lockout expiry", () => {
    it("after 15 minutes, isLockedOut returns false", async () => {
      // Use a mutable clock so we can advance time
      let nowMs = FIXED_NOW.getTime();
      const advanceableClock: Clock = { now: () => new Date(nowMs) };
      const advanceableRedis = new RedisTwin(advanceableClock);
      const advanceableDeps: AuthDeps = {
        redis: advanceableRedis,
        clock: advanceableClock,
      };

      // Lock out the IP
      await recordFailedAttempt(advanceableDeps, TEST_IP);
      await recordFailedAttempt(advanceableDeps, TEST_IP);
      await recordFailedAttempt(advanceableDeps, TEST_IP);
      expect(await isLockedOut(advanceableDeps, TEST_IP)).toBe(true);

      // Advance clock by 15 minutes
      nowMs += 15 * 60 * 1000;
      expect(await isLockedOut(advanceableDeps, TEST_IP)).toBe(false);
    });
  });
});
