# ADR 005: Debug UI Access via Query Parameter

## Status

Accepted

## Context

The debug UI needs a non-discoverable route. The RFC specifies `GET /{DEBUG_PATH}`
where `DEBUG_PATH` is an env var. However, Vercel's `vercel.json` routing is static
and cannot use runtime env vars in route patterns. A catch-all route would intercept
all unmatched paths, breaking other endpoints.

## Decision

Use `/api/debug?key=<DEBUG_PATH>` instead of `/{DEBUG_PATH}`. The handler validates
the `key` query parameter against the `DEBUG_PATH` env var. This keeps `vercel.json`
simple (one static route) while maintaining non-discoverability — you need both the
endpoint path and the secret key.

Auth flow: bcrypt password verification → httpOnly JWT cookie (24hr) → IP lockout
after 3 failures (15min cooldown via Redis).

## Consequences

- No catch-all route needed in `vercel.json`
- The debug URL is slightly longer but equally non-guessable
- All debug API calls use the same endpoint with `?action=<name>` dispatch
- JWT cookie is scoped to the `/` path, but only validated on `/api/debug`
