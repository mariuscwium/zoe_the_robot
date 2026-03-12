---
name: create-evals
description: Guide for building a lightweight eval framework to test AI agent behavior against a real Claude API. Use when the user wants to add evals, benchmarks, or regression tests for an LLM-powered feature — things like verifying tool calls, response quality, structured output, or prompt behavior. Triggers on "add evals", "create eval framework", "test the agent", "benchmark the prompt", "track prompt regressions", or any request to systematically verify AI agent output.
---

# Create Evals: $ARGUMENTS

This skill walks through building a lightweight eval framework for testing AI agent behavior against a real Claude API. Unlike unit tests (which use stubs), evals hit the real model to catch regressions in prompt behavior, tool usage, and response quality.

The framework has three pieces: a **harness** that runs scenarios, **scenario files** that define inputs and assertions, and a **CLI runner** that produces versioned result artifacts.

## Why evals?

Unit tests verify your code logic. Evals verify your *prompt* logic. When you change a system prompt, bump a model version, or adjust tool definitions, unit tests still pass — but the agent might behave differently. Evals catch that.

They also give you a baseline to iterate against. Without evals, prompt changes are vibes-based. With them, you can see "v1 passed 4/6, v2 passes 5/6, v3 passes 6/6."

## Architecture

```
evals/
├── eval-harness.ts      # SpyClaude wrapper, scenario runner, assertion checkers
├── scenarios.ts          # Scenario definitions with assertions
├── run.ts               # CLI entry point with version tracking + artifacts
└── results/             # JSON artifacts (gitignored)
    ├── v1-2026-03-10T12-00-00.json
    └── v2-2026-03-11T14-30-00.json
```

## Step 1: SpyClaude wrapper

The SpyClaude wraps a real Claude client to record all interactions without changing behavior. This lets assertions inspect what tools were called, what responses came back, and how many iterations the agent loop took.

```typescript
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export class SpyClaude implements ClaudeClient {
  readonly toolCalls: ToolCall[] = [];
  readonly responses: ClaudeMessage[] = [];

  constructor(private readonly inner: ClaudeClient) {}

  async createMessage(params: ClaudeMessageParams): Promise<ClaudeMessage> {
    const response = await this.inner.createMessage(params);
    this.responses.push(response);
    for (const block of response.content) {
      if (block.type === "tool_use") {
        this.toolCalls.push({
          name: block.name as string,
          input: block.input as Record<string, unknown>,
        });
      }
    }
    return response;
  }
}
```

The spy sits between your agent and the real API. Your agent code doesn't know it's being observed — it makes normal Claude calls and gets normal responses. The spy just records everything that flows through.

If your project already has a `ClaudeClient` interface, implement it. If not, define a minimal one that matches what the Anthropic SDK returns.

## Step 2: Test doubles for side effects

Evals should hit the real Claude API but fake everything else — database, external APIs, clocks. This isolates what you're testing (the prompt/model behavior) from infrastructure concerns.

For each external dependency your agent uses:

- **Database**: Use an in-memory implementation (Map-based, or whatever your test suite already has)
- **External APIs**: Use a recording fake that captures calls and returns plausible responses
- **Clock**: Use a fixed date so time-dependent behavior is deterministic

```typescript
const FIXED_DATE = new Date("2026-03-10T12:00:00Z");
const clock = { now: () => FIXED_DATE };
```

If your project already has test doubles (mocks, twins, fakes), reuse them. Don't build new ones just for evals.

## Step 3: Define scenario and assertion types

```typescript
export interface EvalScenario {
  name: string;
  description: string;
  // Input fields — whatever your agent needs
  userMessage: string;
  // Setup flags — control test environment
  featureEnabled: boolean;
  seedData?: { key: string; content: string }[];
  // What to check
  assertions: EvalAssertion[];
}
```

### Assertion types

Start with these core assertion types and add more as needed:

```typescript
export type EvalAssertion =
  | { type: "response_contains"; text: string }
  | { type: "response_not_contains"; text: string }
  | { type: "tool_called"; name: string; minCount?: number }
  | { type: "tool_not_called"; name: string }
  | { type: "no_markdown" }
  | { type: "custom"; name: string; fn: (ctx: EvalResult) => boolean };
```

