# ADR-011: Eval Harness with SpyClaude Wrapper

**Status:** Accepted
**Date:** 2026-03-12
**Context:** The eval framework needs to test actual Claude behavior (not mocked responses) while keeping backends deterministic and introspectable. Standard unit tests use digital twins for external services, but evals need to observe what tools Claude calls and what it says.

## Decision

Evals use a `SpyClaude` decorator that wraps the real Claude client, recording all tool calls and responses in memory. Scenarios run against real Claude but with digital twins for Redis, Telegram, and Calendar. Each scenario specifies assertions on response text, tool calls made, and side effects (e.g., calendar events created).

Evals use fixed date/time context and pre-seeded twin state for reproducibility.

## Consequences

- Evals capture actual Claude behavior — not what we think it should do
- Tool call assertions catch regressions (e.g., Claude stops using a tool, or calls it too many times)
- Digital twin backends keep evals deterministic and fast (no network, no flaky external state)
- SpyClaude is transparent to the agent — no code changes needed to run under eval
- Evals cost real API calls — run selectively, not on every commit
