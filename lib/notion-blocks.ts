/**
 * Converts between Notion block objects and markdown.
 * Uses notion-richtext.ts for inline formatting.
 */

import type { NotionRichText } from "./notion-richtext.js";
import { richTextToMarkdown, markdownToRichText } from "./notion-richtext.js";

// --- Notion block types (subset we use) ---

export interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  [key: string]: unknown;
}

interface RichTextContent {
  rich_text: NotionRichText[];
}

interface CodeContent extends RichTextContent {
  language: string;
}

interface ToDoContent extends RichTextContent {
  checked: boolean;
}

interface CalloutContent extends RichTextContent {
  icon?: { type: string; emoji?: string };
}

// --- Blocks → Markdown ---

export function blocksToMarkdown(blocks: NotionBlock[], depth = 0): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const indent = "  ".repeat(depth);
    const line = blockToLine(block);
    lines.push(indent + line);
    if (block.has_children && depth < 2) {
      const children = (block as Record<string, unknown>).children as NotionBlock[] | undefined;
      if (children) lines.push(blocksToMarkdown(children, depth + 1));
    }
  }
  return lines.join("\n");
}

function getRichText(block: NotionBlock): NotionRichText[] {
  const content = block[block.type] as RichTextContent | undefined;
  return content?.rich_text ?? [];
}

const HEADING_PREFIXES: Record<string, string> = {
  heading_1: "# ",
  heading_2: "## ",
  heading_3: "### ",
};

function simpleTextLine(type: string, text: string): string | null {
  const prefix = HEADING_PREFIXES[type];
  if (prefix !== undefined) return `${prefix}${text}`;
  if (type === "bulleted_list_item") return `- ${text}`;
  if (type === "numbered_list_item") return `1. ${text}`;
  if (type === "quote") return `> ${text}`;
  if (type === "paragraph") return text || "";
  return null;
}

function blockToLine(block: NotionBlock): string {
  const text = richTextToMarkdown(getRichText(block));
  const simple = simpleTextLine(block.type, text);
  if (simple !== null) return simple;
  switch (block.type) {
    case "to_do": return toDoLine(block, text);
    case "code": return codeLine(block);
    case "divider": return "---";
    case "callout": return calloutLine(block, text);
    default: return `[unsupported: ${block.type}]`;
  }
}

function toDoLine(block: NotionBlock, text: string): string {
  const content = block.to_do as ToDoContent | undefined;
  return content?.checked ? `- [x] ${text}` : `- [ ] ${text}`;
}

function codeLine(block: NotionBlock): string {
  const content = block.code as CodeContent | undefined;
  const lang = content?.language ?? "";
  const text = richTextToMarkdown(content?.rich_text ?? []);
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

function calloutLine(block: NotionBlock, text: string): string {
  const content = block.callout as CalloutContent | undefined;
  const emoji = content?.icon?.emoji ?? "";
  return emoji ? `> ${emoji} ${text}` : `> ${text}`;
}

// --- Markdown → Blocks ---

export function markdownToBlocks(md: string): NotionBlock[] {
  const lines = md.split("\n");
  const blocks: NotionBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      const result = parseCodeBlock(lines, i);
      blocks.push(result.block);
      i = result.nextIndex;
    } else {
      const block = lineToBlock(line);
      if (block) blocks.push(block);
      i++;
    }
  }
  return blocks;
}

function parseCodeBlock(
  lines: string[], start: number,
): { block: NotionBlock; nextIndex: number } {
  const lang = (lines[start] ?? "").slice(3).trim();
  const codeLines: string[] = [];
  let i = start + 1;
  while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
    codeLines.push(lines[i] ?? "");
    i++;
  }
  return {
    block: {
      id: "", type: "code", has_children: false,
      code: { rich_text: markdownToRichText(codeLines.join("\n")), language: lang || "plain text" },
    },
    nextIndex: i + 1,
  };
}

function lineToBlock(line: string): NotionBlock | null {
  if (line === "") return null;
  if (line === "---") return { id: "", type: "divider", has_children: false, divider: {} };

  const heading = /^(#{1,3}) (.+)/.exec(line);
  if (heading) return headingBlock(heading);

  if (line.startsWith("- [x] ") || line.startsWith("- [ ] ")) return toDoBlock(line);
  if (line.startsWith("- ")) return richTextBlock("bulleted_list_item", line.slice(2));
  if (/^\d+\. /.test(line)) return richTextBlock("numbered_list_item", line.replace(/^\d+\. /, ""));
  if (line.startsWith("> ")) return richTextBlock("quote", line.slice(2));

  return richTextBlock("paragraph", line);
}

function headingBlock(match: RegExpMatchArray): NotionBlock {
  const level = (match[1] ?? "").length as 1 | 2 | 3;
  const type = `heading_${String(level)}` as const;
  return richTextBlock(type, match[2] ?? "");
}

function toDoBlock(line: string): NotionBlock {
  const checked = line.startsWith("- [x] ");
  const text = line.slice(6);
  return {
    id: "", type: "to_do", has_children: false,
    to_do: { rich_text: markdownToRichText(text), checked },
  };
}

function richTextBlock(type: string, text: string): NotionBlock {
  return {
    id: "", type, has_children: false,
    [type]: { rich_text: markdownToRichText(text) },
  };
}
