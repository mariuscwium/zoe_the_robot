# Zoe the Robot

A family AI assistant that lives in your Telegram private chat. Zoe remembers things, manages shopping lists, handles calendar events, and keeps track of what matters to your family — all through natural conversation.

**Try it:** [@zoe_the_robot](https://t.me/zoe_the_robot)

## How It Works

```
You (Telegram) → Vercel serverless → Claude Sonnet → Vercel → You (Telegram)
                                        ↕
                                   Upstash Redis
                                (memory, history, registry)
                                        ↕
                                 Google Calendar
                              (per-member OAuth2)
```

Whitelisted family members send messages (text or photos) to Zoe via Telegram. Each message is processed by a Claude agent that can read/write persistent memory, manage calendar events, and maintain conversation history — then replies in plain text.

## Features

- **Persistent memory** — remembers things across conversations (shopping lists, preferences, notes)
- **Per-member context** — each family member gets their own conversation history and personal notes
- **Image understanding** — send photos and Zoe will interpret them (receipts, invites, etc.)
- **Calendar management** — full CRUD on Google Calendar (list, create, recurring, delete, find free time)
- **OAuth2 flow** — each family member connects their own Google account
- **Audit trail** — all interactions are logged for transparency
- **Admin controls** — add/remove family members, manage the registry

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22, TypeScript |
| Hosting | Vercel Serverless Functions |
| AI | Anthropic Claude Sonnet 4 (with Vision) |
| Messaging | Telegram Bot API |
| Storage | Upstash Redis (REST) |
| Calendar | Google Calendar API v3 (OAuth2, per-member) |

## Quick Start

### Prerequisites

- Node.js 22+
- A [Telegram bot](https://core.telegram.org/bots#botfather) token
- An [Upstash Redis](https://upstash.com) database
- An [Anthropic API](https://console.anthropic.com) key
- *(Optional)* Google Cloud OAuth2 credentials for calendar features

### Setup

```bash
# Clone and install
git clone https://github.com/mariuscwium/zoe_the_robot.git
cd zoe_the_robot
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Bootstrap your first family member
npm run bootstrap -- --chatid=<your-chat-id> --name=<your-name> --timezone=<your-tz>

# Run locally
npx tsx scripts/local-dev.ts

# Expose to Telegram (in another terminal)
cloudflared tunnel --url http://localhost:3000

# Register webhook
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<tunnel-url>/api/telegram","secret_token":"<secret>"}'
```

### Deploy to Vercel

Push to GitHub and import the repo in [Vercel](https://vercel.com). Add the environment variables from `.env.example` to the project settings. The `api/` directory is auto-detected as serverless functions.

## Project Structure

```
api/           Vercel serverless handlers (telegram, health, debug, oauth)
lib/           Core logic (agent, memory, calendar, registry, history, audit, telegram, datetime)
lib/debug-*    Debug UI (auth, api, dispatch, html, panels)
twins/         Digital twins — stateful test doubles for Redis, Telegram, Calendar
tools/         Claude tool definitions (schemas)
scripts/       Bootstrap + local dev server
tests/         Integration scenario tests (19 suites, 258 tests)
docs/          RFC, Gherkin spec, ADRs, conventions
```

## Testing

```bash
npm run typecheck    # Type checking
npm run lint         # Linting
npm test             # 258 tests via Vitest
```

All external dependencies are abstracted behind interfaces and tested using [digital twins](docs/adr/001-digital-twins-over-mocks.md) — stateful behavioural clones that replicate real service semantics without network calls.

## Architecture

See [docs/](docs/) for full documentation:

- [RFC-001](docs/RFC-001-personal-assistant.md) — design specification
- [Gherkin spec](docs/personal-assistant.feature) — behavioural scenarios
- [ADRs](docs/adr/) — architectural decision records
- [Conventions](docs/CONVENTIONS.md) — code patterns and Redis key namespace
- [Status](docs/STATUS.md) — build progress and next steps

## License

Private project. Not licensed for external use.
