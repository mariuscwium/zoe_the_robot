# ADR-009: Tool Dispatch Routing via Domain Sub-Routers

**Status:** Accepted
**Date:** 2026-03-12
**Context:** The Claude agent can call ~15 tools across memory, calendar, and admin domains. A single flat dispatcher would be large and hard to maintain. Tools also need different post-processing: mutating tools require audit logging, calendar tools need the " - Zoe" suffix on event summaries.

## Decision

`dispatchTool()` in `lib/agent-dispatch.ts` delegates to domain-specific sub-routers (`routeMemoryTool()`, `routeCalendarTool()`, etc.) via a switch on tool name prefix. A `MUTATING_TOOLS` set tracks which tools trigger audit logging. Each sub-router handles its own domain logic independently.

## Consequences

- Each domain's tool logic is self-contained and testable in isolation
- Adding a new tool domain means adding a sub-router and extending the switch — not modifying existing routers
- Audit logging is centralized after dispatch, not scattered across individual tool handlers
- Domain-specific concerns (e.g., calendar authorship suffix) stay in their sub-router
- The switch statement is a simple routing table — easy to read and grep
