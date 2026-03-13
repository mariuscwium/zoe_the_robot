# TUI Debug Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time Ink TUI dashboard that surfaces logs, memory, agent tool calls, inference runs, and token usage from Upstash Redis.

**Architecture:** Two-phase build — first add backend logging (inference runs + token usage) to the deployed bot, then build the standalone TUI that reads from Redis. The TUI is excluded from the bot's tsconfig/eslint and has its own tsconfig for JSX support.

**Tech Stack:** Ink 5, React 18, @upstash/redis (existing), dotenv (existing), tsx (existing)

**Spec:** `docs/superpowers/specs/2026-03-13-tui-debug-dashboard-design.md`

---

## Chunk 1: Backend Logging Changes

### Task 1: Fix inference agent memory key pattern

The inference agent at `lib/inference.ts:63` uses the same broken `memory:family:*` pattern we fixed in `lib/memory.ts`. It also uses `memory:` prefix in `loadRelevantDocs`. Fix to match actual key patterns.

**Files:**
- Modify: `lib/inference.ts:63,86-87,90`

- [ ] **Step 1: Fix the SCAN pattern in runInference**

In `lib/inference.ts`, change line 63:
```typescript
// Before:
const existingKeys = await listMemoryKeys(deps, "memory:family:*");

// After:
const existingKeys = await listMemoryKeys(deps, "family/*");
```

- [ ] **Step 2: Fix loadRelevantDocs prefix filtering and stripping**

In `lib/inference.ts`, the `loadRelevantDocs` function filters keys with `memory:family:` prefix and strips `memory:` — but keys are already `family/members/kate` etc. Fix lines 86-91:
```typescript
// Before:
const relevantPrefixes = ["memory:family:members:", "memory:family:activities:", "memory:family:dates"];
const toLoad = keys.filter((k) => relevantPrefixes.some((p) => k.startsWith(p)));
for (const fullKey of toLoad) {
  const shortKey = fullKey.replace(/^memory:/, "");
  const content = await readMemory(deps, shortKey);

// After:
const relevantPrefixes = ["family/members/", "family/activities/", "family/dates"];
const toLoad = keys.filter((k) => relevantPrefixes.some((p) => k.startsWith(p)));
for (const key of toLoad) {
  const content = await readMemory(deps, key);
```

Also update the Map assignment from `docs.set(shortKey, content)` to `docs.set(key, content)`.

- [ ] **Step 3: Fix buildUserPrompt key display**

In `lib/inference.ts`, the `buildUserPrompt` function strips `memory:` prefix at line 113. Remove the stripping since keys no longer have the prefix:
```typescript
// Before:
const shortKeys = existingKeys.map((k) => k.replace(/^memory:/, ""));
parts.push("");
parts.push("Existing memory keys: " + shortKeys.join(", "));

// After:
parts.push("");
parts.push("Existing memory keys: " + existingKeys.join(", "));
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/memory.test.ts tests/integration/features-3-7.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add lib/inference.ts
git commit -m "Fix inference agent memory key patterns to match actual Redis keys"
```

---

### Task 2: Add `usage` to ClaudeMessage interface

**Files:**
- Modify: `lib/deps.ts:137-144`

- [ ] **Step 1: Add usage field**

In `lib/deps.ts`, update the `ClaudeMessage` interface:
```typescript
export interface ClaudeMessage {
  id: string;
  type: string;
  role: string;
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: string | null;
  usage?: { input_tokens: number; output_tokens: number };
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: Pass (usage is optional, no consumers break)

- [ ] **Step 3: Commit**

```bash
git add lib/deps.ts
git commit -m "Add usage field to ClaudeMessage interface for token tracking"
```

---

### Task 3: Add token usage logging

Log token usage after every Claude API call. New helper function in a new file to keep agent.ts and inference.ts under line limits.

**Files:**
- Create: `lib/log-tokens.ts`
- Modify: `lib/agent.ts:98-123` (runToolLoop)
- Modify: `lib/inference.ts:58-79` (runInference)

- [ ] **Step 1: Create `lib/log-tokens.ts`**

```typescript
/**
 * Log token usage from Claude API responses to Redis.
 * Used by both the main agent and the inference agent.
 */

