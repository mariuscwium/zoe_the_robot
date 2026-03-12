# ADR-012: Webhook Deduplication via SETNX + EXPIRE

**Status:** Accepted
**Date:** 2026-03-12
**Context:** Telegram retries webhook deliveries when the server doesn't respond within ~60 seconds or returns an error. Without deduplication, retried messages would be processed twice — potentially creating duplicate calendar events, double-writing memory, or sending duplicate replies.

## Decision

Before processing a webhook, attempt `SETNX` on a key `dedup:<chatId>:<messageId>` with a 300-second TTL (via separate `EXPIRE` call). If the key already exists (SETNX returns 0), the message is a duplicate and is silently dropped with HTTP 200.

An earlier implementation used `SET key NX EX 300` but the Upstash SDK doesn't support positional `EX` on SET — switched to `SETNX` + `EXPIRE` as two commands.

## Consequences

- Duplicate webhook deliveries are idempotently ignored
- 300-second TTL is long enough to cover Telegram's retry window without accumulating stale keys
- Two Redis commands instead of one atomic `SET NX EX` — there's a tiny window where SETNX succeeds but EXPIRE fails, leaving a key without TTL. Acceptable risk given Redis uptime and the key eventually being overwritten
- No counter or rate-limiting overhead — simple boolean existence check
