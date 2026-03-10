# Agent Team Design: Implementation & Testing

## 1. Digital Twin Universe

### Philosophy

Every external service gets a **stateful behavioral clone** — not a mock with
canned responses, but an in-memory state machine that enforces real API
contracts. The twins are the source of truth for what our code is allowed to
do. If a twin doesn't support a behavior, production code can't rely on it.

Twins live in `twins/` and are injectable via a `Deps` interface. Production
creates real HTTP clients; tests inject twins. No environment variables at
test time. No network calls.

### Twin: Upstash Redis (`twins/redis.ts`)

**Source of truth:** Upstash REST API docs (fetched 2026-03-10)

Behavioral clone of the Upstash Redis REST API:

```
POST /           → single command (JSON array body: ["SET", "foo", "bar"])
POST /pipeline   → array of commands, non-atomic
GET  /get/foo    → URL-path style
```

State machine:
- In-memory `Map<string, { value: string; ttl?: number; createdAt: number }>`
- Commands implemented: GET, SET (with EX/PX/NX/XX), DEL, EXISTS, KEYS, SCAN,
  EXPIRE, TTL, PTTL, PERSIST, LPUSH, RPUSH, LPOP, RPOP, LRANGE, LTRIM, LLEN,
  APPEND, MGET, MSET, INCR, INCRBY
- TTL enforcement: a `tick(ms)` method advances virtual clock, expiring keys
- Response shape: `{ result: T }` on success, `{ error: string }` on failure
- Auth: validates `Authorization: Bearer <token>` header, returns 401 on mismatch
- Pipeline: returns `Array<{ result } | { error }>` in order

Twin tests verify:
- SET with EX → GET returns value → tick past TTL → GET returns null
- LPUSH/LRANGE/LTRIM for list operations (conversation history)
- SCAN with MATCH pattern (memory key listing)
- Pipeline returns results in order, continues on individual errors
- 401 on missing/wrong auth token

### Twin: Telegram Bot API (`twins/telegram.ts`)

**Source of truth:** Telegram Bot API docs (core.telegram.org/bots/api)

Behavioral clone of the Telegram Bot API HTTP interface:

```
POST /bot{token}/sendMessage   → sends to in-memory outbox
POST /bot{token}/setWebhook    → stores webhook config
POST /bot{token}/getFile       → returns file_path for test fixtures
GET  /file/bot{token}/{path}   → returns file bytes from fixture map
```

State machine:
- `outbox: Message[]` — all messages sent via sendMessage
- `webhookConfig: { url, secret_token, allowed_updates }`
- `files: Map<file_id, { file_path, bytes: Buffer }>` — pre-loaded fixtures
- Validates bot token format, returns `{ ok: false, error_code: 401 }` on bad token
- `sendMessage` validates: chat_id required, text required, returns Message shape
- `getFile` returns `{ ok: true, result: { file_id, file_path } }`

Test helpers:
- `injectUpdate(update)` → builds a well-formed Telegram Update object
- `getOutbox()` → returns all sent messages (for assertion)
- `clearOutbox()` → reset between tests
- `addFile(file_id, bytes)` → load a test image fixture

Twin tests verify:
- sendMessage returns proper Message object with message_id, chat, date
- getFile + file download round-trip for images
- Bad bot token → 401
- Missing required fields → 400

### Twin: Google Calendar API (`twins/calendar.ts`)

**Source of truth:** Google Calendar API v3 reference (fetched 2026-03-10)

Behavioral clone of the Google Calendar Events API:

```
GET    /calendars/{id}/events           → list (with timeMin, timeMax, q, singleEvents)
POST   /calendars/{id}/events           → insert
GET    /calendars/{id}/events/{eventId}  → get
DELETE /calendars/{id}/events/{eventId}  → delete
```

State machine:
- `events: Map<string, CalendarEvent>` with auto-incrementing IDs
- Supports fields: summary, description, start, end, recurrence, reminders, location
- `reminders: { useDefault: boolean, overrides: [{ method, minutes }] }`
- `recurrence: string[]` — RRULE strings, basic expansion for `singleEvents=true`
- `singleEvents=true` expands recurring events into instances within timeMin/timeMax
- `orderBy=startTime` sorts by start.dateTime
- `q` parameter does substring match on summary + description
- Auth: validates `Authorization: Bearer <token>`, returns 401 for bad token
- Simulates `invalid_grant` error when token is set to a magic value `"EXPIRED"`
- Delete: removes event, returns 204. 404 for unknown ID.
- Delete on recurring event series: removes all instances