import type { RedisClient, ClaudeMessage } from "./deps.js";

const LOG_KEY = "log:tokens";
const MAX_ENTRIES = 500;

interface TokenLogDeps {
  redis: RedisClient;
}

export async function logTokenUsage(
  deps: TokenLogDeps,
  agent: "zoe" | "inference",
  response: ClaudeMessage,
): Promise<void> {
  if (!response.usage) return;
  const entry = {
    timestamp: new Date().toISOString(),
    agent,
    model: response.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
  await deps.redis.execute(["LPUSH", LOG_KEY, JSON.stringify(entry)]);
  await deps.redis.execute(["LTRIM", LOG_KEY, "0", String(MAX_ENTRIES - 1)]);
}
```

- [ ] **Step 2: Add token logging to agent.ts runToolLoop**

In `lib/agent.ts`, import `logTokenUsage` and call it after each `createMessage`:
```typescript
import { logTokenUsage } from "./log-tokens.js";
```

In `runToolLoop`, after `const response = await deps.claude.createMessage(...)`:
```typescript
await logTokenUsage(deps, "zoe", response);
```

Note: `deps` already has `redis` since `AgentDeps` includes `RedisClient`.

- [ ] **Step 3: Add token logging to inference.ts runInference**

In `lib/inference.ts`, import `logTokenUsage` and call it after the `createMessage` call:
```typescript
import { logTokenUsage } from "./log-tokens.js";
```

After `const response = await deps.claude.createMessage(...)` (line 72):
```typescript
await logTokenUsage(deps, "inference", response);
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npx vitest run`
Expected: All pass (logTokenUsage is fire-and-forget in tests; twin Redis won't error)

- [ ] **Step 5: Commit**

```bash
git add lib/log-tokens.ts lib/agent.ts lib/inference.ts
git commit -m "Add token usage logging for both agents to log:tokens"
```

---

### Task 4: Add inference run logging

Log each inference run (keys loaded, writes made, skipped status).

**Files:**
- Create: `lib/log-inference.ts`
- Modify: `lib/inference.ts:58-79`

- [ ] **Step 1: Create `lib/log-inference.ts`**

```typescript
/**
 * Log inference agent runs to Redis for debugging.
 */

import type { RedisClient } from "./deps.js";
import type { MemoryWrite } from "./inference.js";

const LOG_KEY = "log:inference";
const MAX_ENTRIES = 500;

interface InferenceLogDeps {
  redis: RedisClient;
}

interface InferenceLogEntry {
  timestamp: string;
  memberId: string;
  keysLoaded: string[];
  writes: { key: string; contentLength: number }[];
  skipped: boolean;
}

export async function logInferenceRun(
  deps: InferenceLogDeps,
  memberId: string,
  keysLoaded: string[],
  writes: MemoryWrite[],
): Promise<void> {
  const entry: InferenceLogEntry = {
    timestamp: new Date().toISOString(),
    memberId,
    keysLoaded,
    writes: writes.map((w) => ({ key: w.key, contentLength: w.content.length })),
    skipped: writes.length === 0,
  };
  await deps.redis.execute(["LPUSH", LOG_KEY, JSON.stringify(entry)]);
  await deps.redis.execute(["LTRIM", LOG_KEY, "0", String(MAX_ENTRIES - 1)]);
}
```

- [ ] **Step 2: Call logInferenceRun in inference.ts**

In `lib/inference.ts`, import and call after writes complete:
```typescript
import { logInferenceRun } from "./log-inference.js";
```

In `runInference`, after the write loop and before `return writes`:
```typescript
await logInferenceRun(deps, member.id, existingKeys, writes);
```

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npx vitest run`
Expected: All pass

- [ ] **Step 4: Commit and deploy**

```bash
git add lib/log-inference.ts lib/inference.ts
git commit -m "Add inference run logging to log:inference"
git push origin main
```

---

## Chunk 2: TUI Setup & Infrastructure

### Task 5: Install Ink dependencies and configure TUI tsconfig

The TUI uses JSX/TSX which requires separate TypeScript config. The main tsconfig stays untouched. ESLint should ignore `tui/` since it has different conventions (React, console output).

**Files:**
- Create: `tui/tsconfig.json`
- Modify: `eslint.config.js:8` (add `tui/` to ignores)
- Modify: `package.json` (add `tui` script, add ink/react deps)

- [ ] **Step 1: Install ink and react as dev dependencies**

Run: `npm install --save-dev ink@5 react@18 @types/react@18`

- [ ] **Step 2: Create `tui/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["./**/*.ts", "./**/*.tsx"]
}
```

- [ ] **Step 3: Add `tui/` to ESLint ignores**

In `eslint.config.js`, update the ignores array:
```typescript
ignores: ["node_modules/", "dist/", "coverage/", "logs/", "tui/"],
```

- [ ] **Step 4: Add tui script to package.json**

In `package.json` scripts:
```json
"tui": "npx tsx tui/app.tsx"
```

- [ ] **Step 5: Run main typecheck and lint to verify no regressions**

Run: `npm run typecheck && npm run lint -- --ignore-pattern '.claude/'`
Expected: Pass (tui/ excluded from both)

- [ ] **Step 6: Commit**

```bash
git add tui/tsconfig.json eslint.config.js package.json package-lock.json
git commit -m "Set up TUI infrastructure: Ink deps, separate tsconfig, ESLint ignore"
```

---

### Task 6: Create TUI types and Redis query layer

Shared types for log entries and Redis query functions that both the TUI and future MCP server will use.

**Files:**
- Create: `tui/lib/types.ts`
- Create: `tui/lib/redis.ts`

- [ ] **Step 1: Create `tui/lib/types.ts`**

```typescript
export interface IncomingLogEntry {
  timestamp: string;
  memberId: string;
  messageType: string;
  text: string;
}

export interface AuditEntry {
  timestamp: string;
  memberId: string;
  action: string;
  detail: string;
}

export interface InferenceLogEntry {
  timestamp: string;
  memberId: string;
  keysLoaded: string[];
  writes: { key: string; contentLength: number }[];
  skipped: boolean;
}

export interface TokenLogEntry {
  timestamp: string;
  agent: "zoe" | "inference";
  model: string;
  input_tokens: number;
  output_tokens: number;
}

export interface UnifiedLogEntry {
  timestamp: string;
  kind: "incoming" | "audit" | "inference";
  data: IncomingLogEntry | AuditEntry | InferenceLogEntry;
}

export interface MemoryEntry {
  key: string;
  content: string;
}

export interface DashboardData {
  logs: UnifiedLogEntry[];
  memoryKeys: string[];
  tokenLog: TokenLogEntry[];
  connected: boolean;
  lastPoll: string;
}
```

- [ ] **Step 2: Create `tui/lib/redis.ts`**

```typescript
import { Redis } from "@upstash/redis";
import type {
  IncomingLogEntry,
  AuditEntry,
  InferenceLogEntry,
  TokenLogEntry,
  UnifiedLogEntry,
} from "./types.js";

let redis: Redis | null = null;

export function initRedis(url: string, token: string): void {
  redis = new Redis({ url, token });
}

function getRedis(): Redis {
  if (!redis) throw new Error("Redis not initialized");
  return redis;
}

function parseEntries<T>(raw: unknown[]): T[] {
  return raw.map((item) => {
    if (typeof item === "string") return JSON.parse(item) as T;
    return item as T;
  });
}

export async function fetchIncomingLog(limit = 50): Promise<IncomingLogEntry[]> {
  const raw = await getRedis().lrange("log:incoming", 0, limit - 1);
  return parseEntries<IncomingLogEntry>(raw);
}

export async function fetchAuditLog(limit = 50): Promise<AuditEntry[]> {
  const raw = await getRedis().lrange("log:audit", 0, limit - 1);
  return parseEntries<AuditEntry>(raw);
}

export async function fetchInferenceLog(limit = 50): Promise<InferenceLogEntry[]> {
  const raw = await getRedis().lrange("log:inference", 0, limit - 1);
  return parseEntries<InferenceLogEntry>(raw);
}

export async function fetchTokenLog(limit = 50): Promise<TokenLogEntry[]> {
  const raw = await getRedis().lrange("log:tokens", 0, limit - 1);
  return parseEntries<TokenLogEntry>(raw);
}

export async function fetchMemoryKeys(): Promise<string[]> {
  const keys = await getRedis().keys("family/*");
  const memberKeys = await getRedis().keys("members/*");
  return [...keys, ...memberKeys].sort();
}

export async function fetchMemoryContent(key: string): Promise<string> {
  const content = await getRedis().get<string>(key);
  return content ?? "(empty)";
}

export async function fetchUnifiedLogs(limit = 100): Promise<UnifiedLogEntry[]> {
  const [incoming, audit, inference] = await Promise.all([
    fetchIncomingLog(limit),
    fetchAuditLog(limit),
    fetchInferenceLog(limit),
  ]);

  const unified: UnifiedLogEntry[] = [
    ...incoming.map((d) => ({ timestamp: d.timestamp, kind: "incoming" as const, data: d })),
    ...audit.map((d) => ({ timestamp: d.timestamp, kind: "audit" as const, data: d })),
    ...inference.map((d) => ({ timestamp: d.timestamp, kind: "inference" as const, data: d })),
  ];

  unified.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return unified.slice(0, limit);
}

export async function testConnection(): Promise<boolean> {
  try {
    await getRedis().ping();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Verify TUI types compile**

Run: `npx tsc --project tui/tsconfig.json`
Expected: Pass (no output)

- [ ] **Step 4: Commit**

```bash
git add tui/lib/types.ts tui/lib/redis.ts
git commit -m "Add TUI types and Redis query layer"
```

---

### Task 7: Create polling hook

React hook that polls Redis on an interval and provides data to all components.

**Files:**
- Create: `tui/lib/usePolling.ts`

- [ ] **Step 1: Create `tui/lib/usePolling.ts`**

```typescript
import { useState, useEffect, useCallback } from "react";
import type { DashboardData } from "./types.js";
import { fetchUnifiedLogs, fetchMemoryKeys, fetchTokenLog, testConnection } from "./redis.js";

const POLL_INTERVAL = 3000;

const EMPTY: DashboardData = {
  logs: [],
  memoryKeys: [],
  tokenLog: [],
  connected: false,
  lastPoll: "",
};

export function usePolling(): DashboardData {
  const [data, setData] = useState<DashboardData>(EMPTY);

  const poll = useCallback(async () => {
    try {
      const [logs, memoryKeys, tokenLog, connected] = await Promise.all([
        fetchUnifiedLogs(100),
        fetchMemoryKeys(),
        fetchTokenLog(100),
        testConnection(),
      ]);
      setData({ logs, memoryKeys, tokenLog, connected, lastPoll: new Date().toISOString() });
    } catch {
      setData((prev) => ({ ...prev, connected: false }));
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL);
    return () => clearInterval(id);
  }, [poll]);

  return data;
}
```

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --project tui/tsconfig.json`
Expected: Pass

- [ ] **Step 3: Commit**

```bash
git add tui/lib/usePolling.ts
git commit -m "Add usePolling hook for real-time Redis data"
```

---

## Chunk 3: TUI Components

### Task 8: Create StatusBar component

**Files:**
- Create: `tui/components/StatusBar.tsx`

- [ ] **Step 1: Create `tui/components/StatusBar.tsx`**

```tsx
import React from "react";
import { Box, Text } from "ink";

interface Props {
  activeTab: number;
  connected: boolean;
  lastPoll: string;
}

const TABS = ["Logs", "Memory", "Agents", "Tokens"];

export function StatusBar({ activeTab, connected, lastPoll }: Props): React.ReactElement {
  const time = lastPoll ? lastPoll.split("T")[1]?.split(".")[0] ?? "" : "---";
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Box gap={2}>
        {TABS.map((tab, i) => (
          <Text key={tab} color={i === activeTab ? "green" : "gray"} bold={i === activeTab}>
            [{i + 1}] {tab}
          </Text>
        ))}
      </Box>
      <Box gap={2}>
        <Text color={connected ? "green" : "red"}>{connected ? "●" : "●"} {connected ? "connected" : "disconnected"}</Text>
        <Text color="gray">{time}</Text>
        <Text color="gray">q quit</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --project tui/tsconfig.json`
Expected: Pass

- [ ] **Step 3: Commit**

```bash
git add tui/components/StatusBar.tsx
git commit -m "Add StatusBar component"
```

---

### Task 9: Create Logs panel

**Files:**
- Create: `tui/components/Logs.tsx`

- [ ] **Step 1: Create `tui/components/Logs.tsx`**

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { UnifiedLogEntry, IncomingLogEntry, AuditEntry, InferenceLogEntry } from "../lib/types.js";

interface Props {
  logs: UnifiedLogEntry[];
}

function formatTime(ts: string): string {
  return ts.split("T")[1]?.split(".")[0] ?? ts;
}

function colorForKind(kind: UnifiedLogEntry["kind"]): string {
  if (kind === "incoming") return "cyan";
  if (kind === "inference") return "magenta";
  return "yellow";
}

function renderIncoming(entry: IncomingLogEntry): string {
  const preview = entry.text.length > 60 ? entry.text.slice(0, 60) + "..." : entry.text;
  return `[${entry.messageType}] ${entry.memberId}: ${preview}`;
}

function renderAudit(entry: AuditEntry): string {
  const detail = entry.detail.length > 60 ? entry.detail.slice(0, 60) + "..." : entry.detail;
  return `${entry.action} (${entry.memberId}) ${detail}`;
}

function renderInference(entry: InferenceLogEntry): string {
  if (entry.skipped) return `inference skipped (${entry.memberId})`;
  const keys = entry.writes.map((w) => w.key).join(", ");
  return `inference wrote: ${keys} (${entry.memberId})`;
}

function renderEntry(entry: UnifiedLogEntry): string {
  if (entry.kind === "incoming") return renderIncoming(entry.data as IncomingLogEntry);
  if (entry.kind === "inference") return renderInference(entry.data as InferenceLogEntry);
  return renderAudit(entry.data as AuditEntry);
}

export function Logs({ logs }: Props): React.ReactElement {
  const visible = logs.slice(0, 30);
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="white"> Unified Logs (newest first)</Text>
      <Box flexDirection="column" paddingX={1}>
        {visible.length === 0 && <Text color="gray">No log entries yet</Text>}
        {visible.map((entry, i) => (
          <Text key={i} color={entry.kind === "audit" && (entry.data as AuditEntry).action === "processing_error" ? "red" : colorForKind(entry.kind)}>
            {formatTime(entry.timestamp)} {renderEntry(entry)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --project tui/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add tui/components/Logs.tsx
git commit -m "Add Logs panel component"
```

---

### Task 10: Create Memory panel

**Files:**
- Create: `tui/components/Memory.tsx`

- [ ] **Step 1: Create `tui/components/Memory.tsx`**

```tsx
import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { fetchMemoryContent } from "../lib/redis.js";

interface Props {
  memoryKeys: string[];
  isActive: boolean;
}

export function Memory({ memoryKeys, isActive }: Props): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [content, setContent] = useState<string>("");

  useInput((input, key) => {
    if (!isActive) return;
    if (key.upArrow && selectedIndex > 0) setSelectedIndex(selectedIndex - 1);
    if (key.downArrow && selectedIndex < memoryKeys.length - 1) setSelectedIndex(selectedIndex + 1);
  }, { isActive });

  const selectedKey = memoryKeys[selectedIndex];

  useEffect(() => {
    if (!selectedKey) {
      setContent("");
      return;
    }
    let cancelled = false;
    void fetchMemoryContent(selectedKey).then((c) => {
      if (!cancelled) setContent(c);
    });
    return () => { cancelled = true; };
  }, [selectedKey]);

  return (
    <Box flexGrow={1} gap={1}>
      <Box flexDirection="column" width="30%">
        <Text bold color="white"> Memory Keys</Text>
        {memoryKeys.length === 0 && <Text color="gray"> No keys found</Text>}
        {memoryKeys.map((key, i) => (
          <Text key={key} color={i === selectedIndex ? "green" : "gray"}>
            {i === selectedIndex ? "▸ " : "  "}{key}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text bold color="white">{selectedKey ?? "No selection"}</Text>
        <Text>{content}</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Verify compiles and commit**

```bash
npx tsc --project tui/tsconfig.json
git add tui/components/Memory.tsx
git commit -m "Add Memory panel component"
```

---

### Task 11: Create Agents panel

**Files:**
- Create: `tui/components/Agents.tsx`

- [ ] **Step 1: Create `tui/components/Agents.tsx`**

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { AuditEntry, InferenceLogEntry, UnifiedLogEntry } from "../lib/types.js";

interface Props {
  logs: UnifiedLogEntry[];
}

const TOOL_NAMES = new Set([
  "read_memory", "write_memory", "delete_memory", "list_memory_keys",
  "append_memory", "list_events", "create_event", "create_recurring_event",
  "delete_calendar_event", "find_events", "confirm_action",
]);

function formatTime(ts: string): string {
  return ts.split("T")[1]?.split(".")[0] ?? ts;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

export function Agents({ logs }: Props): React.ReactElement {
  const toolCalls = logs
    .filter((e) => e.kind === "audit" && TOOL_NAMES.has((e.data as AuditEntry).action))
    .slice(0, 20);

  const inferenceRuns = logs
    .filter((e) => e.kind === "inference")
    .slice(0, 20);

  return (
    <Box flexGrow={1} gap={1}>
      <Box flexDirection="column" width="50%">
        <Text bold color="white"> Zoe — Tool Calls</Text>
        {toolCalls.length === 0 && <Text color="gray"> No tool calls yet</Text>}
        {toolCalls.map((entry, i) => {
          const a = entry.data as AuditEntry;
          return (
            <Text key={i} color="yellow">
              {formatTime(entry.timestamp)} {a.action} {truncate(a.detail, 40)}
            </Text>
          );
        })}
      </Box>
      <Box flexDirection="column" width="50%">
        <Text bold color="white"> Inference — Runs</Text>
        {inferenceRuns.length === 0 && <Text color="gray"> No inference runs yet</Text>}
        {inferenceRuns.map((entry, i) => {
          const inf = entry.data as InferenceLogEntry;
          const writeSummary = inf.skipped
            ? "skipped"
            : inf.writes.map((w) => w.key).join(", ");
          return (
            <Text key={i} color={inf.skipped ? "gray" : "green"}>
              {formatTime(entry.timestamp)} {inf.memberId} → {truncate(writeSummary, 40)}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Verify compiles and commit**

```bash
npx tsc --project tui/tsconfig.json
git add tui/components/Agents.tsx
git commit -m "Add Agents panel component"
```

---

### Task 12: Create Tokens panel

**Files:**
- Create: `tui/components/Tokens.tsx`

- [ ] **Step 1: Create `tui/components/Tokens.tsx`**

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { TokenLogEntry } from "../lib/types.js";

interface Props {
  tokenLog: TokenLogEntry[];
}

function formatTime(ts: string): string {
  return ts.split("T")[1]?.split(".")[0] ?? ts;
}

interface AgentTotals {
  calls: number;
  input: number;
  output: number;
}

function sumByAgent(entries: TokenLogEntry[]): { zoe: AgentTotals; inference: AgentTotals } {
  const zoe: AgentTotals = { calls: 0, input: 0, output: 0 };
  const inference: AgentTotals = { calls: 0, input: 0, output: 0 };
  for (const e of entries) {
    const target = e.agent === "zoe" ? zoe : inference;
    target.calls++;
    target.input += e.input_tokens;
    target.output += e.output_tokens;
  }
  return { zoe, inference };
}

function renderTotals(label: string, totals: AgentTotals, color: string): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold color={color}> {label}</Text>
      <Text> Calls: {totals.calls}</Text>
      <Text> Input: {totals.input.toLocaleString()} tokens</Text>
      <Text> Output: {totals.output.toLocaleString()} tokens</Text>
      <Text> Total: {(totals.input + totals.output).toLocaleString()} tokens</Text>
    </Box>
  );
}

export function Tokens({ tokenLog }: Props): React.ReactElement {
  const totals = sumByAgent(tokenLog);
  const recent = tokenLog.slice(0, 20);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box gap={4} marginBottom={1}>
        {renderTotals("Zoe (main)", totals.zoe, "cyan")}
        {renderTotals("Inference", totals.inference, "magenta")}
      </Box>
      <Text bold color="white"> Recent Calls</Text>
      {recent.length === 0 && <Text color="gray"> No token data yet</Text>}
      {recent.map((entry, i) => (
        <Text key={i} color={entry.agent === "zoe" ? "cyan" : "magenta"}>
          {formatTime(entry.timestamp)} {entry.agent.padEnd(10)} in:{entry.input_tokens} out:{entry.output_tokens}
        </Text>
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Verify compiles and commit**

```bash
npx tsc --project tui/tsconfig.json
git add tui/components/Tokens.tsx
git commit -m "Add Tokens panel component"
```

---

## Chunk 4: App Shell & Integration

### Task 13: Create the app entry point

Wire all panels together with tab navigation, polling, and keyboard input.

**Files:**
- Create: `tui/app.tsx`

- [ ] **Step 1: Create `tui/app.tsx`**

```tsx
import React, { useState } from "react";
import { render, Box, useInput, useApp } from "ink";
import { config } from "dotenv";
import { initRedis } from "./lib/redis.js";
import { usePolling } from "./lib/usePolling.js";
import { Logs } from "./components/Logs.js";
import { Memory } from "./components/Memory.js";
import { Agents } from "./components/Agents.js";
import { Tokens } from "./components/Tokens.js";
import { StatusBar } from "./components/StatusBar.js";

config({ path: ".env" });

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  process.stderr.write("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN in .env\n");
  process.exit(1);
}
initRedis(url, token);

function Dashboard(): React.ReactElement {
  const [tab, setTab] = useState(0);
  const data = usePolling();
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === "q") exit();
    if (input === "1") setTab(0);
    if (input === "2") setTab(1);
    if (input === "3") setTab(2);
    if (input === "4") setTab(3);
    if (key.tab) setTab((t) => (t + 1) % 4);
  });

  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1}>
        {tab === 0 && <Logs logs={data.logs} />}
        {tab === 1 && <Memory memoryKeys={data.memoryKeys} isActive={tab === 1} />}
        {tab === 2 && <Agents logs={data.logs} />}
        {tab === 3 && <Tokens tokenLog={data.tokenLog} />}
      </Box>
      <StatusBar activeTab={tab} connected={data.connected} lastPoll={data.lastPoll} />
    </Box>
  );
}

render(<Dashboard />);
```

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --project tui/tsconfig.json`
Expected: Pass

- [ ] **Step 3: Run the TUI**

Run: `npx tsx tui/app.tsx`
Expected: Dashboard renders with tab navigation, shows data from Redis, polls every 3s. Press q to quit.

- [ ] **Step 4: Commit**

```bash
git add tui/app.tsx
git commit -m "Add TUI app entry point with tab navigation and polling"
```

---

### Task 14: Final integration test and push

- [ ] **Step 1: Run main project quality gate**

Run: `npm run typecheck && npm run lint -- --ignore-pattern '.claude/'`
Expected: Pass (tui/ excluded from both)

- [ ] **Step 2: Run TUI typecheck**

Run: `npx tsc --project tui/tsconfig.json`
Expected: Pass

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All existing tests pass (no regressions from backend changes)

- [ ] **Step 4: Launch TUI and verify all panels**

Run: `npx tsx tui/app.tsx`
Verify: All 4 tabs render, data loads from Redis, status bar shows connected.

- [ ] **Step 5: Push**

```bash
git push origin main
```
