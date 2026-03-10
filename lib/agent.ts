/**
 * Claude agent invocation and tool loop.
 * Builds system prompt, sends messages, and iterates tool calls.
 */

import type {
  ClaudeClient,
  CalendarClient,
  RedisClient,
  Clock,
  ClaudeContentBlock,
  ClaudeConversationMessage,
} from "./deps.js";
import type { FamilyMember } from "./types.js";
import type { ConversationMessage } from "./history.js";
import { TOOL_DEFINITIONS } from "../tools/index.js";
import { buildDateTimeContext } from "./datetime.js";
import { dispatchTool } from "./agent-dispatch.js";

export interface AgentDeps {
  claude: ClaudeClient;
  redis: RedisClient;
  calendar: CalendarClient;
  clock: Clock;
}

export interface AgentParams {
  member: FamilyMember;
  userMessage: string;
  imageBase64?: string;
  conversationHistory: ConversationMessage[];
}

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 8;
const FALLBACK_MSG =
  "I've been thinking too long — let me try again with a simpler approach.";

export async function invokeAgent(
  deps: AgentDeps,
  params: AgentParams,
): Promise<string> {
  const system = buildSystemPrompt(deps.clock, params.member);
  const messages = buildMessages(params);
  return runToolLoop(deps, params.member, system, messages);
}

function buildSystemPrompt(clock: Clock, member: FamilyMember): string {
  const dateCtx = buildDateTimeContext(clock, member.timezone);
  return [
    `You are a helpful family assistant for ${member.name}.`,
    dateCtx,
    `Member timezone: ${member.timezone}.`,
    "Use tools to read/write memory and manage calendar events.",
    "Reply in plain text only — no markdown formatting.",
    "The server injects authorship on mutating tools — never include it.",
  ].join("\n");
}

function buildMessages(
  params: AgentParams,
): ClaudeConversationMessage[] {
  const messages: ClaudeConversationMessage[] = [];
  for (const msg of params.conversationHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: "user", content: buildUserContent(params) });
  return messages;
}

function buildUserContent(
  params: AgentParams,
): string | ClaudeContentBlock[] {
  if (params.imageBase64 === undefined) {
    return params.userMessage;
  }
  return [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: params.imageBase64,
      },
    },
    { type: "text", text: params.userMessage },
  ];
}

async function runToolLoop(
  deps: AgentDeps,
  member: FamilyMember,
  system: string,
  messages: ClaudeConversationMessage[],
): Promise<string> {
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await deps.claude.createMessage({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      tools: TOOL_DEFINITIONS,
    });
    if (response.stop_reason === "end_turn") {
      return extractText(response.content);
    }
    const toolBlocks = extractToolUseBlocks(response.content);
    if (toolBlocks.length === 0) {
      return extractText(response.content);
    }
    messages.push({ role: "assistant", content: response.content });
    const results = await executeTools(deps, member, toolBlocks);
    messages.push({ role: "user", content: results });
  }
  return FALLBACK_MSG;
}

function extractText(content: ClaudeContentBlock[]): string {
  const texts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    }
  }
  return texts.join("\n") || "I had nothing to say.";
}

interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

function extractToolUseBlocks(
  content: ClaudeContentBlock[],
): ToolUseBlock[] {
  const blocks: ToolUseBlock[] = [];
  for (const block of content) {
    if (block.type === "tool_use") {
      blocks.push({
        id: block.id as string,
        name: block.name as string,
        input: block.input as Record<string, unknown>,
      });
    }
  }
  return blocks;
}

async function executeTools(
  deps: AgentDeps,
  member: FamilyMember,
  toolBlocks: ToolUseBlock[],
): Promise<ClaudeContentBlock[]> {
  const results: ClaudeContentBlock[] = [];
  for (const tool of toolBlocks) {
    const result = await dispatchTool(deps, member, tool.name, tool.input);
    results.push({
      type: "tool_result",
      tool_use_id: tool.id,
      content: JSON.stringify(result),
    });
  }
  return results;
}
