# Project Status

**258 tests passing, 0 lint errors, 0 type errors.**

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
- **Google Calendar**: live — per-member OAuth2, tokens in Redis, family calendar connected
- **Debug UI**: not yet configured (needs password hash + JWT secret)

### Local Development

- `scripts/local-dev.ts` — standalone HTTP server (no Vercel CLI auth needed)
- Uses `dotenv` for `.env` loading and `undici` dispatcher fix for WSL2
- Cloudflared quick tunnel for exposing localhost to Telegram

### Issues Resolved During Deployment

- Upstash SDK auto-deserializes JSON — all Redis consumers now handle both string and object results
- Upstash SDK `.set()` doesn't accept positional `EX` args — use `SETEX` command instead
- Node 22 undici `autoSelectFamily` fails for some hosts in WSL2 — disabled in local dev server
- Vercel needs `outputDirectory: "."` for API-only projects (no static output)
- Vercel env vars set via `echo` get trailing newlines — use `printf '%s'` instead
- `VERCEL_URL` is per-deployment, not the stable alias — don't use for user-facing links
- Claude API rejects empty text content blocks — skip them for captionless photos
- Telegram sends `caption` not `text` for photo messages

## Live Features

- **Family registry**: whitelisted members via bootstrap, unknown chat IDs logged to audit
- **Conversation memory**: per-member history, shared family lists (shopping, todos), personal todos
- **Google Calendar**: live — per-member OAuth2, full CRUD (list, create, recurring, delete, find)
- **Telegram bot**: private chat only, text + image support, error handling
- **OAuth2 flow**: `/api/oauth/google` initiates consent, `/api/oauth/google/callback` completes

## Future Work (v2)

- Debug UI setup (password hash, JWT secret)
- Weekly cron for proactive check-ins (Vercel cron slot reserved)
- Holdout test suite (10 orchestrator-written scenarios)
- Production error monitoring / alerting
