# ADR-010: System Prompt Versioning

**Status:** Accepted
**Date:** 2026-03-12
**Context:** The agent's behavior depends heavily on its system prompt. When the prompt changes, it's important to correlate behavioral changes in evals and production logs to the specific prompt version that produced them.

## Decision

Assign an explicit version string (`PROMPT_VERSION`) in `lib/agent.ts`. This version is included in eval results and can be correlated with audit logs. When the system prompt changes meaningfully, the version is incremented.

The inference extraction prompt has its own independent version (`INFERENCE_VERSION` in `lib/inference.ts`).

## Consequences

- Eval results are traceable to exact prompt versions
- Prompt changes can be A/B tested by comparing version-tagged results
- Two independent version tracks (agent prompt vs inference prompt) allow them to evolve separately
- Requires developer discipline to bump the version on prompt changes — no automated enforcement
