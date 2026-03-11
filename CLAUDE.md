# Family Telegram Assistant

A shared family AI assistant via Telegram private chat. Whitelisted members
send messages/images → Claude agent interprets → replies via Telegram Bot API.

## Stack

TypeScript, Node.js, Vercel serverless, Telegram Bot API, Upstash Redis,
Google Calendar API (OAuth2), Anthropic `claude-sonnet-4-20250514` with Vision, npm.

## Project Structure

```
api/           Vercel serverless handlers (telegram, health, debug)
lib/           Core logic (agent, memory, calendar, registry, history, audit, telegram, datetime)
lib/debug-*    Debug UI (auth, api, dispatch, html, panels)
twins/         Digital twins — stateful behavioural clones of Redis, Telegram, Calendar
tools/         Claude tool definitions (schemas only)
scripts/       Bootstrap + local dev server
tests/         Integration scenario tests (Features 0–7)
docs/          RFC, Gherkin spec, ADRs, conventions, status
```

## Commands

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest
npx tsx scripts/local-dev.ts  # Local dev server (no Vercel auth needed)
npm run bootstrap -- --chatid=111111 --name=Marius --timezone=Pacific/Auckland
```

## Key Docs

- **[docs/CONVENTIONS.md](docs/CONVENTIONS.md)** — code conventions, Redis keys, testing patterns
- **[docs/STATUS.md](docs/STATUS.md)** — build progress, next steps, future work
- **[docs/RFC-001-personal-assistant.md](docs/RFC-001-personal-assistant.md)** — full design spec
- **[docs/personal-assistant.feature](docs/personal-assistant.feature)** — Gherkin scenarios (source of truth for behaviour)
- **[docs/AGENT-TEAM-DESIGN.md](docs/AGENT-TEAM-DESIGN.md)** — implementation strategy, digital twin philosophy
- **[docs/adr/](docs/adr/)** — Architecture Decision Records (000–005)
- **[.env.example](.env.example)** — all required environment variables

## Design Decisions (do not change without discussion)

- **No Twilio/SMS** — Telegram Bot API only
- **No vector database** — Redis file-based memory is intentional (see RFC §6.5)
- **No weekly cron in v1** — deferred to v2; Vercel cron slot reserved
- **No group chat support** — private chats only by design
- **Bootstrap is idempotent** — merges registry, never overwrites existing members

## Documentation Gardening

After completing each implementation phase, review and update:
1. `docs/STATUS.md` — progress and next steps
2. `docs/CONVENTIONS.md` — if patterns changed
3. `docs/adr/` — new architectural decisions
4. RFC / Gherkin spec — flag deviations