- **response_contains/not_contains** — verify the agent says (or avoids) specific things
- **tool_called/not_called** — verify the agent actually uses (or avoids) tools, not just claims to
- **no_markdown** — catches formatting that doesn't belong in plain-text outputs
- **custom** — escape hatch for anything else; takes the full result context

Custom assertions are powerful — use them for checking database state after the agent runs, verifying structured output shape, or any domain-specific logic.

### Result types

```typescript
export interface EvalResult {
  scenario: string;
  response: string;
  toolCalls: ToolCall[];
  passed: AssertionResult[];
  failed: AssertionResult[];
  durationMs: number;
  // Add domain-specific fields as needed (e.g., created records, side effects)
}

export interface AssertionResult {
  assertion: string;
  passed: boolean;
  detail?: string;  // shown on failure to help debug
}
```

Include domain-specific fields in `EvalResult` that your assertions need. For instance, if your agent creates database records, add a field that captures them after the run so assertions can inspect them.

## Step 4: Scenario runner

The runner sets up the test environment, runs the agent, collects results, and checks assertions.

```typescript
export async function runScenario(
  claude: ClaudeClient,
  scenario: EvalScenario,
): Promise<EvalResult> {
  // 1. Set up test doubles
  const spy = new SpyClaude(claude);
  const db = new InMemoryDB();
  const clock = { now: () => FIXED_DATE };

  // 2. Seed any initial data
  if (scenario.seedData) {
    for (const seed of scenario.seedData) {
      await db.set(seed.key, seed.content);
    }
  }

  // 3. Run the agent
  const start = Date.now();
  const response = await yourAgent(
    { claude: spy, db, clock },
    { message: scenario.userMessage },
  );
  const durationMs = Date.now() - start;

  // 4. Collect side effects for assertions
  const sideEffects = await collectSideEffects(db);

  // 5. Check assertions
  const passed: AssertionResult[] = [];
  const failed: AssertionResult[] = [];

  for (const assertion of scenario.assertions) {
    const result = checkAssertion(assertion, { scenario: scenario.name, response, toolCalls: spy.toolCalls, passed: [], failed: [], durationMs });
    (result.passed ? passed : failed).push(result);
  }

  return { scenario: scenario.name, response, toolCalls: spy.toolCalls, passed, failed, durationMs };
}
```

### Assertion checker

Keep individual assertion checkers as small, focused functions. A switch dispatches to them:

```typescript
function checkAssertion(assertion: EvalAssertion, ctx: EvalResult): AssertionResult {
  switch (assertion.type) {
    case "response_contains":
      return checkContains(assertion.text, ctx.response);
    case "tool_called":
      return checkToolCalled(assertion.name, assertion.minCount ?? 1, ctx.toolCalls);
    case "custom":
      return { assertion: assertion.name, passed: assertion.fn(ctx) };
    // ... etc
  }
}

function checkContains(text: string, response: string): AssertionResult {
  const ok = response.toLowerCase().includes(text.toLowerCase());
  return {
    assertion: `response contains "${text}"`,
    passed: ok,
    detail: ok ? undefined : `response: ${response.substring(0, 200)}`,
  };
}
```

Always include `detail` on failure — it saves a lot of debugging time when a scenario fails and you need to understand why.

## Step 5: Write scenarios

Start with 4-6 scenarios covering the most important behaviors:

1. **Identity/basics** — does the agent respond correctly to simple questions?
2. **Happy path tool use** — does it actually call tools when it should?
3. **Bulk/complex operations** — does it handle multiple actions in one request?
4. **Error/edge cases** — does it handle missing resources, disabled features, invalid input gracefully?
5. **Negative cases** — does it avoid doing things it shouldn't? (wrong tool, hallucinated actions, forbidden formatting)
6. **Nothing to do** — does it handle empty/irrelevant input without hallucinating actions?

