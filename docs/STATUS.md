# Project Status

**256 tests passing, 0 lint errors, 0 type errors.**

## Build Phases

| Phase | Status | Tests |
|-------|--------|-------|
| 0: Scaffolding | COMPLETE | — |
| 1: Digital Twins | COMPLETE | 80 |
| 2: Core Libraries | COMPLETE | 77 |
| 3: Integration | COMPLETE | 70 |
| 4: Scenario Tests | COMPLETE | 27 |
| 5: Production Wiring | COMPLETE | — |
| 6: Deployment | COMPLETE | — |

## Deployment (Phase 6)

- **Vercel**: deployed at `zoe-the-robot.vercel.app`, auto-deploys from GitHub `main`
- **GitHub**: `mariuscwium/zoe_the_robot` (public repo, pre-push hook guards secrets/PII)
- **Telegram**: bot is [@zoe_the_robot](https://t.me/zoe_the_robot) ("Zoe"), webhook → Vercel
- **Redis**: Upstash instance provisioned and bootstrapped
- **Google Calendar**: code complete — needs OAuth2 credentials in Vercel env vars
- **Debug UI**: not yet configured (needs password hash + JWT secret)

### Local Development

- `scripts/local-dev.ts` — standalone HTTP server (no Vercel CLI auth needed)
- Uses `dotenv` for `.env` loading and `undici` dispatcher fix for WSL2
- Cloudflared quick tunnel for exposing localhost to Telegram

### Issues Resolved During Deployment

- Upstash SDK auto-deserializes JSON — all Redis consumers now handle both string and object results
- Node 22 undici `autoSelectFamily` fails for some hosts in WSL2 — disabled in local dev server
- Vercel needs `outputDirectory: "."` for API-only projects (no static output)
- Google Calendar env vars made optional — stub client throws on use when not configured

## Live Features

- **Family registry**: whitelisted members via bootstrap, unknown chat IDs logged to audit
- **Conversation memory**: per-member history, shared family lists (shopping, todos), personal todos
- **Google Calendar**: full integration (list, create, recurring, delete, find) — awaiting OAuth2 credentials
- **Telegram bot**: private chat only, text + image support, error handling

## Future Work (v2)

- Google Calendar OAuth2 credential setup (all code is ready)
- Debug UI setup (password hash, JWT secret)
- Weekly cron for proactive check-ins (Vercel cron slot reserved)
- Holdout test suite (10 orchestrator-written scenarios)
- Production error monitoring / alerting
