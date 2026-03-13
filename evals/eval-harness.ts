/**
 * Eval harness: runs scenarios against real Claude + digital twins.
 * SpyClaude wraps the real API client and records all tool calls.
 */

import type {
  ClaudeClient,
  ClaudeMessage,
  ClaudeMessageParams,
} from "../lib/deps.js";
import type { AgentDeps, AgentParams } from "../lib/agent.js";
import type { FamilyMember } from "../lib/types.js";
import { RedisTwin } from "../twins/redis.js";
import { CalendarTwin } from "../twins/calendar.js";
import { CalendarProviderTwin } from "../twins/calendar-provider.js";
import { createNotionTwin } from "../twins/notion.js";
import { invokeAgent } from "../lib/agent.js";
import { upsertMember } from "../lib/registry.js";

// --- SpyClaude: wraps real client, records tool calls ---

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

  reset(): void {
    this.toolCalls.length = 0;
    this.responses.length = 0;
  }
}

// --- Scenario types ---

export interface EvalScenario {
  name: string;
  description: string;
  userMessage: string;
  imageBase64?: string;
  calendarConnected: boolean;
  assertions: EvalAssertion[];
}

export type EvalAssertion =
  | { type: "response_contains"; text: string }
  | { type: "response_not_contains"; text: string }
  | { type: "tool_called"; name: string; minCount?: number }
  | { type: "tool_not_called"; name: string }
  | { type: "no_markdown" }
  | { type: "custom"; name: string; fn: (ctx: EvalResult) => boolean };

export interface EvalResult {
  scenario: string;
  response: string;
  toolCalls: ToolCall[];
  calendarEvents: string[];
  passed: AssertionResult[];
  failed: AssertionResult[];
  durationMs: number;
}

export interface AssertionResult {
  assertion: string;
  passed: boolean;
  detail?: string;
}

// --- Runner ---

const FIXED_DATE = new Date("2026-03-10T12:00:00Z");

const TEST_MEMBER: FamilyMember = {
  id: "eval-user",
  name: "Test User",
  chatId: 100000,
  timezone: "Pacific/Auckland",
  role: "parent",
  isAdmin: false,
};

export async function runScenario(
  claude: ClaudeClient,
  scenario: EvalScenario,
): Promise<EvalResult> {
  const spy = new SpyClaude(claude);
  const clock = { now: () => FIXED_DATE };
  const redis = new RedisTwin(clock);
  const calendarTwin = new CalendarTwin();
  const calendarProvider = new CalendarProviderTwin(calendarTwin, scenario.calendarConnected);

  const { client: notion } = createNotionTwin();
  const deps: AgentDeps = { claude: spy, redis, calendar: calendarProvider, clock, notion };

  await upsertMember({ redis }, TEST_MEMBER);

  const params: AgentParams = {
    member: TEST_MEMBER,
    userMessage: scenario.userMessage,
    imageBase64: scenario.imageBase64,
    conversationHistory: [],
  };

  const start = Date.now();
  const response = await invokeAgent(deps, params);
  const durationMs = Date.now() - start;

  const events = await calendarTwin.listEvents({
    timeMin: "2020-01-01T00:00:00Z",
    timeMax: "2030-12-31T00:00:00Z",
  });
  const calendarEvents = events.items.map((e) => e.summary);

  const passed: AssertionResult[] = [];
  const failed: AssertionResult[] = [];

  for (const assertion of scenario.assertions) {
    const result = checkAssertion(assertion, {
      scenario: scenario.name,
      response,
      toolCalls: spy.toolCalls,
      calendarEvents,
      passed: [],
      failed: [],
      durationMs,
    });
    if (result.passed) {
      passed.push(result);
    } else {
      failed.push(result);
    }
  }

  return { scenario: scenario.name, response, toolCalls: spy.toolCalls, calendarEvents, passed, failed, durationMs };
}

// --- Assertion checkers ---

function checkContains(text: string, response: string): AssertionResult {
  const ok = response.toLowerCase().includes(text.toLowerCase());
  return { assertion: `response contains "${text}"`, passed: ok, detail: ok ? undefined : `response: ${response.substring(0, 200)}` };
}

function checkNotContains(text: string, response: string): AssertionResult {
  const ok = !response.toLowerCase().includes(text.toLowerCase());
  return { assertion: `response does not contain "${text}"`, passed: ok, detail: ok ? undefined : `found in: ${response.substring(0, 200)}` };
}

function checkToolCalled(name: string, minCount: number, calls: ToolCall[]): AssertionResult {
  const count = calls.filter((t) => t.name === name).length;
  const ok = count >= minCount;
  return { assertion: `tool "${name}" called >= ${String(minCount)} times`, passed: ok, detail: `called ${String(count)} times` };
}

function checkNoMarkdown(response: string): AssertionResult {
  const patterns = /\*\*|__|``|^#{1,3} /m;
  const ok = !patterns.test(response);
  return { assertion: "no markdown in response", passed: ok, detail: ok ? undefined : `response: ${response.substring(0, 200)}` };
}

function checkAssertion(assertion: EvalAssertion, ctx: EvalResult): AssertionResult {
  switch (assertion.type) {
    case "response_contains": return checkContains(assertion.text, ctx.response);
    case "response_not_contains": return checkNotContains(assertion.text, ctx.response);
    case "tool_called": return checkToolCalled(assertion.name, assertion.minCount ?? 1, ctx.toolCalls);
    case "tool_not_called": {
      const c = ctx.toolCalls.filter((t) => t.name === assertion.name).length;
      return { assertion: `tool "${assertion.name}" not called`, passed: c === 0, detail: `called ${String(c)} times` };
    }
    case "no_markdown": return checkNoMarkdown(ctx.response);
    case "custom": return { assertion: assertion.name, passed: assertion.fn(ctx) };
  }
}
