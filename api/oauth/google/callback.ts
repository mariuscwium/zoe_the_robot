/**
 * GET /api/oauth/google/callback?code=...&state=...
 * Completes the OAuth2 flow: exchanges code for tokens, stores in Redis,
 * notifies the member via Telegram.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getProdDeps } from "../../../lib/prod-deps.js";
import { getMemberById } from "../../../lib/registry.js";
import {
  lookupAndDeleteState,
  exchangeCode,
  storeMemberTokens,
} from "../../../lib/oauth.js";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><title>Connected</title></head>
<body style="font-family:sans-serif;text-align:center;padding:60px">
<h1>Google Calendar connected!</h1>
<p>You can close this tab and go back to Telegram.</p>
</body></html>`;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const code = req.query.code;
  const state = req.query.state;
  if (typeof code !== "string" || typeof state !== "string") {
    res.status(400).json({ error: "Missing code or state" });
    return;
  }

  const deps = getProdDeps();

  const oauthState = await lookupAndDeleteState(deps, state);
  if (oauthState === null) {
    res.status(400).json({ error: "Invalid or expired state" });
    return;
  }

  const member = await getMemberById(deps, oauthState.memberId);
  if (member === null) {
    res.status(404).json({ error: "Unknown member" });
    return;
  }

  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = requireEnv("GOOGLE_OAUTH_REDIRECT_URI");

  const tokens = await exchangeCode(clientId, clientSecret, code, redirectUri);
  if (!tokens.refresh_token) {
    res.status(400).json({ error: "No refresh token returned", debug: tokens });
    return;
  }

  await storeMemberTokens(deps, oauthState.memberId, tokens.refresh_token);

  await deps.telegram.sendMessage(
    member.chatId,
    "Your Google Calendar is now connected! You can use calendar commands.",
  );

  res.setHeader("Content-Type", "text/html");
  res.status(200).send(SUCCESS_HTML);
}
