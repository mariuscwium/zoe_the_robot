# TUI Debug Dashboard — Design Spec

## Purpose

A terminal-based debug dashboard for the Zoe family assistant, built with Ink (React for CLI). Connects directly to Upstash Redis to provide real-time visibility into logs, memory, agent behavior, and token usage — all in one place.

## Motivation

The inference agent (memory subagent) runs fire-and-forget after each reply. When it silently fails or extracts nothing, there's no way to tell. The existing web debug UI covers memory and audit logs but doesn't surface inference runs, token usage, or tool call patterns. A TUI gives the developer a live tail of everything happening in the system.

## Future: MCP Interface

After the TUI is working, the same Redis queries should be exposed as an MCP server so that Zoe (and other agents) can introspect their own logs, token usage, and memory state. The TUI and MCP server will share query logic from `tui/lib/redis.ts`.

---

## Backend Changes

Two new Redis log streams are needed before the TUI can show useful data.

### `log:inference` (new)

LPUSH after each inference run in `lib/inference.ts`:

```json
{
  "timestamp": "2026-03-13T12:00:00Z",
  "memberId": "marius",
  "keysLoaded": ["family/todos", "family/members/kate"],
  "writes": [
    { "key": "family/members/kate", "contentLength": 142 }
  ],
  "skipped": false
}
```

`skipped: true` when Claude returns an empty array (nothing new to extract). Capped at 500 entries via LTRIM after each push.

### `log:tokens` (new)

LPUSH after each Claude API call in `lib/agent.ts` (tool loop iterations) and `lib/inference.ts`:

```json
{
  "timestamp": "2026-03-13T12:00:00Z",
  "agent": "zoe",
  "model": "claude-sonnet-4-20250514",
  "input_tokens": 2340,
  "output_tokens": 512
}
```

Agent is `"zoe"` or `"inference"`. Capped at 500 entries via LTRIM.

### `ClaudeMessage` interface change

Add `usage` to the existing interface in `lib/deps.ts`:

```typescript
export interface ClaudeMessage {
  // ...existing fields...
  usage?: { input_tokens: number; output_tokens: number };
}
```

The Anthropic SDK already returns this; we just aren't capturing it.

---

## TUI Architecture

### Entry Point

```
npx tsx tui/app.tsx
```

Loads `.env` for `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. No shared code with the deployed bot — this is a standalone developer tool.

### Polling

A React context provider polls Redis every 3 seconds. Each poll fetches the latest N entries from each log list and all memory keys. Components subscribe to the data they need.

### Navigation

Tab key cycles through panels. Number keys (1-4) jump directly. Current tab highlighted in the status bar.

---

## Panels

### 1. Logs

Unified chronological view of:
- **Incoming messages** (`log:incoming`) — who sent what, message type (text/photo/voice)
- **Audit entries** (`log:audit`) — tool calls, errors, rejections
- **Inference runs** (`log:inference`) — what was extracted, what was skipped

All entries interleaved by timestamp and color-coded:
- Cyan: incoming messages
- Yellow: tool calls / mutations
- Red: errors
- Magenta: inference runs

Scrollable with arrow keys. Auto-follows newest entries unless user has scrolled up.

### 2. Memory

Left column: list of all memory keys (from `KEYS *` filtered to known memory patterns like `family/*`, `members/*`).

Right column: full content of the selected key.

Arrow keys to navigate the key list, Enter to select. Shows content length and key name.

### 3. Agents

Two sections side by side:

**Zoe (main agent):**
- Recent tool calls extracted from audit log (actions matching known tool names: `write_memory`, `read_memory`, `list_events`, `create_event`, etc.)
- Shows: timestamp, tool name, input summary (truncated), success/failure

**Inference agent:**
- Recent inference runs from `log:inference`
- Shows: timestamp, member, keys loaded, writes made, skipped status
- Color-coded: green for writes, dim for skipped

### 4. Tokens

Summary statistics:
- Total input/output tokens today (by agent)
- Per-call breakdown (last 20 calls)
- Simple bar chart or table showing usage over time

Two columns: Zoe vs Inference side by side.

---

## Status Bar

Fixed at bottom. Shows:
- Current tab name and key hints (`[1] Logs  [2] Memory  [3] Agents  [4] Tokens`)
- Connection status (green dot / red dot)
- Last poll timestamp
- `q` to quit

---

## File Structure

```
tui/
  app.tsx              — entry point, .env loading, tab router
  components/
    Logs.tsx           — unified log panel
    Memory.tsx         — memory key browser + content viewer
    Agents.tsx         — tool calls + inference runs
    Tokens.tsx         — token usage summary
    StatusBar.tsx      — connection, tab hints, quit
  lib/
    redis.ts           — Upstash client, query functions (shared with future MCP)
    types.ts           — log entry types
    usePolling.ts      — React hook for interval-based Redis polling
```

~9 files, each under 200 lines.

## Dependencies

- `ink` (v5) + `react` (v18) — TUI framework
- `@upstash/redis` — already installed
- `dotenv` — already installed
- `tsx` — already a dev dependency

No new production dependencies. Ink and React are dev-only (not deployed to Vercel).

---

## What This Does NOT Include

- MCP server (future phase, shares `tui/lib/redis.ts` queries)
- Write operations from the TUI (read-only dashboard)
- Authentication (local dev tool, not exposed)
- Tests for TUI components (developer tool, tested manually)
- Changes to the existing web debug UI
