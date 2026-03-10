# ADR-002: Plain Markdown in Redis Over Vector DB

**Status:** Accepted
**Date:** 2026-03-10
**Context:** Memory layer options considered: Mem0, Zep, Letta (vector-based agent memory), Pinecone/Weaviate (vector DB), or plain key-value storage.

## Decision

Store all memory as plain markdown strings in Upstash Redis. Keys follow a namespace convention: `memory:family:*` (shared), `memory:members:<id>:*` (personal). No vector database, no embeddings, no semantic search.

## Consequences

- Memory is human-readable and debuggable via the debug UI
- Claude can read/write memory docs directly — no retrieval pipeline
- Scales to family-sized data (dozens of docs, not millions) without infrastructure
- No similarity search — Claude must know which key to read (tool descriptions guide it)
- If memory grows beyond what fits in a Claude context window, we'd need to revisit (deferred to v2)
- No public URLs for memory keys — they're internal Redis keys only
