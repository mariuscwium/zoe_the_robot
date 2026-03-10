# ADR-003: Promise.resolve() in Twins Instead of Async

**Status:** Accepted
**Date:** 2026-03-10
**Context:** Twin classes implement async interfaces (e.g., `sendMessage(): Promise<T>`) but their operations are synchronous in-memory. Using `async` on methods that contain no `await` triggers `@typescript-eslint/require-await`.

## Decision

Twin methods return `Promise.resolve(value)` and `Promise.reject(error)` instead of using the `async` keyword. This satisfies the interface contract without triggering the lint rule.

## Consequences

- Lint-clean without disabling a useful rule
- Slightly more verbose than `async` but makes the sync nature explicit
- Production code uses real `async/await` since it does actual I/O
