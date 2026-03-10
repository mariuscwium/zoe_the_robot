# ADR-001: Digital Twins Over Mocks

**Status:** Accepted
**Date:** 2026-03-10
**Context:** Tests need to exercise Redis, Telegram, and Google Calendar integrations without network calls. Traditional approaches: (a) Jest mocks with canned responses, (b) testcontainers with real services, (c) stateful behavioral clones.

## Decision

Use stateful in-memory behavioral clones ("digital twins") injected via a `Deps` interface. Each twin is a state machine that enforces real API contracts — not a mock with hardcoded returns.

Twins live in `twins/` and implement the same interfaces as production clients. Production creates real HTTP clients; tests inject twins. No environment variables at test time.

## Consequences

- Tests verify behavior, not just call sequences
- Twins catch contract violations that mocks would miss (e.g., LPUSH on a string key returns WRONGTYPE)
- Twins must be maintained as the API surface grows — but they're small (~150-200 lines each)
- No network dependencies in CI
- Claude API is NOT twinned — it uses a recording proxy instead, since Claude's behavior is the product
