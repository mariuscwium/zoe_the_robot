# ADR-000: Use Architecture Decision Records

**Status:** Accepted
**Date:** 2026-03-10
**Context:** Design decisions are scattered across RFC, CLAUDE.md, and agent conversations. When revisiting code months later, the _why_ behind choices is lost.

## Decision

Maintain lightweight ADRs in `docs/adr/` using this format:

```
# ADR-NNN: Title

**Status:** Proposed | Accepted | Superseded by ADR-NNN | Deprecated
**Date:** YYYY-MM-DD
**Context:** What prompted this decision.

## Decision
What we decided and why.

## Consequences
What changes, what trade-offs we accept.
```

## Rules

- One file per decision: `NNN-slug.md` (zero-padded 3 digits)
- ADRs are append-only. To reverse a decision, write a new ADR that supersedes the old one
- Not everything needs an ADR. Use them for decisions that are non-obvious, contested, or have meaningful trade-offs
- The orchestrator agent creates ADRs when it encounters or makes architectural decisions during implementation

## Consequences

- Decisions are discoverable and grep-able
- New contributors (human or agent) can understand _why_ without re-deriving from first principles
- Small overhead per decision (~5 min to write)
