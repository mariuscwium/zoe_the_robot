/**
 * Google OAuth2 helpers for per-member calendar tokens.
 * Redis keys: oauth:google:<memberId>, oauth:state:<state>
 */

import type { RedisClient } from "./deps.js";

interface OAuthDeps {
  redis: RedisClient;
}

interface MemberTokens {
  refreshToken: string;
}

interface OAuthState {
  memberId: string;
  createdAt: string;
}

const OAUTH_KEY_PREFIX = "oauth:google:";
const STATE_KEY_PREFIX = "oauth:state:";
const STATE_TTL_SECONDS = 600;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export function buildConsentUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<{ refresh_token: string; access_token: string; expires_in: number }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  return (await res.json()) as { refresh_token: string; access_token: string; expires_in: number };
}

export async function storeMemberTokens(
  deps: OAuthDeps,
  memberId: string,
  refreshToken: string,
): Promise<void> {
  const data: MemberTokens = { refreshToken };
  const res = await deps.redis.execute([
    "SET",
    `${OAUTH_KEY_PREFIX}${memberId}`,
    JSON.stringify(data),
  ]);
  if (res.error) throw new Error(`Redis error storing tokens: ${res.error}`);
}

export async function loadMemberTokens(
  deps: OAuthDeps,
  memberId: string,
): Promise<MemberTokens | null> {
  const res = await deps.redis.execute([
    "GET",
    `${OAUTH_KEY_PREFIX}${memberId}`,
  ]);
  if (res.error) throw new Error(`Redis error loading tokens: ${res.error}`);
  if (res.result === null || res.result === undefined) return null;
  if (typeof res.result === "string") return JSON.parse(res.result) as MemberTokens;
  return res.result as MemberTokens;
}

export async function deleteMemberTokens(
  deps: OAuthDeps,
  memberId: string,
): Promise<void> {
  const res = await deps.redis.execute([
    "DEL",
    `${OAUTH_KEY_PREFIX}${memberId}`,
  ]);
  if (res.error) throw new Error(`Redis error deleting tokens: ${res.error}`);
}

export async function storeOAuthState(
  deps: OAuthDeps,
  state: string,
  memberId: string,
): Promise<void> {
  const data: OAuthState = { memberId, createdAt: new Date().toISOString() };
  const res = await deps.redis.execute([
    "SET",
    `${STATE_KEY_PREFIX}${state}`,
    JSON.stringify(data),
    "EX",
    String(STATE_TTL_SECONDS),
  ]);
  if (res.error) throw new Error(`Redis error storing state: ${res.error}`);
}

export async function lookupAndDeleteState(
  deps: OAuthDeps,
  state: string,
): Promise<OAuthState | null> {
  const key = `${STATE_KEY_PREFIX}${state}`;
  const res = await deps.redis.execute(["GET", key]);
  if (res.error) throw new Error(`Redis error looking up state: ${res.error}`);
  if (res.result === null || res.result === undefined) return null;
  await deps.redis.execute(["DEL", key]);
  if (typeof res.result === "string") return JSON.parse(res.result) as OAuthState;
  return res.result as OAuthState;
}
