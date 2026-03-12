---
name: create-subagent
description: Guide for building a subagent — a secondary, cheaper Claude call that runs alongside or after a main agent to handle a focused task like extraction, classification, summarization, or validation. Use when the user wants to add a background AI task, a post-processing step, an inference agent, or any structured single-call Claude pipeline. Triggers on "add a subagent", "create an inference agent", "secondary agent", "background extraction", "post-reply processing", or similar.
---

# Create Subagent: $ARGUMENTS

A subagent is a secondary Claude call that handles a focused task — extraction, classification, summarization, validation — using a cheaper/faster model than the main agent. It takes structured input, makes a single Claude call with no tools, and returns structured JSON.

This skill walks through the full process: defining the interface, writing the system prompt, implementing the module, wiring it in safely, and adding evals.

## Why subagents?

Stuffing everything into one system prompt makes it bloated and unreliable. Subagents keep concerns separated: the main agent handles conversation and tool use, while subagents handle focused background tasks cheaply. They fail independently — a subagent error never breaks the main user flow.

## The pattern

Every subagent has the same shape:

1. **Deps interface** — only the external services it actually needs (Claude client, database, clock)
2. **Input/output types** — what goes in, what structured JSON comes out
3. **Version constant** — `export const {NAME}_VERSION = "v1"` for tracking prompt iterations
4. **System prompt** — focused instructions ending with "respond with ONLY a JSON ..."
5. **Single run function** — gathers context, one Claude call, parses JSON, executes side effects
6. **Safe wrapper** — called from the main handler, catches all errors silently
7. **Evals** — scenarios testing the subagent against real Claude

## Step 1: Define purpose and interface

Before writing code, answer these questions:

- **What does this subagent do?** One sentence.
- **When does it run?** After the main reply? Before? On a schedule?
- **What input does it need?** The conversation? A document? User metadata?
- **What output does it produce?** A list of writes? A classification label? A summary?
- **What side effects does it have?** Database writes? API calls? None?

Then define the types:

```typescript
// Only include deps the subagent actually uses
export interface SubagentDeps {
  claude: ClaudeClient;
  db: DatabaseClient;    // if needed
  clock: Clock;          // if needed
}

export interface SubagentInput {
  // what the caller passes in
}

export interface SubagentOutput {
  // the shape of each item Claude returns in its JSON response
}

export const SUBAGENT_VERSION = "v1";
```

The version constant lets you track which prompt version produced which results — essential when iterating on the system prompt.

## Step 2: Write the system prompt

The system prompt is the heart of the subagent. It should be short, specific, and end with an exact output format.

```typescript
const MODEL = "claude-sonnet-4-20250514";  // cheap and fast for background work
const MAX_TOKENS = 2048;

const SYSTEM_PROMPT = `You are a {role}. You {task description}.

{Taxonomy, schema, or categories if the output has structure}

Rules:
- {Concrete rule about what to extract/produce}
- {Concrete rule about what to skip}
- {Rule about preserving existing data if doing merges}
- If nothing to {do}, return {empty value}.

Respond with ONLY a JSON {array|object}. Each item has: {"field": "description", ...}.
If nothing to return, respond with [].`;
```

Key principles:
- **Use a cheap model.** Subagents do focused work — Sonnet-class models are plenty capable and much cheaper than Opus.
- **Be explicit about output format.** Show the exact JSON shape. Claude follows format instructions reliably when they're unambiguous.
- **State what to skip.** Prevents hallucinated output on empty/irrelevant input.
- **Include merge rules** if the subagent updates existing data. "You MUST include existing content plus new facts" prevents data loss.

## Step 3: Implement the module

```typescript
export async function runSubagent(
  deps: SubagentDeps,
  input: SubagentInput,
): Promise<SubagentOutput[]> {
  // 1. Gather context (load existing data if needed)
  const context = await gatherContext(deps);

  // 2. Build the user prompt
  const userPrompt = buildUserPrompt(input, context);

  // 3. Single Claude call — no tools
  const response = await deps.claude.createMessage({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  // 4. Parse structured JSON from response
  const results = parseResults(response.content);

  // 5. Execute side effects
  for (const result of results) {
    await applySideEffect(deps, result);
  }

  return results;
}
```

### User prompt builder

Assemble all context into a single string. Include existing data so Claude can merge rather than overwrite.