Twin tests verify:
- Insert → list returns event with all fields preserved
- Recurring event with RRULE:FREQ=DAILY → singleEvents=true returns instances
- Delete series → list returns empty
- reminders.overrides preserved exactly
- 401 on expired token (magic value)
- timeMin/timeMax filtering
- q search matches summary and description

### Twin: Claude Recording Proxy (`twins/claude-recorder.ts`)

The Anthropic API is **not** simulated — Claude's behavior is the product, not
an external dependency. Instead:

- First run: real API call, request+response saved to `twins/fixtures/claude/`
- Subsequent runs: replay from fixture (matched by hash of messages + tools)
- `RECORD=1` env var forces re-recording
- Fixture files are `.json` with `{ request, response }` pairs
- Tests that need deterministic Claude responses use pre-recorded fixtures
- Integration tests that test the *wiring* (not Claude's judgment) use a
  `StubClaude` that returns canned tool calls

### Dependency Injection (`lib/deps.ts`)

```typescript
interface Deps {
  redis: RedisClient;       // { execute(cmd: string[]): Promise<any> }
  telegram: TelegramClient; // { sendMessage, getFile, downloadFile }
  calendar: CalendarClient; // { listEvents, insertEvent, deleteEvent, getEvent }
  claude: ClaudeClient;     // { createMessage(params): Promise<Message> }
  clock: Clock;             // { now(): Date } — virtual clock for tests
}
```

Production: `createProductionDeps(env)` — real HTTP clients.
Tests: `createTestDeps()` — all twins, shared virtual clock.

---

## 2. Feedback Loops

Every agent operates in a **red-green loop**: write code → run checks → fix
failures → repeat until green. No agent considers itself done until all checks
pass.

### Test Runner

```bash
npm test                    # vitest — all tests
npm test -- --reporter=verbose 2>&1 | tee logs/test-$(date +%s).log
```

Agents run tests after every meaningful code change. On failure:
- The full error output (assertion message, stack trace, diff) is visible
- The agent reads the failing test, the tested code, and the error
- Fixes and re-runs — max 5 attempts before escalating to orchestrator

### Lint & Format

```bash
npm run lint                # eslint --max-warnings=0
npm run format:check        # prettier --check
```

Both run after every file write. On failure:
- `npm run lint:fix` and `npm run format` auto-fix what they can
- Remaining issues fixed manually by the agent

### Type Check

```bash
npm run typecheck           # tsc --noEmit
```

Runs after every file write. Type errors block all other work until fixed.

### Log Files

All agent runs produce logs in `logs/`:
- `logs/test-{timestamp}.log` — full test output
- `logs/lint-{timestamp}.log` — lint results
- `logs/typecheck-{timestamp}.log` — tsc output

These are gitignored but available for debugging.

---

## 3. Static Analysis Harness

### ESLint Configuration (strict)

```
@typescript-eslint/strict-type-checked
@typescript-eslint/stylistic-type-checked
```

Key rules:
- `complexity: ["error", 10]` — max cyclomatic complexity per function
- `max-lines-per-function: ["error", 60]` — forces decomposition
- `max-depth: ["error", 3]` — max nesting depth
- `no-explicit-any: "error"` — no `any` types
- `@typescript-eslint/no-floating-promises: "error"`
- `@typescript-eslint/no-misused-promises: "error"`
- `@typescript-eslint/strict-boolean-expressions: "error"`
- `no-console: "error"` — use structured logging
- `import/no-cycle: "error"` — no circular dependencies

### Code Smell Detection

ESLint plugin `sonarjs` for:
- `sonarjs/cognitive-complexity: ["error", 12]`
- `sonarjs/no-duplicate-string: "error"` (threshold: 3)
- `sonarjs/no-identical-functions: "error"`
- `sonarjs/no-nested-template-literals: "error"`

### Test Coverage

```bash
npm run test:coverage       # vitest --coverage
```

Thresholds enforced in vitest config:
- **Statements:** 90%
- **Branches:** 85%
- **Functions:** 90%
- **Lines:** 90%

Coverage report written to `coverage/` (gitignored). CI/agent checks:
```bash
# Extract coverage summary and fail if below threshold
npm run test:coverage 2>&1 | tee logs/coverage-$(date +%s).log
```

### Quality Gate (single command)

```bash
npm run quality             # typecheck && lint && test:coverage
```

Every agent runs `npm run quality` as the final check before declaring a
phase complete. All three must pass with zero warnings.

---

## 4. Coding Standards

### File Structure

- One concern per file. Max ~200 lines per file (soft limit, enforced by review).
- All exports are named exports. No default exports.
- Barrel files (`index.ts`) only in `tools/`.

### Naming

- Files: `kebab-case.ts`
- Types/Interfaces: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Redis keys: `namespace:scope:identifier` (colon-separated)

### Error Handling

- External calls (Redis, Telegram, Calendar, Claude) wrapped in try/catch
  at the boundary. Return `{ ok, data?, error? }` result types — no thrown
  exceptions in business logic.
- Tool implementations return `{ success: true, data }` or `{ success: false, error }`
  — Claude sees the error message and adapts.

### Testing Conventions

- Test files: `*.test.ts` co-located next to source, or in `tests/` for
  integration tests.
- Use `describe` blocks matching the function/module name.
- Test names: `it("returns 403 when secret token is missing")`
- No test should depend on another test's state — each test gets fresh twins.
- Factory helpers: `createTestMember()`, `createTestUpdate()` etc. in
  `tests/helpers.ts`.

### Imports

- Relative imports within a module (`./deps`)
- No path aliases — keeps it simple for Vercel bundling

---

## 5. Orchestrator Design

### Why We Need One

Agents hit premature exit points:
- Context window fills up on large implementations
- A dependency they need isn't ready yet (phase ordering violation)
- They get stuck in a loop (5 failed attempts at the same test)
- They produce code that passes their own tests but breaks another module

### Orchestrator Responsibilities

The orchestrator is a **top-level agent** that:

1. **Phase gating:** Tracks which phases are complete. Only launches Phase N+1
   agents when Phase N passes `npm run quality`.

2. **Health checks between phases:** After each phase, runs the full quality
   gate. If a Phase 2 agent's code breaks a Phase 1 test, the orchestrator
   identifies the regression and dispatches a fix agent.

3. **Stuck detection:** If an agent has attempted the same failing test 5 times,
   the orchestrator:
   - Reads the test, the code, and the error log
   - Launches a fresh "fix agent" with a focused prompt: "This test is failing
     with this error. The implementation is in this file. Fix it."
   - The fresh context often solves what the original agent couldn't.

4. **Cross-module integration:** After Phase 2, runs type-check across all
   modules to catch interface mismatches before Phase 3 begins.

5. **Progress tracking:** Maintains a `STATUS.md` file:

   ```markdown
   ## Phase 0: Scaffolding
   - [x] package.json, tsconfig.json, vercel.json — DONE
   - [x] lib/deps.ts — DONE
   - [x] Quality gate: PASS

   ## Phase 1: Digital Twins
   - [x] twins/redis.ts — DONE (14/14 tests pass)
   - [ ] twins/telegram.ts — IN PROGRESS (8/12 tests pass)
   - [x] twins/calendar.ts — DONE (11/11 tests pass)
   ```

6. **Escalation to human:** If the orchestrator itself can't resolve a blocker
   after 2 attempts, it writes a clear problem statement to `STATUS.md` and
   stops, rather than burning tokens in circles.

### Orchestrator Loop

```
for each phase in [0, 1, 2, 3, 4]:
  launch phase agents (parallel where possible)
  for each agent result:
    if agent succeeded:
      mark task complete
    else if agent hit max retries:
      launch fix agent with focused context
      if fix agent fails:
        escalate to human → STOP
  run full quality gate
  if quality gate fails:
    identify regression → dispatch fix agent
  if all tasks in phase complete and quality gate passes:
    advance to next phase
```

### Implementation

The orchestrator runs as the **main Claude Code session** (this conversation).
It doesn't need to be a separate system — I am the orchestrator. I will:

- Launch phase agents via the Agent tool
- Run quality gates via Bash between phases
- Track progress in STATUS.md
- Dispatch fix agents when something breaks
- Stop and ask you when I'm genuinely stuck

---

## 6. Agent Inventory

### Phase 0: Scaffolding (sequential, ~1 agent)

| Agent | Deliverables | Checks |
|---|---|---|
| `scaffold` | `package.json`, `tsconfig.json`, `vercel.json`, `.env.example`, `lib/deps.ts`, eslint + prettier config, vitest config, `logs/.gitkeep` | `npm install` succeeds, `npm run typecheck` passes, `npm run lint` passes |

### Phase 1: Digital Twins (parallel, 3 agents)

| Agent | Deliverables | Checks |
|---|---|---|
| `twin-redis` | `twins/redis.ts`, `twins/redis.test.ts` | Unit tests pass, covers all commands used by lib/ |
| `twin-telegram` | `twins/telegram.ts`, `twins/telegram.test.ts` | Unit tests pass, covers sendMessage/getFile/download/setWebhook |
| `twin-calendar` | `twins/calendar.ts`, `twins/calendar.test.ts` | Unit tests pass, covers list/insert/delete/get + RRULE + reminders |

### Phase 2: Core Libraries (parallel, 5 agents)

| Agent | Deps | Deliverables | Checks |
|---|---|---|---|
| `lib-registry` | twin-redis | `lib/registry.ts`, `lib/audit.ts`, tests | Tests pass against Redis twin |
| `lib-memory` | twin-redis | `lib/history.ts`, `lib/memory.ts`, tests | Tests pass against Redis twin |
| `lib-calendar` | twin-calendar | `lib/calendar.ts`, `lib/datetime.ts`, tests | Tests pass against Calendar twin |
| `lib-telegram` | twin-telegram | `lib/telegram.ts`, tests | Tests pass against Telegram twin |
| `tool-schemas` | none | `tools/index.ts` | Typecheck passes |

### Phase 3: Integration (sequential, 4 agents)

| Agent | Deps | Deliverables | Checks |
|---|---|---|---|
| `agent-loop` | all Phase 2 | `lib/agent.ts`, tests | Tool loop tests with StubClaude |
| `webhook-handler` | agent-loop | `api/telegram.ts`, tests | Full webhook flow tests with all twins |
| `debug-ui` | lib-registry, lib-memory | `api/debug.ts`, `api/health.ts`, tests | Auth flow, panel rendering, CRUD tests |
| `bootstrap` | lib-registry, lib-telegram | `scripts/bootstrap.ts`, tests | Idempotency tests |

### Phase 4: Scenario Tests (sequential, 1 agent)

| Agent | Deliverables | Checks |
|---|---|---|
| `scenarios` | `tests/integration/*.test.ts` — 32 visible scenarios | All pass against full twin harness |

### Holdout Tests (written by orchestrator, never shown to impl agents)

10 scenarios from the Gherkin spec, covering:
- Feature 1: Webhook secret validation (403)
- Feature 2: Multi-event confirmation expiry (5-min TTL)
- Feature 3: Malformed history JSON recovery
- Feature 4: Agent loop max 8 tool calls
- Feature 5: Redis unreachable error handling
- Feature 6: Google refresh token expired (invalid_grant)
- Feature 6: Multiple events match deletion → clarification
- Feature 7: Log append fails → primary action not rolled back
- Feature 8: Three failed login attempts → IP lockout
- Feature 8: Expired JWT → redirect to login

These are written directly by the orchestrator into `tests/holdout/` and run
as a final validation. If holdout tests fail, the orchestrator fixes the code
without showing the holdout tests to implementation agents.

---

## 7. Execution Order

```
Phase 0  ──────────────────────────  scaffold
              │
Phase 1  ────┼── twin-redis ────┐
              ├── twin-telegram ─┤
              └── twin-calendar ─┤
                                 │ quality gate
Phase 2  ────┼── lib-registry ──┐
              ├── lib-memory ────┤
              ├── lib-calendar ──┤
              ├── lib-telegram ──┤
              └── tool-schemas ──┤
                                 │ quality gate + cross-module typecheck
Phase 3  ──── agent-loop ───────┤
              webhook-handler ───┤
              debug-ui ──────────┤
              bootstrap ─────────┤
                                 │ quality gate
Phase 4  ──── scenarios ─────────┤
                                 │ quality gate
Holdout  ──── orchestrator ──────┤ final validation
                                 │
                                 ▼ DONE — ready for first deploy
```

---

## 8. Autonomy Guardrails

### When agents proceed without human input
- Test failures they can diagnose and fix (up to 5 attempts)
- Lint/format issues (auto-fixable)
- Type errors in their own code
- Missing imports or interface mismatches they can resolve

### When the orchestrator intervenes (no human needed)
- Cross-module type mismatches after a phase completes
- Test regressions from a new phase breaking old code
- An agent stuck after 5 retries (fresh fix agent dispatched)

### When the orchestrator stops and asks the human
- A design ambiguity not covered by the RFC or Gherkin spec
- A fundamental architectural decision (e.g., "the Deps pattern doesn't work
  for X, should we change it?")
- Two consecutive fix agents fail on the same issue
- Holdout tests reveal a systemic problem, not a point fix
