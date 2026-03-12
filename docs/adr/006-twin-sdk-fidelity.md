# ADR-006: Twin SDK Fidelity Over Protocol Fidelity

**Status:** Accepted
**Date:** 2026-03-11
**Context:** The Redis digital twin (ADR-001) faithfully modeled raw Redis protocol behavior — GET returned strings, LRANGE returned string arrays, and all stored values came back as their serialized representations. But in production, the `@upstash/redis` SDK auto-deserializes JSON values: a GET of `'{"name":"Marius"}'` returns the object `{name:"Marius"}`, not the raw string. This mismatch meant code that passed all twin-based tests broke in production with "is not valid JSON" errors when library code called `JSON.parse()` on an already-parsed object.

## Decision

The twin should model the client SDK's behavior, not the underlying protocol. Add auto-deserialization to GET, MGET, LPOP, RPOP, and LRANGE results in the Redis twin, matching what `@upstash/redis` actually returns. Library code can then assume consistent deserialized results without defensive `typeof` checks.

The principle generalizes: all twins should model the SDK/client layer the code actually depends on, not the raw wire protocol beneath it.

## Consequences

- Twin tests now assert deserialized values (number `1` not string `"1"`, objects not JSON strings)
- Library code simplified — no need for `typeof` branching or try/catch around `JSON.parse` on Redis results
- The twin is coupled to Upstash SDK semantics, not Redis semantics — if we switched SDKs, the twin would need updating (acceptable given ADR-001's maintenance tradeoff)
- Reinforces that twins are behavioral clones of *what the code sees*, not of the external service itself
