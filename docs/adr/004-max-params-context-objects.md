# ADR-004: Max 4 Parameters, Use Context Objects

**Status:** Accepted
**Date:** 2026-03-10
**Context:** Several internal functions accumulated 5-6 parameters (key, value, store, nowMs, etc.). High parameter counts make call sites hard to read and easy to get wrong.

## Decision

Enforce `max-params: 4` via ESLint. When a function needs more, group related parameters into a typed context/options object (e.g., `SetContext`, `PushContext`, `ExpansionWindow`).

## Consequences

- Call sites are more readable: `pushItems(key, values, "left", { store, nowMs })`
- Slightly more boilerplate (interface definitions) but the type system prevents misuse
- Applies to all code including twins and helpers — test files are exempt
