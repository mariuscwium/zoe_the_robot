# ADR-008: Inference as Post-Reply Extraction Pipeline

**Status:** Accepted
**Date:** 2026-03-12
**Context:** The agent should learn and remember family knowledge from conversations (names, routines, places, preferences). Two approaches: (a) let the agent extract and store knowledge during the main reply using tools, or (b) run a separate extraction pass after the reply is sent.

## Decision

Run a separate, non-blocking Claude call after the main reply to extract family knowledge. This "inference" call has no tools — it returns structured JSON with memory write operations that the code executes. It uses a fixed taxonomy (`family/members/`, `family/activities/`, `family/places/`, `family/routines/`, `family/docs/`, `family/lists/`, `family/dates`). The inference prompt is versioned (`INFERENCE_VERSION`) independently of the main system prompt.

If inference fails, the error is caught silently — it never affects the user's reply.

## Consequences

- Main reply stays fast — inference runs in the background after the response is sent
- Knowledge extraction is decoupled from conversational behavior — can iterate on extraction quality without affecting replies
- Prompt versioning allows A/B testing and eval correlation
- Silent failure means inference bugs don't degrade user experience, but also means extraction failures may go unnoticed without monitoring
- No tool-use overhead in the inference call — structured JSON is cheaper and more predictable