```typescript
function buildUserPrompt(
  input: SubagentInput,
  context: Map<string, string>,
): string {
  const parts: string[] = [];
  parts.push("Input: " + JSON.stringify(input));

  if (context.size > 0) {
    parts.push("\nExisting data:");
    for (const [key, value] of context) {
      parts.push("--- " + key + " ---");
      parts.push(value);
    }
  }

  parts.push("\nReturn JSON array (or [] if nothing to return):");
  return parts.join("\n");
}
```

### JSON parser

Claude sometimes wraps JSON in markdown fences or adds preamble. This parser handles that robustly:

```typescript
function parseResults(
  content: { type: string; [key: string]: unknown }[],
): SubagentOutput[] {
  for (const block of content) {
    if (block.type !== "text" || typeof block.text !== "string") continue;
    try {
      const parsed: unknown = JSON.parse(extractJson(block.text.trim()));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidOutput);
    } catch {
      return [];
    }
  }
  return [];
}

function extractJson(text: string): string {
  // Handle both bare JSON and markdown-fenced JSON
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) return text.substring(start, end + 1);
  return text;
}

// Runtime type guard — validate each item from Claude's response
function isValidOutput(v: unknown): v is SubagentOutput {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.requiredField === "string"; // adjust per your output type
}
```

Parse defensively. Claude's output is untrusted — always validate the shape at runtime with a type guard. Return empty on parse failure rather than throwing.

## Step 4: Wire it in safely

The subagent should never break the main flow. Wrap it in a try/catch that swallows errors:

```typescript
async function runSubagentSafe(
  deps: Deps,
  input: SubagentInput,
): Promise<void> {
  try {
    await runSubagent(deps, input);
  } catch {
    // Subagent failure is non-critical
  }
}
```

Call the safe wrapper at the appropriate point in your main handler — typically after the primary response has been sent to the user.

### Test implications

If your main handler tests use a stub/mock Claude client, the subagent will trigger an extra `createMessage` call. Tests that assert on the last call's parameters may need updating to check `allCalls[0]` (the main agent) instead of `lastCall` (which is now the subagent).

## Step 5: Add evals

Subagent evals run the real subagent against a real Claude API with test doubles for everything else (database, clock, etc.). They verify that Claude's actual output meets assertions.

### Scenario structure

```typescript
export interface Scenario {
  name: string;
  description: string;
  input: SubagentInput;
  seedData?: { key: string; content: string }[];  // pre-populate test DB
  assertions: Assertion[];
}

export type Assertion =
  | { type: "result_contains"; text: string }
  | { type: "no_results" }
  | { type: "custom"; name: string; fn: (results: SubagentOutput[]) => boolean };
```

### Recommended starting scenarios

Write 4-5 scenarios covering:

1. **Happy path** — clear input, verify correct structured output
2. **Merge with existing** — seed data present, verify old + new preserved
3. **Nothing to do** — irrelevant input, should return empty
4. **Multiple entities** — input with several things to extract/process
5. **Edge case** — ambiguous or unusual input

### CLI runner

```typescript
const results = [];
for (const scenario of scenarios) {
  const result = await runScenario(claude, scenario);
  results.push(result);
}

// Save artifact with version for tracking over time
const artifact = {
  version: SUBAGENT_VERSION,
  model: MODEL,
  timestamp: new Date().toISOString(),
  summary: { total: results.length, passed, failed },
  scenarios: results,
};
writeFileSync(`evals/results/subagent-${SUBAGENT_VERSION}-${timestamp}.json`, JSON.stringify(artifact, null, 2));
```

The version constant in the artifact lets you compare results across prompt iterations.

## Checklist

- [ ] Types defined: deps (minimal), input, output
- [ ] Version constant exported: `{NAME}_VERSION = "v1"`
- [ ] System prompt: focused, explicit JSON output format, skip/empty rules
- [ ] Model: Sonnet-class (cheap) unless the task genuinely needs Opus
- [ ] Single run function: gather context, build prompt, one Claude call, parse JSON, side effects
- [ ] JSON parser: handles fences and preamble, type guard validates shape, returns empty on failure
- [ ] Safe wrapper: try/catch that swallows errors, called from main handler
- [ ] Tests updated for extra Claude call
- [ ] 4-5 eval scenarios with assertions
- [ ] Eval runner with version tracking and result artifacts
- [ ] All project quality checks pass
