/**
 * Debug UI authentication: bcrypt password verification, JWT sessions,
 * and IP-based lockout after repeated failures.
 */

import { compare } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { RedisClient, Clock } from "./deps.js";

export interface AuthDeps {
  redis: RedisClient;
  clock: Clock;
}

interface LockoutState {
  attempts: number;
  lockedUntil: number | null;
}

const LOCKOUT_THRESHOLD = 3;
const LOCKOUT_MS = 15 * 60 * 1000;
const JWT_EXPIRY = "24h";
const LOCKOUT_PREFIX = "debug:lockout:";

function lockoutKey(ip: string): string {
  return `${LOCKOUT_PREFIX}${ip}`;
}

async function loadLockout(
  deps: AuthDeps,
  ip: string,
): Promise<LockoutState> {
  const res = await deps.redis.execute(["GET", lockoutKey(ip)]);
  if (res.result === null || res.result === undefined) {
    return { attempts: 0, lockedUntil: null };
  }
  if (typeof res.result === "string") {
    return JSON.parse(res.result) as LockoutState;
  }
  return res.result as LockoutState;
}

async function saveLockout(
  deps: AuthDeps,
  ip: string,
  state: LockoutState,
): Promise<void> {
  await deps.redis.execute([
    "SET",
    lockoutKey(ip),
    JSON.stringify(state),
  ]);
}

export async function isLockedOut(
  deps: AuthDeps,
  ip: string,
): Promise<boolean> {
  const state = await loadLockout(deps, ip);
  if (state.lockedUntil === null) return false;
  return deps.clock.now().getTime() < state.lockedUntil;
}

export async function recordFailedAttempt(
  deps: AuthDeps,
  ip: string,
): Promise<boolean> {
  const state = await loadLockout(deps, ip);
  state.attempts += 1;
  if (state.attempts >= LOCKOUT_THRESHOLD) {
    state.lockedUntil = deps.clock.now().getTime() + LOCKOUT_MS;
  }
  await saveLockout(deps, ip, state);
  return state.attempts >= LOCKOUT_THRESHOLD;
}

export async function resetLockout(
  deps: AuthDeps,
  ip: string,
): Promise<void> {
  await deps.redis.execute(["DEL", lockoutKey(ip)]);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return compare(password, hash);
}

export async function signToken(
  secret: string,
  clock: Clock,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ iat: Math.floor(clock.now().getTime() / 1000) })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(JWT_EXPIRY)
    .sign(key);
}

export async function verifyToken(
  token: string,
  secret: string,
): Promise<boolean> {
  try {
    const key = new TextEncoder().encode(secret);
    await jwtVerify(token, key);
    return true;
  } catch {
    return false;
  }
}

export function parseCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (header === undefined) return null;
  const prefix = `${name}=`;
  const match = header.split(";").find((c) => c.trim().startsWith(prefix));
  if (match === undefined) return null;
  return match.trim().slice(prefix.length);
}

export function extractIp(
  forwarded: string | string[] | undefined,
  fallback: string,
): string {
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim() ?? fallback;
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]?.trim() ?? fallback;
  }
  return fallback;
}
