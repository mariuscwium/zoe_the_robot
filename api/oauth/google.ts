/**
 * GET /api/oauth/google?member=<id>
 * Initiates the Google OAuth2 consent flow for a family member.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { getProdDeps } from "../../lib/prod-deps.js";
import { getMemberById } from "../../lib/registry.js";
import { storeOAuthState, buildConsentUrl } from "../../lib/oauth.js";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const memberId = req.query.member;
    if (typeof memberId !== "string" || memberId === "") {
      res.status(400).json({ error: "Missing member parameter" });
      return;
    }

    const deps = getProdDeps();
    const member = await getMemberById(deps, memberId);
    if (member === null) {
      res.status(404).json({ error: "Unknown member" });
      return;
    }

    const clientId = requireEnv("GOOGLE_CLIENT_ID");
    const redirectUri = requireEnv("GOOGLE_OAUTH_REDIRECT_URI");

    const state = randomUUID();
    await storeOAuthState(deps, state, memberId);

    const consentUrl = buildConsentUrl(clientId, redirectUri, state);
    res.setHeader("Location", consentUrl);
    res.status(302).end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
}
