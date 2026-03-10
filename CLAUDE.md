# Family Telegram Assistant

A shared family AI assistant operated via Telegram private chat. A bot receives
messages and images from whitelisted family members (identified by Telegram `chat_id`),
invokes a Claude agent to interpret them, and replies via the Telegram Bot API.

## Stack

- **Runtime:** TypeScript, Node.js
- **Hosting:** Vercel (serverless functions)
- **Messaging:** Telegram Bot API (webhook mode, private chats only)
- **Storage:** Upstash Redis (REST API) — all memory as markdown strings
- **Calendar:** Google Calendar API (OAuth2 refresh token)
- **AI:** Anthropic API — `claude-sonnet-4-20250514` with Vision
- **Package manager:** npm

## Project Structure

```
/
├── api/
│   ├── telegram.ts        # Telegram webhook handler (POST)
│   ├── health.ts          # Health check (GET)
│   └── debug.ts           # Password-protected debug UI (GET /{DEBUG_PATH})
├── lib/
│   ├── deps.ts            # Dependency injection interfaces (Redis, Telegram, Calendar, Claude, Clock)
│   ├── types.ts           # Domain types (FamilyMember, AuditEntry, ToolResult, etc.)
│   ├── registry.ts        # Member registry (whitelist) — Redis
│   ├── history.ts         # Per-member conversation history — Redis
│   ├── memory.ts          # Memory tool implementations — Redis
│   ├── calendar.ts        # Google Calendar tool implementations
│   ├── agent.ts           # Claude agent invocation + tool loop
│   ├── datetime.ts        # Server-side datetime pre-processing
│   ├── audit.ts           # Audit log append
│   └── telegram.ts        # Telegram API helpers (sendMessage, getFile)
├── twins/
│   ├── redis.ts           # Redis digital twin (stateful behavioral clone)
│   ├── redis-types.ts     # Redis twin shared types and helpers
│   ├── redis-strings.ts   # Redis string command handlers
│   ├── redis-keys.ts      # Redis key management handlers
│   ├── redis-lists.ts     # Redis list command handlers
│   ├── telegram.ts        # Telegram Bot API digital twin
│   ├── calendar.ts        # Google Calendar API digital twin
│   └── calendar-rrule.ts  # RRULE expansion logic for calendar twin
├── tools/
│   └── index.ts           # All Claude tool definitions (schemas only)
├── scripts/
│   └── bootstrap.ts       # Idempotent deploy script (registry init + webhook registration)
├── docs/
│   ├── adr/               # Architecture Decision Records
│   ├── RFC-001-personal-assistant.md
│   ├── personal-assistant.feature
│   └── AGENT-TEAM-DESIGN.md
├── CLAUDE.md
├── .env.example
├── vercel.json
└── tsconfig.json
```

## Architecture

- **Webhook** (`POST /api/telegram`): validates secret token → checks `chat.type === "private"` → whitelist check by `chat_id` → admin `/commands` → download image if MMS → load history → datetime pre-process → invoke Claude agent → save history → append incoming log → reply
- **Agent loop:** max 8 tool calls, `claude-sonnet-4-20250514`, plain text replies only
- **Memory:** Upstash Redis, markdown strings, keyed by logical path (`memory:family:todos` etc.) — no public URLs, no vector DB
- **Reminders:** Google Calendar events with native `reminders.overrides` alarms — no custom reminder cron
- **Authorship:** injected server-side in all mutating tool wrappers — Claude never writes authorship
- **Confirmation gate:** `confirm_action` tool required before any destructive action or bulk calendar creation (4+ events from one image)

## Key Conventions

- All tool implementations live in `lib/`, tool *definitions* (schemas) live in `tools/index.ts`
- Redis key namespace: `memory:family:*` (shared), `memory:members:<id>:*` (personal), `conversation:<id>`, `registry:members`, `log:incoming`, `pending_confirm:<id>`
- Every mutating tool wrapper calls `audit.append()` after execution — never inside the agent prompt
- `chat_id` is the sole identity key — no phone numbers stored anywhere
- Images are never persisted: download from Telegram → base64 in memory → pass to Claude → discard
- Group chats silently rejected (`chat.type !== "private"` → HTTP 200, no reply, no log)
- Replies are plain text only — no markdown formatting sent to Telegram users

## Environment Variables

See `.env.example` for all required variables. Key ones:
- `TELEGRAM_BOT_TOKEN` — from @BotFather
- `TELEGRAM_WEBHOOK_SECRET` — set on webhook registration
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- `ANTHROPIC_API_KEY`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` / `GOOGLE_CALENDAR_ID`
- `DEBUG_PATH` / `DEBUG_PASSWORD_HASH` / `DEBUG_JWT_SECRET`

## Commands

```bash
npm run dev          # Vercel dev server (local)
npm run build        # TypeScript compile check
npm run bootstrap    # Register webhook + initialise registry (idempotent, run after every deploy)
npm run typecheck    # tsc --noEmit
```

Bootstrap requires `--chatid`, `--name`, `--timezone` args on first run:
```bash
npm run bootstrap -- --chatid=111111 --name=Marius --timezone=Pacific/Auckland
```

## Design Decisions (do not change without discussion)

- **No Twilio/SMS** — Telegram Bot API only
- **No vector database / Mem0 / Zep** — Redis file-based memory is intentional; see RFC §6.5
- **No weekly cron in v1** — deferred to v2; the Vercel cron slot is reserved
- **No group chat support** — private chats only by design
- **Memory docs are private** — never generate or imply a public URL for any Redis key
- **Bootstrap is idempotent** — merges registry, never overwrites existing members
- **Recurring calendar events** are deletable via a single chat message (agent calls `delete_calendar_event` on the full series after `confirm_action`)

## RFC & Spec

Full design decisions, data model, and Gherkin feature specs are in:
- `docs/RFC-001-personal-assistant.md`
- `docs/personal-assistant.feature`

When implementing a feature, read the relevant Gherkin scenarios first — they are the source of truth for behaviour.

## Architecture Decision Records

ADRs live in `docs/adr/NNN-slug.md`. See `docs/adr/000-use-adrs.md` for the format.

When making a non-obvious architectural decision during implementation:
1. Create a new ADR with the next available number
2. Record the context, decision, and consequences
3. If reversing a previous decision, write a new ADR that supersedes the old one (don't edit the original)

## Documentation Gardening

After completing each implementation phase, review and update docs to stay in sync:

1. **CLAUDE.md** — update project structure tree, commands, and conventions if they changed
2. **RFC** — mark sections as implemented; flag any deviations from the original design
3. **Feature spec** — if implementation differs from a Gherkin scenario, update the scenario or file an ADR explaining why
4. **AGENT-TEAM-DESIGN.md** — update phase status, twin coverage, and any new patterns discovered
5. **ADRs** — capture any new architectural decisions made during the phase
