# Conventions

## Code Organisation

- All tool implementations live in `lib/`, tool *definitions* (schemas) live in `tools/index.ts`
- Digital twins (stateful behavioural clones of external APIs) live in `twins/`
- Integration/scenario tests live in `tests/integration/`
- Files must stay under 200 lines (ESLint `max-lines`, skip blanks/comments). Test files exempt.
- Max 4 params per function — group into typed context objects when exceeded
- Max complexity 10, max function length 60 lines — decompose into helpers

## Redis Key Namespace

- `memory:family:*` — shared family memory docs (markdown strings)
- `memory:members:<id>:*` — personal per-member notes
- `conversation:<id>` — rolling conversation history per chat_id
- `registry:members` — JSON map of member id → FamilyMember
- `log:incoming` — incoming message log (Redis list)
- `log:audit` — audit log (Redis list)
- `pending_confirm:<id>` — pending confirmation gates
- `debug:lockout:<ip>` — debug UI login lockout state

## Identity & Privacy

- `chat_id` is the sole identity key — no phone numbers stored anywhere
- Images are never persisted: download from Telegram → base64 in memory → pass to Claude → discard
- Memory docs are private — never generate or imply a public URL for any Redis key

## Telegram

- Group chats silently rejected (`chat.type !== "private"` → HTTP 200, no reply, no log)
- Replies are plain text only — no markdown formatting sent to Telegram users

## Agent

- Max 8 tool calls per invocation, `claude-sonnet-4-20250514` with Vision
- Every mutating tool wrapper calls `audit.append()` after execution — never inside the agent prompt
- Authorship injected server-side in all mutating tool wrappers — Claude never writes authorship
- `confirm_action` tool required before any destructive action or bulk calendar creation (4+ events from one image)

## Testing

- Quality gate: `npm run typecheck && npm run lint && npm test`
- Async interface methods in twins use `Promise.resolve()` / `Promise.reject()` (not `async`) to avoid `@typescript-eslint/require-await`
- Tests use digital twins injected via `Deps` interface — no env vars, no network calls at test time
