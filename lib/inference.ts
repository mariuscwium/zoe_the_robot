/**
 * Inference agent — runs after the main reply to extract and store
 * family knowledge from conversations. Uses a single Claude call
 * with no tools; returns structured JSON that we execute directly.
 */

import type { ClaudeClient, RedisClient, Clock } from "./deps.js";
import type { FamilyMember } from "./types.js";
import { listMemoryKeys, readMemory, writeMemory } from "./memory.js";

export interface InferenceDeps {
  claude: ClaudeClient;
  redis: RedisClient;
  clock: Clock;
}

export interface ConversationTurn {
  userMessage: string;
  assistantReply: string;
}

export interface MemoryWrite {
  key: string;
  content: string;
}

export const INFERENCE_VERSION = "v2";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 2048;

const TAXONOMY = `Memory taxonomy (use these key patterns):
- family/members/<first-name> — profile: name, age, school, allergies, preferences
- family/activities/<name> — recurring activity: schedule, location, which family member, season/term
- family/places/<name> — school, sports ground, doctor, etc: address, hours, contacts
- family/routines/<name> — morning routine, pack lists, weekly rhythm
- family/docs/<slug> — extracted info from newsletters, notices, forms
- family/lists/<name> — shopping, todos, wishlists
- family/dates — birthdays, anniversaries, term dates, public holidays`;

const SYSTEM_PROMPT = `You are a family knowledge extractor. You review a conversation between a family member and their assistant Zoe, then identify facts worth remembering.

${TAXONOMY}

Rules:
- Only extract concrete facts (names, ages, schools, schedules, locations, preferences). Skip chitchat.
- When an existing doc is provided, you MUST include its full content plus the new facts in your write. Never discard existing info.
- Extract ALL entities mentioned: people, places, activities. Create or update a doc for each.
- If a child is mentioned doing an activity, update BOTH the child's member doc AND the activity doc.
- Use the first name (lowercase) for member keys, activity names (lowercase, hyphenated) for activity keys.
- Keep docs concise: plain text, one fact per line, no markdown formatting.
- If a conversation reveals nothing new worth storing, return an empty array.
- Never store conversation content verbatim. Distill into structured facts.

Respond with ONLY a JSON array of writes. Each write is {"key": "family/...", "content": "full updated doc content"}.
If nothing to store, respond with [].`;

export async function runInference(
  deps: InferenceDeps,
  member: FamilyMember,
  turn: ConversationTurn,
): Promise<MemoryWrite[]> {
  const existingKeys = await listMemoryKeys(deps, "memory:family:*");
  const existingDocs = await loadRelevantDocs(deps, existingKeys);
  const userPrompt = buildUserPrompt(member, turn, existingKeys, existingDocs);

  const response = await deps.claude.createMessage({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const writes = parseWrites(response.content);
  for (const write of writes) {
    await writeMemory(deps, write.key, write.content);
  }
  return writes;
}

async function loadRelevantDocs(
  deps: InferenceDeps,
  keys: string[],
): Promise<Map<string, string>> {
  const docs = new Map<string, string>();
  const relevantPrefixes = ["memory:family:members:", "memory:family:activities:", "memory:family:dates"];
  const toLoad = keys.filter((k) => relevantPrefixes.some((p) => k.startsWith(p)));

  for (const fullKey of toLoad) {
    const shortKey = fullKey.replace(/^memory:/, "");
    const content = await readMemory(deps, shortKey);
    if (content !== null) {
      docs.set(shortKey, content);
    }
  }
  return docs;
}

function buildUserPrompt(
  member: FamilyMember,
  turn: ConversationTurn,
  existingKeys: string[],
  existingDocs: Map<string, string>,
): string {
  const parts: string[] = [];
  parts.push("Family member speaking: " + member.name);
  parts.push("");
  parts.push("Conversation turn:");
  parts.push(member.name + ": " + turn.userMessage);
  parts.push("Zoe: " + turn.assistantReply);

  if (existingKeys.length > 0) {
    const shortKeys = existingKeys.map((k) => k.replace(/^memory:/, ""));
    parts.push("");
    parts.push("Existing memory keys: " + shortKeys.join(", "));
  }

  if (existingDocs.size > 0) {
    parts.push("");
    parts.push("Existing docs:");
    for (const [key, content] of existingDocs) {
      parts.push("--- " + key + " ---");
      parts.push(content);
    }
  }

  parts.push("");
  parts.push("Return JSON array of memory writes (or [] if nothing new to store):");
  return parts.join("\n");
}

function parseWrites(
  content: { type: string; [key: string]: unknown }[],
): MemoryWrite[] {
  for (const block of content) {
    if (block.type !== "text" || typeof block.text !== "string") continue;
    const text = block.text.trim();
    try {
      const parsed: unknown = JSON.parse(extractJson(text));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isMemoryWrite);
    } catch {
      return [];
    }
  }
  return [];
}

function extractJson(text: string): string {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) return text;
  return text.substring(start, end + 1);
}

function isMemoryWrite(v: unknown): v is MemoryWrite {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.key === "string" && typeof obj.content === "string";
}
