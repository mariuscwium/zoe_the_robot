/**
 * Claude agent invocation and tool loop.
 * Builds system prompt, sends messages, and iterates tool calls.
 */

import type {
  ClaudeClient,
  CalendarProvider,
  RedisClient,
  Clock,
  NotionClient,
  ClaudeContentBlock,
  ClaudeConversationMessage,
} from "./deps.js";
import type { FamilyMember } from "./types.js";
import type { ConversationMessage } from "./history.js";
import { TOOL_DEFINITIONS } from "../tools/index.js";
import { buildDateTimeContext } from "./datetime.js";
import { dispatchTool } from "./agent-dispatch.js";
import { logTokenUsage } from "./log-tokens.js";

export interface AgentDeps {
  claude: ClaudeClient;
  redis: RedisClient;
  calendar: CalendarProvider;
  clock: Clock;
  notion: NotionClient;
}

export interface AgentParams {
  member: FamilyMember;
  userMessage: string;
  imageBase64?: string;
  conversationHistory: ConversationMessage[];
}

export const PROMPT_VERSION = "v2";
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 16;
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
    `You are Zoe, a helpful family assistant for ${member.name}. Your name is Zoe, not Claude. Always refer to yourself as Zoe.`,
    dateCtx,
    `Member timezone: ${member.timezone}.`,
    "Use tools to read/write memory and manage calendar events. NEVER say you created, deleted, or modified something without actually calling the tool. You must call create_event for EACH event individually — do not summarize or skip any. If you need to create multiple events, call create_event multiple times in the same response.",
    "If a calendar tool returns calendar_not_connected, send the member the authUrl link and ask them to click it to connect their Google Calendar.",
    "When a message starts with '[Voice message]', the user sent a Telegram voice note that has already been transcribed to text for you. Respond to the transcribed content naturally — do NOT say you cannot process voice messages.",
    "You have access to the user's Notion workspace. Use search_notion to find pages before creating duplicates. Always read a page with read_notion_page before updating it with update_notion_page, since update replaces all content. Use append_notion_page to add content without overwriting. When sharing Notion content in Telegram, summarize rather than dumping full markdown.",
    "CRITICAL: Your replies go to Telegram which does not render markdown. Never use **, *, `, #, or - bullets. Write plain conversational text only.",
    "The server injects authorship on mutating tools — never include it.",
  ].join("\n");
}

function buildMessages(
  params: AgentParams,
): ClaudeConversationMessage[] {
  const messages: ClaudeConversationMessage[] = [];
  for (const msg of params.conversationHistory) {
    if (msg.content === "") continue;
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
  const blocks: ClaudeContentBlock[] = [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: params.imageBase64,
      },
    },
  ];
  if (params.userMessage !== "") {
    blocks.push({ type: "text", text: params.userMessage });
  }
  return blocks;
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
    await logTokenUsage(deps, "zoe", response);
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
