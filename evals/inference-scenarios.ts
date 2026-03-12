/**
 * Eval scenarios for the inference agent — tests knowledge extraction
 * and memory organization from conversation turns.
 */

import type { InferenceDeps, ConversationTurn, MemoryWrite } from "../lib/inference.js";
import type { ClaudeClient, RedisClient, Clock } from "../lib/deps.js";
import type { FamilyMember } from "../lib/types.js";
import { RedisTwin } from "../twins/redis.js";
import { runInference } from "../lib/inference.js";
import { readMemory } from "../lib/memory.js";
import { upsertMember } from "../lib/registry.js";

export interface InferenceScenario {
  name: string;
  description: string;
  member: { name: string; id: string };
  turn: ConversationTurn;
  seedMemory?: { key: string; content: string }[];
  assertions: InferenceAssertion[];
}

export type InferenceAssertion =
  | { type: "writes_key"; pattern: string }
  | { type: "content_contains"; key: string; text: string }
  | { type: "no_writes" }
  | { type: "does_not_write_key"; pattern: string }
  | { type: "custom"; name: string; fn: (result: InferenceResult) => boolean };

export interface InferenceResult {
  scenario: string;
  writes: MemoryWrite[];
  passed: { assertion: string; passed: true }[];
  failed: { assertion: string; passed: false; detail?: string }[];
  durationMs: number;
}

const CLOCK: Clock = { now: () => new Date("2026-03-10T12:00:00Z") };

function makeMember(name: string, id: string): FamilyMember {
  return { id, name, chatId: 100000, timezone: "Pacific/Auckland", role: "parent", isAdmin: false };
}

export async function runInferenceScenario(
  claude: ClaudeClient,
  scenario: InferenceScenario,
): Promise<InferenceResult> {
  const redis = new RedisTwin(CLOCK);
  const deps: InferenceDeps = { claude, redis, clock: CLOCK };
  const member = makeMember(scenario.member.name, scenario.member.id);

  await upsertMember({ redis }, member);

  if (scenario.seedMemory) {
    for (const seed of scenario.seedMemory) {
      await redis.execute(["SET", "memory:" + seed.key, seed.content]);
    }
  }

  const start = Date.now();
  const writes = await runInference(deps, member, scenario.turn);
  const durationMs = Date.now() - start;

  const passed: { assertion: string; passed: true }[] = [];
  const failed: { assertion: string; passed: false; detail?: string }[] = [];
  const evalResult: InferenceResult = { scenario: scenario.name, writes, passed, failed, durationMs };

  for (const assertion of scenario.assertions) {
    const check = await checkInferenceAssertion(assertion, evalResult, redis);
    if (check.passed) {
      passed.push({ assertion: check.assertion, passed: true });
    } else {
      failed.push({ assertion: check.assertion, passed: false, detail: check.detail });
    }
  }

  return evalResult;
}

async function checkInferenceAssertion(
  assertion: InferenceAssertion,
  result: InferenceResult,
  redis: RedisClient,
): Promise<{ assertion: string; passed: boolean; detail?: string }> {
  const { writes } = result;
  switch (assertion.type) {
    case "writes_key": {
      const match = writes.some((w) => w.key.includes(assertion.pattern));
      const keys = writes.map((w) => w.key).join(", ");
      return { assertion: "writes key matching '" + assertion.pattern + "'", passed: match, detail: "wrote: " + (keys || "nothing") };
    }
    case "does_not_write_key": {
      const match = writes.some((w) => w.key.includes(assertion.pattern));
      return { assertion: "does not write key matching '" + assertion.pattern + "'", passed: !match };
    }
    case "content_contains": {
      const content = await readMemory({ redis }, assertion.key);
      const has = content?.toLowerCase().includes(assertion.text.toLowerCase()) === true;
      return { assertion: "key '" + assertion.key + "' contains '" + assertion.text + "'", passed: has, detail: content ?? "key not found" };
    }
    case "no_writes": {
      const ok = writes.length === 0;
      const keys = writes.map((w) => w.key).join(", ");
      return { assertion: "no memory writes", passed: ok, detail: "wrote: " + keys };
    }
    case "custom": {
      const ok = assertion.fn(result);
      return { assertion: assertion.name, passed: ok };
    }
  }
}

const KATE = { name: "Kate", id: "kate" };
const CAM_KEY = "family/members/cam";
const CAM_PATTERN = "members/cam";

export const INFERENCE_SCENARIOS: InferenceScenario[] = [
  {
    name: "extract-child-activity",
    description: "Extracts child name and activity from soccer practice request",
    member: KATE,
    turn: {
      userMessage: "Can you add Cam's soccer practices to the calendar? They're every Saturday at 10am at Hagley Park, starting May 3rd.",
      assistantReply: "I've created the soccer practice events for Cam every Saturday at 10am at Hagley Park starting May 3rd.",
    },
    assertions: [
      { type: "writes_key", pattern: "activities/" },
      {
        type: "custom",
        name: "activity doc mentions Hagley Park",
        fn: (r) => r.writes.some((w) => w.key.includes("activities/") && w.content.toLowerCase().includes("hagley")),
      },
      {
        type: "custom",
        name: "some doc mentions Cam",
        fn: (r) => r.writes.some((w) => w.content.toLowerCase().includes("cam")),
      },
    ],
  },

  {
    name: "extract-school-info",
    description: "Extracts school name from conversation about school events",
    member: KATE,
    turn: {
      userMessage: "There's a parent-teacher evening at Elmwood School on Thursday the 20th.",
      assistantReply: "I've added the parent-teacher evening at Elmwood School on Thursday March 20th to the calendar.",
    },
    assertions: [
      { type: "writes_key", pattern: "elmwood" },
      {
        type: "custom",
        name: "doc mentions school",
        fn: (r) => r.writes.some((w) => w.content.toLowerCase().includes("school")),
      },
    ],
  },

  {
    name: "merge-existing-member",
    description: "Merges new facts into existing member profile",
    member: KATE,
    seedMemory: [
      { key: CAM_KEY, content: "Name: Cam\nParent: Kate\nActivity: Soccer on Saturdays" },
    ],
    turn: {
      userMessage: "Cam also started netball on Thursdays after school.",
      assistantReply: "Noted! I'll remember that Cam has netball on Thursdays after school.",
    },
    assertions: [
      {
        type: "custom",
        name: "netball info stored somewhere",
        fn: (r) => r.writes.some((w) => w.content.toLowerCase().includes("netball")),
      },
      {
        type: "custom",
        name: "existing soccer info preserved",
        fn: (r) => r.writes.some((w) => w.content.toLowerCase().includes("soccer")),
      },
    ],
  },

  {
    name: "skip-chitchat",
    description: "Does not write memory for casual conversation",
    member: { name: "Marius", id: "marius" },
    turn: {
      userMessage: "Thanks Zoe!",
      assistantReply: "You're welcome! Let me know if you need anything else.",
    },
    assertions: [
      { type: "no_writes" },
    ],
  },

  {
    name: "extract-family-dates",
    description: "Extracts birthdays and important dates",
    member: KATE,
    turn: {
      userMessage: "Cam's birthday is on June 15th, she's turning 10 this year.",
      assistantReply: "Happy upcoming birthday to Cam! I'll remember she's turning 10 on June 15th.",
    },
    assertions: [
      { type: "writes_key", pattern: CAM_PATTERN },
      { type: "content_contains", key: CAM_KEY, text: "June 15" },
    ],
  },
];
