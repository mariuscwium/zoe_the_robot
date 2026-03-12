# ADR-007: Dependency Injection via Interfaces and Factory Pattern

**Status:** Accepted
**Date:** 2026-03-12
**Context:** The codebase depends on four external services (Redis, Telegram, Google Calendar, Claude). Tests need to swap these for digital twins (ADR-001), and production needs lazy initialization from environment variables with singleton semantics for Vercel cold-start efficiency.

## Decision

Define a `Deps` interface containing all external clients (`RedisClient`, `TelegramClient`, `CalendarProvider`, `ClaudeClient`). Production code constructs a `Deps` object once via `createProdDeps()` in `lib/prod-deps.ts`, which lazily reads environment variables and creates real HTTP clients. Tests construct `Deps` with digital twins instead.

All library functions accept `Deps` (or a subset) as a parameter — no module-level singletons or global state.

## Consequences

- Every function's external dependencies are explicit in its signature
- Tests inject twins without patching modules or environment variables
- Production handler is created once per cold start and reused across requests
- Adding a new external service means extending the `Deps` interface — all call sites are type-checked
- Slightly more verbose function signatures, mitigated by ADR-004 (context objects)