```typescript
export const SCENARIOS: EvalScenario[] = [
  {
    name: "happy-path",
    description: "Creates a single item when asked clearly",
    userMessage: "Create a task called 'Buy groceries' for tomorrow",
    featureEnabled: true,
    assertions: [
      { type: "tool_called", name: "create_task", minCount: 1 },
      { type: "response_contains", text: "groceries" },
    ],
  },
  {
    name: "feature-disabled",
    description: "Explains the feature is unavailable rather than failing",
    userMessage: "Show me my tasks",
    featureEnabled: false,
    assertions: [
      { type: "tool_not_called", name: "list_tasks" },
      { type: "response_contains", text: "not available" },
    ],
  },
  // ...
];
```

Each scenario should have 2-3 assertions. More than that makes failures hard to interpret. Use custom assertions for complex checks.

## Step 6: CLI runner with version tracking

The runner is the entry point. It runs scenarios sequentially (to avoid API rate limits), prints results, and saves a versioned JSON artifact.

```typescript
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY required in .env");
  process.exit(1);
}

const claude = createClaudeClient(apiKey);

// CLI filter: `npx tsx evals/run.ts identity bulk` runs only matching scenarios
const filter = process.argv.slice(2);
const scenarios = filter.length > 0
  ? ALL_SCENARIOS.filter((s) => filter.some((f) => s.name.includes(f)))
  : ALL_SCENARIOS;

console.log(`Prompt ${PROMPT_VERSION} — running ${scenarios.length} eval(s)...\n`);

const results: EvalResult[] = [];
for (const scenario of scenarios) {
  results.push(await runOne(scenario));
}

// Summary
const totalPassed = results.filter((r) => r.failed.length === 0).length;
const totalFailed = results.filter((r) => r.failed.length > 0).length;
console.log(`\nResults: ${totalPassed} passed, ${totalFailed} failed out of ${results.length}`);

// Save versioned artifact
const artifact = {
  promptVersion: PROMPT_VERSION,
  model: "claude-sonnet-4-20250514",
  timestamp: new Date().toISOString(),
  summary: { total: results.length, passed: totalPassed, failed: totalFailed },
  scenarios: results.map((r) => ({
    name: r.scenario,
    passed: r.failed.length === 0,
    assertions: { passed: r.passed.length, failed: r.failed.length },
    durationMs: r.durationMs,
    failures: r.failed.map((f) => f.assertion),
  })),
};

const dir = "evals/results";
mkdirSync(dir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
writeFileSync(`${dir}/${PROMPT_VERSION}-${ts}.json`, JSON.stringify(artifact, null, 2) + "\n");
```

### Version tracking

Export a version constant from your agent module:

```typescript
export const PROMPT_VERSION = "v1";
```

Bump this whenever you change the system prompt. The eval artifact records which version produced which results, so you can compare across prompt iterations.

### npm script

Add to `package.json`:

```json
"eval": "npx tsx evals/run.ts"
```

### Gitignore results

Add `evals/results/` to `.gitignore` — artifacts contain timestamps and are ephemeral. The scenarios and harness are the source of truth, not the results.

## Step 7: Run and iterate

```bash
npm run eval                    # run all
npm run eval -- identity bulk   # run matching scenarios
```

When a scenario fails:

1. Read the `detail` field to understand what actually happened
2. Decide if the prompt needs fixing or the assertion was wrong
3. Bump the version constant, adjust the prompt, re-run
4. Compare the new artifact against the previous one

Evals are non-deterministic — Claude may behave differently across runs. If a scenario is flaky (passes sometimes, fails sometimes), either make the assertion more lenient or make the prompt more explicit about that behavior. Don't chase 100% pass rate if it means overfitting the prompt.

## Checklist

- [ ] SpyClaude wrapper records tool calls and responses
- [ ] Test doubles for all non-Claude dependencies (DB, APIs, clock)
- [ ] Scenario and assertion types defined
- [ ] Scenario runner: setup, run agent, collect side effects, check assertions
- [ ] Assertion checkers with `detail` on failure
- [ ] 4-6 starting scenarios covering happy path, edge cases, and negative cases
- [ ] CLI runner with filter support
- [ ] Version constant in agent module
- [ ] Versioned JSON artifacts saved to `evals/results/`
- [ ] `evals/results/` in `.gitignore`
- [ ] npm script added
- [ ] All project quality checks pass
