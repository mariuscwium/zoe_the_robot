import { describe, it, expect, beforeEach } from "vitest";
import type { Clock } from "./deps.js";
import { RedisTwin } from "../twins/redis.js";
import type { FamilyMember } from "./types.js";
import { getMember, getAllMembers, upsertMember, isAdmin } from "./registry.js";

const clock: Clock = { now: () => new Date(1000000) };

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

describe("registry", () => {
  let redis: RedisTwin;

  beforeEach(() => {
    redis = new RedisTwin(clock);
  });

  describe("getMember", () => {
    it("returns null when registry is empty", async () => {
      const result = await getMember({ redis }, 111111);
      expect(result).toBeNull();
    });

    it("returns the member matching chatId", async () => {
      const member = makeMember();
      await upsertMember({ redis }, member);
      const result = await getMember({ redis }, 111111);
      expect(result).toEqual(member);
    });

    it("returns null for unknown chatId", async () => {
      await upsertMember({ redis }, makeMember());
      const result = await getMember({ redis }, 999999);
      expect(result).toBeNull();
    });
  });

  describe("getAllMembers", () => {
    it("returns empty array when registry is empty", async () => {
      const result = await getAllMembers({ redis });
      expect(result).toEqual([]);
    });

    it("returns all registered members", async () => {
      const marius = makeMember();
      const sarah = makeMember({
        id: "sarah",
        name: "Sarah",
        chatId: 222222,
        isAdmin: false,
      });
      await upsertMember({ redis }, marius);
      await upsertMember({ redis }, sarah);
      const result = await getAllMembers({ redis });
      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining([marius, sarah]));
    });
  });

  describe("upsertMember", () => {
    it("adds a new member", async () => {
      const member = makeMember();
      await upsertMember({ redis }, member);
      const result = await getMember({ redis }, 111111);
      expect(result).toEqual(member);
    });

    it("updates an existing member without affecting others", async () => {
      const marius = makeMember();
      const sarah = makeMember({
        id: "sarah",
        name: "Sarah",
        chatId: 222222,
        isAdmin: false,
      });
      await upsertMember({ redis }, marius);
      await upsertMember({ redis }, sarah);

      const updated = { ...marius, name: "Marius Updated" };
      await upsertMember({ redis }, updated);

      const result = await getMember({ redis }, 111111);
      expect(result?.name).toBe("Marius Updated");

      const sarahResult = await getMember({ redis }, 222222);
      expect(sarahResult).toEqual(sarah);
    });
  });

  describe("isAdmin", () => {
    it("returns true for admin member", async () => {
      await upsertMember({ redis }, makeMember({ isAdmin: true }));
      const result = await isAdmin({ redis }, 111111);
      expect(result).toBe(true);
    });

    it("returns false for non-admin member", async () => {
      await upsertMember({ redis }, makeMember({ isAdmin: false }));
      const result = await isAdmin({ redis }, 111111);
      expect(result).toBe(false);
    });

    it("returns false for unknown chatId", async () => {
      const result = await isAdmin({ redis }, 999999);
      expect(result).toBe(false);
    });
  });
});
