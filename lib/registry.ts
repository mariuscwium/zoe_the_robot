/**
 * Member registry backed by Redis.
 * Key: `registry:members` — a JSON string mapping member id to FamilyMember.
 */

import type { RedisClient } from "./deps.js";
import type { FamilyMember } from "./types.js";

const REGISTRY_KEY = "registry:members";

interface RegistryDeps {
  redis: RedisClient;
}

type MemberMap = Record<string, FamilyMember>;

async function loadRegistry(deps: RegistryDeps): Promise<MemberMap> {
  const res = await deps.redis.execute(["GET", REGISTRY_KEY]);
  if (res.error !== undefined) {
    throw new Error(`Redis error loading registry: ${res.error}`);
  }
  if (res.result === null || res.result === undefined) {
    return {};
  }
  return JSON.parse(res.result as string) as MemberMap;
}

async function saveRegistry(
  deps: RegistryDeps,
  map: MemberMap,
): Promise<void> {
  const res = await deps.redis.execute([
    "SET",
    REGISTRY_KEY,
    JSON.stringify(map),
  ]);
  if (res.error !== undefined) {
    throw new Error(`Redis error saving registry: ${res.error}`);
  }
}

export async function getMember(
  deps: RegistryDeps,
  chatId: number,
): Promise<FamilyMember | null> {
  const map = await loadRegistry(deps);
  const found = Object.values(map).find((m) => m.chatId === chatId);
  return found ?? null;
}

export async function getAllMembers(
  deps: RegistryDeps,
): Promise<FamilyMember[]> {
  const map = await loadRegistry(deps);
  return Object.values(map);
}

export async function upsertMember(
  deps: RegistryDeps,
  member: FamilyMember,
): Promise<void> {
  const map = await loadRegistry(deps);
  map[member.id] = member;
  await saveRegistry(deps, map);
}

export async function isAdmin(
  deps: RegistryDeps,
  chatId: number,
): Promise<boolean> {
  const member = await getMember(deps, chatId);
  return member?.isAdmin === true;
}
