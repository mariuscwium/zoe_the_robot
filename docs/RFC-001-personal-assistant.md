# RFC-001: Family Telegram Assistant Agent

**Status:** Draft  
**Author:** Marius  
**Revised:** 2025-03-10 — v6: all open questions resolved; weekly digest deferred to v2; group chats excluded; memory system decision documented; bootstrap script confirmed; incoming log stores full text  
**Stack:** TypeScript · Vercel · Telegram Bot API · Upstash Redis · Google Calendar API · Anthropic API (Vision)

---

## Table of Contents

1. [Summary](#1-summary)
2. [Problem](#2-problem)
3. [Goals & Non-Goals](#3-goals--non-goals)
4. [System Overview](#4-system-overview)
5. [Component Design](#5-component-design)
   - 5.1 Family Member Registry (Whitelist)
   - 5.2 Telegram Webhook Ingestion
   - 5.3 Conversation History (per member)
   - 5.4 Image & File Ingestion via Telegram
   - 5.5 Claude Agent & Tool Definitions
   - 5.6 Datetime Resolution Layer
   - 5.7 Memory Layer & Document Store
   - 5.8 Google Calendar Integration (with Native Reminders)
   - 5.9 Audit Log
   - 5.10 Debug Interface
6. [Alternatives Considered](#6-alternatives-considered)
7. [Data Model](#7-data-model)
8. [Security Considerations](#8-security-considerations)
9. [Operational Considerations](#9-operational-considerations)
10. [Deferred to v2](#10-deferred-to-v2)

---

## 1. Summary

A family AI assistant operated entirely via Telegram private chat. A bot receives messages and images from whitelisted family members, identified by their stable Telegram `chat_id`. Claude interprets each message, calls tools to manage shared memory, todos, shopping, and a Google Calendar, and replies via the Telegram Bot API. All memory is stored in Upstash Redis as human-readable markdown documents — no vector database, no third-party memory service. A password-protected debug UI provides maintenance access. Twilio and all SMS/MMS infrastructure are absent from the design.

---

## 2. Problem

A family AI assistant needs a messaging transport, a memory layer, and an identity system. SMS (Twilio) was the original candidate but has meaningful drawbacks: per-message cost, plaintext over carrier networks, and phone numbers as identity. Telegram provides a free encrypted-at-rest channel with native image support and stable numeric `chat_id` identity. For the memory layer, dedicated agent memory systems (Mem0, Zep, Letta) exist but require persistent infrastructure incompatible with Vercel's serverless model, and solve problems — semantic retrieval across millions of interactions, knowledge graphs, memory decay — that a family assistant at small scale doesn't have. A file-based approach on Upstash Redis is simpler, transparent, debuggable, and sufficient.

---

## 3. Goals & Non-Goals

### Goals

- Accept text and images from registered family members via Telegram private chat only
- Use Telegram `chat_id` as the sole identity key — no phone numbers stored anywhere
- Process images autonomously with Claude Vision; ask for confirmation only when a single image yields many calendar events
- Store all memory in Upstash Redis as human-readable markdown — no public URLs, no vector database
- Use Google Calendar native reminders for all time-based alerts
- Maintain per-member conversation history for natural multi-turn exchanges
- Require confirmation before destructive actions and before bulk calendar creation
- Log all mutations to a family audit trail
- Provide a password-protected debug UI at a hidden route
- Zero per-message cost for the messaging layer
- Bootstrap via deployment script on every deployment

### Non-Goals

- Telegram group chats (private chats only — group chats are too noisy for other participants)
- Weekly digest (deferred to v2)
- SMS or WhatsApp integration
- Public URLs for any memory content
- Dedicated agent memory systems (Mem0, Zep, Letta) — see §6.5
- Permission tiers (all registered members have equal access)
- Email integration

---

## 4. System Overview

```
Family Member's Telegram App (private chat only)
     │  Text or Photo
     ▼
  Telegram Bot API
     │  Webhook POST /api/telegram
     │  Header: X-Telegram-Bot-Api-Secret-Token
     ▼
Vercel Serverless Function
     │
     ├──► Webhook Secret Validation
     ├──► Private chat check (reject group/channel updates silently)
     ├──► Whitelist Check → Registry (Redis, keyed by chat_id)
     │         └── reject silently if chat_id not found
     ├──► Admin Command Check (/ prefix, admin only)
     ├──► Media Detection → getFile → download → base64 in memory
     ├──► Load Conversation History (Redis, rolling 10 turns, 7-day TTL)
     ├──► Datetime Resolution (server-side pre-processing)
     │
     ▼
Claude Agent (claude-sonnet-4 + Vision)
     │  Context: identity + family context + history + image (if present)
     │  Tool calls (agentic loop, max 8)
     ├──► Memory Tools ──────────► Upstash Redis (private, no public URLs)
     │         ├── memory:family:todos
     │         ├── memory:family:shopping
     │         ├── memory:family:context
     │         ├── memory:family:log
     │         ├── memory:family:docs:<slug>
     │         ├── memory:family:notes:*
     │         └── memory:members:<id>:*
     ├──► Calendar Tools ─────────► Google Calendar API
     └──► Telegram Tools ─────────► Bot API sendMessage
               ├── reply to sender (chat_id)
               └── notify other members by chat_id (on explicit request only)

     ┌─── Debug UI ──► GET /{DEBUG_PATH} (hidden, password-protected)
     │         ├── Memory file browser (read/edit)
     │         ├── Conversation history per member
     │         ├── Audit log viewer
     │         └── Incoming message log (full text)
```

---

## 5. Component Design

### 5.1 Family Member Registry (Whitelist)

The registry maps Telegram `chat_id` values to member profiles. It is the sole access control mechanism. No phone numbers are stored anywhere in the system.

**Member profile schema:**

```typescript
type FamilyMember = {
  id: string;           // slug: "marius", "sarah"
  name: string;
  chatId: number;       // Telegram chat_id — stable numeric identity
  timezone: string;     // IANA: "Pacific/Auckland"
  role: string;         // "parent" | "teenager" — tone hint only
  isAdmin: boolean;
  preferences?: string;
};
```

**Bootstrap (deployment script):**
The registry is initialised on every deployment via `npm run bootstrap`. The script accepts the admin's `chat_id` as a parameter (read from the first webhook update in the debug UI incoming log), writes the initial registry JSON to Redis, and is idempotent — re-running it updates the admin entry without wiping other members.

```bash
npm run bootstrap -- --chatid=111111 --name=Marius --timezone=Pacific/Auckland
```

The script is safe to re-run on every deployment because it merges rather than overwrites. Suitable for a Vercel post-deploy hook.

**Admin slash commands** (server-side only, never reach Claude):

| Command | Effect |
|---|---|
| `/add-member id:sarah name:Sarah chatid:222222 timezone:Pacific/Auckland role:parent` | Add member |
| `/remove-member sarah` | Remove member |
| `/list-members` | Reply with current registry |
| `/update-member sarah preferences:prefers short replies` | Update a field |

**Group chat rejection:**
The webhook checks `update.message.chat.type` on every update. Any value other than `"private"` is silently dropped — HTTP 200, no reply, no logging. The bot does not respond in group chats, channels, or supergroups, regardless of whether the sender's `chat_id` is registered.

---

### 5.2 Telegram Webhook Ingestion

**Endpoint:** `POST /api/telegram`

**Webhook registration (run once, or re-run in bootstrap script):**
```
POST https://api.telegram.org/bot{TOKEN}/setWebhook
{
  "url": "https://your-app.vercel.app/api/telegram",
  "secret_token": "{TELEGRAM_WEBHOOK_SECRET}",
  "allowed_updates": ["message"]
}
```

`allowed_updates: ["message"]` suppresses channel posts, inline queries, and callback queries that the bot doesn't handle, reducing unnecessary invocations.

**Processing order:**
1. Validate `X-Telegram-Bot-Api-Secret-Token` → 403 if invalid
2. Extract `chat_id` from `update.message.from.id` and `chat.type` from `update.message.chat.type`
3. Reject silently if `chat.type !== "private"` → HTTP 200, no reply
4. Whitelist check → silent HTTP 200 if `chat_id` not found
5. Admin `/command` check → handle and return early if matched
6. If `message.photo` or `message.document`: call `getFile`, download from Telegram file API, base64-encode in memory
7. Load sender's conversation history from Redis
8. Datetime pre-processing on text body
9. Invoke Claude agent (with image if present)
10. Save updated conversation history
11. Append to incoming message log (full message text, sender id, type, timestamp)
12. Send reply via `sendMessage` to sender's `chat_id`
13. Return HTTP 200

**Incoming message log:**
Full message text is stored in `log:incoming`. This is the highest-PII data in the system and is accessible only via the authenticated debug UI. The log is trimmed to the most recent 500 entries by the bootstrap script on each deployment (and can also be trimmed manually via the debug UI).

**Timeout:** If the agent hasn't responded in 25s, send an interim "Still working on it..." message and continue async.

---

### 5.3 Conversation History (per member)

Rolling 10-turn window at `conversation:<member_id>`, 7-day TTL. Image turns store a text summary post-processing rather than raw base64, keeping token cost low. Full details unchanged from v5.

---

### 5.4 Image & File Ingestion via Telegram

**Standard images (single event / single actionable item):**
Claude extracts content and acts autonomously. The sender receives a plain-text summary of what was done.

**Multi-event images (e.g. a term calendar with many events):**
If Claude detects more than ~3 calendar events in a single image, it does not create them autonomously. Instead it summarises what it found and asks the sender to confirm before proceeding:

> "I can see 8 events in that calendar: [list]. Shall I add all of them to the family calendar? Reply YES to confirm."

A `pending_confirm` key is set in Redis. If the sender replies YES, the agent creates all events. Any other reply cancels. This prevents a single accidental image from flooding the calendar.

**Threshold for confirmation:** Claude uses judgement here — 1–3 calendar events from a single image proceed automatically; 4+ trigger confirmation. This is a prompt instruction, not a hard-coded count.

**Content type → action mapping:**

| Detected content | Action |
|---|---|
| 1–3 calendar events | Create autonomously with alarms |
| 4+ calendar events | Summarise and ask for YES confirmation |
| Packing list / trip detail | Create calendar event + create linked memory doc |
| Deadline / reminder | Create calendar event with alarm at notified time |
| Shopping items | Add to shopping list |
| General info / flyer | Create memory doc, summarise to sender |
| Ambiguous | Describe what was seen, ask for direction |

**Image never persisted.** Downloaded from Telegram's authenticated file API, base64-encoded in memory, passed to Claude, discarded. The Telegram `file_path` URL is time-limited and requires the bot token to access.

---

### 5.5 Claude Agent & Tool Definitions

**Model:** `claude-sonnet-4-20250514`  
**Max tokens:** 1024  
**Tool loop:** Max 8 tool calls.

**System Prompt (abbreviated):**
```
You are a shared family assistant on Telegram.
You are speaking with {member.name} ({member.role}).
Timezone: {member.timezone}. Current local time: {resolvedNow}.

Family members: {member list}
Family context: {memory:family:context}
{member.name}'s context: {memory:members:{id}:context}

Rules:
- Plain text only. No markdown formatting in replies.
- Be concise. Use the sender's first name.
- Authorship is injected server-side — never add it yourself.
- Before deleting or bulk-modifying, call confirm_action first.
- Only notify other members if explicitly asked.
- When you receive an image with 1–3 calendar events, create them immediately.
  When you detect 4 or more calendar events in a single image, summarise
  them and ask for YES confirmation before creating any.
- For all other image content, extract and act immediately.
- All reminders must be created as Google Calendar events with native alarms.
- Memory docs are private. Never mention or imply a URL. Tell members to
  ask the assistant to retrieve content.
- You are only reachable via private Telegram chat.
```

**Tool Registry:**

| Tool | Description | Scope | Mutates |
|---|---|---|---|
| `read_memory` | Read a memory file or doc | shared or personal | No |
| `write_memory` | Overwrite a memory file or doc | shared or personal | Yes |
| `append_memory` | Append to a memory file | shared or personal | Yes |
| `list_memory_files` | List all memory paths | both | No |
| `search_memory` | Full-text scan across all memory keys | both | No |
| `create_doc` | Create a named structured memory document | shared | Yes |
| `add_todo` | Add a todo with author tag | shared | Yes |
| `complete_todo` | Mark todo done, record completer | shared | Yes |
| `add_shopping_item` | Add item to shopping list | shared | Yes |
| `remove_shopping_item` | Remove shopping item | shared | Yes |
| `get_calendar_events` | Query upcoming family events | shared | No |
| `create_calendar_event` | Create event with author + optional alarm | shared | Yes |
| `delete_calendar_event` | Delete event by ID | shared | Yes |
| `confirm_action` | Gate: send confirmation message, await YES | — | No |
| `notify_member` | Send Telegram message to named member by chat_id | — | Yes |
| `list_members` | List family members | — | No |

**`confirm_action` covers:**
- Destructive operations (delete event, overwrite memory doc)
- Bulk calendar creation from images (4+ events)
- Any operation the agent deems sufficiently consequential

**Recurring events:**
Recurring Google Calendar events created by the assistant (e.g. "remind me to take medication daily") are deletable via a single message. The sender can say "cancel my daily medication reminder" and the agent calls `confirm_action` then `delete_calendar_event` on the full recurring series. Members do not need to manage these in Google Calendar directly.

---

### 5.6 Datetime Resolution Layer

Server-side pre-processing resolves natural-language datetime expressions to ISO 8601 before the main agent call, using the sender's IANA timezone and the `Intl` API for DST-safe arithmetic. A regex pre-screen skips the call when no temporal content is detected.

---

### 5.7 Memory Layer & Document Store

**Design decision: Redis file-based storage, not a dedicated agent memory system.**

Dedicated agent memory systems (Mem0, Zep, Letta) are designed for semantic retrieval across large, unstructured memory stores — extracting facts automatically from conversations, deduplicating them, building knowledge graphs, and retrieving them by semantic similarity. They solve real problems for large-scale deployments.

For this system, they are the wrong tool. The family assistant's memory is intentionally structured and small: named documents (todos, shopping, packing lists, extracted docs), a family context blob, per-member context notes. Members refer to memory by name, not by semantic similarity. There is no retrieval problem — the agent looks up `family/todos` or `family/docs/school-camp-march-2025` directly. The self-hosted versions of these systems also require persistent Docker infrastructure incompatible with Vercel serverless; the managed versions add cost and put family conversation data on a third-party platform.

**Implementation:** Upstash Redis, markdown strings as values, keyed by logical path. Human-readable, editable in the debug UI, debuggable without tooling.

**Namespace:**

| Logical Path | Redis Key | Scope |
|---|---|---|
| `family/todos` | `memory:family:todos` | Shared |
| `family/shopping` | `memory:family:shopping` | Shared |
| `family/context` | `memory:family:context` | Shared |
| `family/log` | `memory:family:log` | Shared (audit) |
| `family/docs/_index` | `memory:family:docs:_index` | Shared (doc index) |
| `family/docs/<slug>` | `memory:family:docs:<slug>` | Shared |
| `family/notes/*` | `memory:family:notes:*` | Shared |
| `archive/todos-YYYY-MM` | `memory:archive:todos-YYYY-MM` | Shared |
| `archive/log-YYYY-MM` | `memory:archive:log-YYYY-MM` | Shared |
| `members/<id>/context` | `memory:members:<id>:context` | Personal |
| `members/<id>/notes/*` | `memory:members:<id>:notes:*` | Personal |

**No public URLs.** All memory is private to the Redis keyspace. Access is exclusively via the agent (Telegram) or the authenticated debug UI.

**Doc TTL:** Memory docs are retained indefinitely. Deletion is explicit — via the agent (with `confirm_action`) or via the debug UI.

---

### 5.8 Google Calendar Integration (with Native Reminders)

All reminders are Google Calendar events with native `reminders.overrides` alarm blocks. No custom reminder cron. Recurring reminders use `RRULE`. Full details unchanged from v5.

**One addition:** Recurring events created by the assistant are deletable via a single conversational message. The agent calls `confirm_action` confirming the full series will be deleted, then `delete_calendar_event` with the series event ID. Members do not need Google Calendar app access to manage bot-created reminders.

---

### 5.9 Audit Log

Every mutating tool call appends to `memory:family:log` server-side, independent of Claude. Format:

```
2025-03-10T09:14:22+13:00 | Marius | add_todo | "Renew car registration — due 2025-04-30"
2025-03-10T11:03:07+13:00 | Sarah | create_doc | "school-camp-march-2025"
2025-03-10T14:22:55+13:00 | Marius | complete_todo | "Call insurance"
2025-03-10T14:23:01+13:00 | DEBUG | write_memory | "family/todos" (via debug UI)
```

Family members can query it via the agent ("who added the school camp?"). The debug UI exposes it directly. Entries older than 30 days are archived to `memory:archive:log-YYYY-MM` — this archiving is triggered manually from the debug UI in v1 (the weekly cron that previously handled it is deferred to v2).

---

### 5.10 Debug Interface

A password-protected single-page UI at a non-discoverable route. The only web interface in the system.

**Route:** `GET /{DEBUG_PATH}` where `DEBUG_PATH` is an env-configured non-guessable slug.

**Authentication:** bcrypt password → httpOnly signed JWT cookie (24hr) → IP lockout after 3 failed attempts (15-minute cooldown). All `/debug/*` API routes validate the session token independently.

**Panels:**

*Memory File Browser*
Tree view of all `memory:*` keys. Click to view content as rendered markdown. Edit button opens a textarea — save writes to Redis and appends an audit log entry. Delete button with confirmation dialog removes the key.

*Conversation History*
Member dropdown. Displays rolling transcript. Image turns shown as `[Image: <summary>]`. Clear button wipes `conversation:<member_id>` with confirmation.

*Audit Log Viewer*
Paginated, reverse chronological. Filter by member name or action type. Read-only.

*Incoming Message Log*
Paginated list from `log:incoming`. Each entry: timestamp, member name, message type, full message text. Click to expand. If a message included an image, a thumbnail is shown from the base64 data still in conversation history. Read-only. A "Trim to 500" button is available for manual housekeeping.

**Manual archive trigger:**
A button in the Audit Log panel triggers the archive operation (move entries >30 days to `memory:archive:log-YYYY-MM`). This replaces the weekly cron's archive step in v1.

**Implementation:** Single-file vanilla HTML/CSS/JS served from one Vercel function. No framework dependency.

---

## 6. Alternatives Considered

### 6.1 Telegram vs SMS/Twilio

Twilio removed in v5. Telegram chosen: zero per-message cost, server-side encryption, `chat_id` identity with no PII, native image/file support, cleaner webhook API. Full rationale in v5 RFC.

### 6.2 Telegram Webhook vs Long-Polling

Long-polling requires a persistent process — incompatible with Vercel serverless. Webhook mode chosen.

### 6.3 identity: chat_id vs Username vs Phone Number

`chat_id` is stable for the lifetime of the account, never changes, never reused, requires no user action to obtain. Usernames can be changed. Phone numbers aren't exposed to bots without an explicit share step. `chat_id` chosen.

### 6.4 Group Chats: Included vs Private-Only

Group chats would allow the bot to respond to all group members at once, but this introduces noise for non-participants and complicates the access control model (group `chat_id` values are negative integers with different membership semantics). Private chats only — simpler, less noisy, clearer identity model.

### 6.5 Memory System: Dedicated Agent Memory vs Redis File-Based

**Mem0 (self-hosted)**

*Pros:* Semantic retrieval; automatic fact extraction from conversations; deduplication; memory decay.  
*Cons:* Requires three persistent Docker containers (FastAPI + pgvector + Neo4j) — incompatible with Vercel serverless. Self-hosting adds significant ops overhead. Solves retrieval problems this system doesn't have.

**Mem0 (managed platform)**

*Pros:* No self-hosting; simple SDK integration.  
*Cons:* $19/month Starter tier minimum. Family conversation data sent to a third-party platform. Graph memory, webhooks, and analytics (the differentiating features) are platform-only.

**Zep / Letta**

Similar tradeoffs to Mem0 self-hosted. Enterprise-oriented, heavier infrastructure, solving problems at a scale irrelevant here.

**Redis file-based (chosen)**

The family assistant's memory is structured and small. Members reference memory by name ("the school camp doc", "the shopping list"). There is no semantic retrieval problem. Markdown strings in Upstash Redis are transparent, directly editable in the debug UI, free within the existing tier, serverless-compatible, and keep all data within the existing private infrastructure. The right level of complexity for the problem.

### 6.6 Weekly Digest: v1 vs v2

Removed from v1 scope. The cron job, per-member digest logic, and associated Gherkin features are deferred. The Vercel cron slot remains available.

### 6.7 Debug Auth: Password vs OAuth

bcrypt password + signed JWT cookie + IP lockout. Adequate for an occasional-use internal tool without financial data. OAuth adds a registered app dependency for marginal security gain.

### 6.8 Memory Doc TTL: Expiry vs Indefinite

Docs retained indefinitely. Explicit deletion only (via agent with `confirm_action`, or via debug UI). Automatic expiry would silently delete information members intended to keep.

### 6.9 Incoming Message Log: Metadata-only vs Full Text

Full message text stored. The debug UI is the only place this data is accessible (behind auth). The privacy cost is low relative to the debugging value — being able to see exactly what a member sent when diagnosing a tool call failure is essential.

### 6.10 Bootstrap: One-time vs Repeated Deployment Script

Deployment script on every deployment, idempotent (merge, not overwrite). This ensures webhook registration, initial registry structure, and any future bootstrap-time setup steps stay consistent across deployments without manual intervention.

---

## 7. Data Model

### Redis Keys

| Key Pattern | Type | Content |
|---|---|---|
| `registry:members` | JSON | Array of FamilyMember objects |
| `conversation:<member_id>` | JSON | Rolling 10-turn history |
| `pending_confirm:<member_id>` | JSON | Pending confirm (5-min TTL) |
| `log:incoming` | String | Appended log of inbound Telegram updates (full text) |
| `debug:lockout:<ip>` | JSON | Failed login counter + lockout expiry |
| `memory:family:todos` | String | Shared todo list |
| `memory:family:shopping` | String | Shared shopping list |
| `memory:family:context` | String | Shared family profile |
| `memory:family:log` | String | Audit log |
| `memory:family:docs:_index` | String | Doc index |
| `memory:family:docs:<slug>` | String | Extracted memory documents |
| `memory:family:notes:*` | String | Shared freeform notes |
| `memory:archive:todos-YYYY-MM` | String | Archived completed todos |
| `memory:archive:log-YYYY-MM` | String | Archived audit log |
| `memory:members:<id>:context` | String | Per-member context |
| `memory:members:<id>:notes:*` | String | Per-member notes |

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | Secret token for webhook validation |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash auth token |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Yes | Long-lived OAuth refresh token |
| `GOOGLE_CALENDAR_ID` | Yes | Shared family calendar ID |
| `DEBUG_PATH` | Yes | Non-discoverable path slug |
| `DEBUG_PASSWORD_HASH` | Yes | bcrypt hash of debug UI password |
| `DEBUG_JWT_SECRET` | Yes | JWT signing secret |

**Removed from v5:** `CRON_SECRET` (no cron in v1).

---

## 8. Security Considerations

**Webhook validation:** `X-Telegram-Bot-Api-Secret-Token` header validated on every update. Invalid → HTTP 403.

**Private chat enforcement:** `chat.type !== "private"` → silent HTTP 200. No group chat access regardless of `chat_id` registration status.

**Whitelist as registry:** Unknown `chat_id` → silent HTTP 200, no reply, no logging.

**No phone numbers in the system:** Registry contains `chat_id` only. No PII.

**Memory privacy by construction:** All memory in Upstash Redis. No public URLs. No blob storage.

**Image handling:** Images downloaded from Telegram's authenticated file API (requires bot token), never persisted, discarded after the agent response.

**Authorship injection:** `member.id` injected server-side into all mutating tool wrappers.

**Destructive confirmation gate:** `confirm_action` required before deletions, overwrites, and bulk calendar creation (4+ events from image).

**Debug UI hardening:** Non-discoverable route, bcrypt password, httpOnly JWT cookie, IP lockout, HTTPS via Vercel, all `/debug/*` routes validate session independently.

**Incoming log PII:** Full message text stored in `log:incoming`, accessible only via the authenticated debug UI. No phone numbers. Trimmed to 500 entries.

---

## 9. Operational Considerations

**Vercel Hobby tier:**
- 100,000 function invocations/month — one per Telegram update
- 1 cron slot available (unused in v1, reserved for weekly digest in v2)
- 30s max function duration

**Telegram Bot API:** Free. No per-message cost. 30 msg/s rate limit (irrelevant at family scale).

**Upstash free tier (10,000 commands/day):**
- ~1,000–1,500 ops/day at typical family usage — well within limits

**Anthropic API (dominant cost):**
- Text: ~$15–20/month
- Vision (images): ~$3–5/month
- Datetime pre-processing: ~$1/month
- Total: ~$19–26/month NZD

**Monitoring:** `GET /api/health` returns registry count and Redis connectivity. UptimeRobot for uptime alerts.

---

## 10. Deferred to v2

| Feature | Notes |
|---|---|
| Weekly digest | Sends personalised summary to all members on a schedule. Requires 1 Vercel cron slot (available). |
| Automated todo archive | Completed todos archived monthly by the weekly cron. In v1, triggered manually from the debug UI. |
| Automated audit log archive | Same as above. |
| Channel / group support | Not planned — private chats only by design decision. |
