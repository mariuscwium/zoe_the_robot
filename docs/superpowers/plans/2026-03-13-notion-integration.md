# Notion Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Zoe read/write access to the user's Notion workspace via 5 tools (search, read, create, update, append), with markdown translation.

**Architecture:** NotionClient interface in deps.ts, production client wrapping @notionhq/client SDK in a dedicated file, markdown ↔ blocks converters split across two files, NotionTwin coded against SDK types, tool dispatch in a separate file to stay under line limits.

**Tech Stack:** @notionhq/client SDK, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-13-notion-integration-design.md`

---

## Line Budget Notes

Before modifying any file, check current line count. Key limits:
- `max-lines: 200` (skip blank + comment lines)
- `max-lines-per-function: 60`
- `tools/index.ts` has `max-lines: "off"` in eslint config

Current counts:
- `lib/deps.ts`: 174 → adding ~15 = ~189 ✓
- `lib/clients.ts`: 169 → **DO NOT add here**, create `lib/notion-client.ts` instead
- `lib/agent-dispatch.ts`: 194 → create `lib/notion-dispatch.ts`, add ~8 lines (imports, DispatchDeps field, routing call, MUTATING_TOOLS entries). After changes, recount — if over 200, compact blank lines or shorten existing code
- `lib/prod-deps.ts`: 93 → adding ~15 = ~108 ✓
- `lib/agent.ts`: 175 → adding 1 line to system prompt = 176 ✓
- `tools/index.ts`: 273 → max-lines: off ✓

---

## Chunk 1: Markdown Converters

Pure functions with no external dependencies. Build and test these first — everything else depends on them.

### Task 1: Rich text converter

Converts between Notion's `RichTextItemResponse` objects and markdown inline formatting.

**Files:**
- Create: `lib/notion-richtext.ts`
- Create: `lib/notion-richtext.test.ts`

- [ ] **Step 1: Create `lib/notion-richtext.ts`**

```typescript
/**
 * Converts between Notion rich text objects and markdown inline formatting.
 * Used by notion-blocks.ts for block-level conversion.
 */

// --- Notion SDK types (subset we use) ---

export interface NotionRichText {
  type: "text";
  text: { content: string; link: { url: string } | null };
  annotations: NotionAnnotations;
  plain_text: string;
  href: string | null;
}

export interface NotionAnnotations {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: string;
}

// --- Rich text → Markdown ---

function wrapAnnotations(text: string, a: NotionAnnotations, href: string | null): string {
  let result = text;
  if (a.code) result = `\`${result}\``;
  if (a.bold) result = `**${result}**`;
  if (a.italic) result = `*${result}*`;
  if (a.strikethrough) result = `~~${result}~~`;
  if (href) result = `[${result}](${href})`;
  return result;
}

export function richTextToMarkdown(richTexts: NotionRichText[]): string {
  return richTexts
    .map((rt) => {
      if (rt.plain_text === "") return "";
      const needsWrap =
        rt.annotations.bold || rt.annotations.italic ||
        rt.annotations.strikethrough || rt.annotations.code || rt.href;
      return needsWrap ? wrapAnnotations(rt.plain_text, rt.annotations, rt.href) : rt.plain_text;
    })
    .join("");
}

// --- Markdown → Rich text ---

interface TextSegment {
  text: string;
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  code: boolean;
  href: string | null;
}

const INLINE_PATTERN =
  /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~|\[(.+?)\]\((.+?)\))/g;

export function markdownToRichText(md: string): NotionRichText[] {
  if (md === "") return [];
  const segments: TextSegment[] = [];
  let lastIndex = 0;

  for (const match of md.matchAll(INLINE_PATTERN)) {
    const before = md.slice(lastIndex, match.index);
    if (before) segments.push(plainSegment(before));
    segments.push(parseMatch(match));
    lastIndex = match.index + match[0].length;
  }

  const remaining = md.slice(lastIndex);
  if (remaining) segments.push(plainSegment(remaining));
  if (segments.length === 0) segments.push(plainSegment(md));

  return segments.map(segmentToRichText);
}

function plainSegment(text: string): TextSegment {
  return { text, bold: false, italic: false, strikethrough: false, code: false, href: null };
}

function parseMatch(match: RegExpMatchArray): TextSegment {
  const base = plainSegment("");
  if (match[2] !== undefined) return { ...base, text: match[2], bold: true };
  if (match[3] !== undefined) return { ...base, text: match[3], italic: true };
  if (match[4] !== undefined) return { ...base, text: match[4], code: true };
  if (match[5] !== undefined) return { ...base, text: match[5], strikethrough: true };
  if (match[6] !== undefined && match[7] !== undefined) {
    return { ...base, text: match[6], href: match[7] };
  }
  return { ...base, text: match[0] };
}

function segmentToRichText(seg: TextSegment): NotionRichText {
  return {
    type: "text",
    text: { content: seg.text, link: seg.href ? { url: seg.href } : null },
    annotations: {
      bold: seg.bold, italic: seg.italic, strikethrough: seg.strikethrough,
      underline: false, code: seg.code, color: "default",
    },
    plain_text: seg.text,
    href: seg.href,
  };
}
```

- [ ] **Step 2: Create `lib/notion-richtext.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { richTextToMarkdown, markdownToRichText } from "./notion-richtext.js";
import type { NotionRichText } from "./notion-richtext.js";

function plain(text: string): NotionRichText {
  return {
    type: "text",
    text: { content: text, link: null },
    annotations: {
      bold: false, italic: false, strikethrough: false,
      underline: false, code: false, color: "default",
    },
    plain_text: text,
    href: null,
  };
}

function annotated(text: string, overrides: Partial<NotionRichText["annotations"]>): NotionRichText {
  return {
    ...plain(text),
    annotations: { ...plain(text).annotations, ...overrides },
  };
}

describe("richTextToMarkdown", () => {
  it("converts plain text", () => {
    expect(richTextToMarkdown([plain("hello world")])).toBe("hello world");
  });

  it("converts bold", () => {
    expect(richTextToMarkdown([annotated("bold", { bold: true })])).toBe("**bold**");
  });

  it("converts italic", () => {
    expect(richTextToMarkdown([annotated("italic", { italic: true })])).toBe("*italic*");
  });

  it("converts code", () => {
    expect(richTextToMarkdown([annotated("code", { code: true })])).toBe("`code`");
  });

  it("converts strikethrough", () => {
    expect(richTextToMarkdown([annotated("gone", { strikethrough: true })])).toBe("~~gone~~");
  });

  it("converts links", () => {
    const rt: NotionRichText = {
      ...plain("click here"),
      href: "https://example.com",
      text: { content: "click here", link: { url: "https://example.com" } },
    };
    expect(richTextToMarkdown([rt])).toBe("[click here](https://example.com)");
  });

  it("concatenates mixed segments", () => {
    const segments = [plain("Hello "), annotated("world", { bold: true }), plain("!")];
    expect(richTextToMarkdown(segments)).toBe("Hello **world**!");
  });

  it("returns empty string for empty array", () => {
    expect(richTextToMarkdown([])).toBe("");
  });
});

describe("markdownToRichText", () => {
  it("parses plain text", () => {
    const result = markdownToRichText("hello");
    expect(result).toHaveLength(1);
    expect(result[0]!.plain_text).toBe("hello");
    expect(result[0]!.annotations.bold).toBe(false);
  });

  it("parses bold", () => {
    const result = markdownToRichText("**bold**");
    expect(result).toHaveLength(1);
    expect(result[0]!.plain_text).toBe("bold");
    expect(result[0]!.annotations.bold).toBe(true);
  });

  it("parses italic", () => {
    const result = markdownToRichText("*italic*");
    expect(result).toHaveLength(1);
    expect(result[0]!.annotations.italic).toBe(true);
  });

  it("parses inline code", () => {
    const result = markdownToRichText("`code`");
    expect(result).toHaveLength(1);
    expect(result[0]!.annotations.code).toBe(true);
  });

  it("parses strikethrough", () => {
    const result = markdownToRichText("~~gone~~");
    expect(result).toHaveLength(1);
    expect(result[0]!.annotations.strikethrough).toBe(true);
  });

  it("parses links", () => {
    const result = markdownToRichText("[click](https://example.com)");
    expect(result).toHaveLength(1);
    expect(result[0]!.href).toBe("https://example.com");
    expect(result[0]!.text.link).toEqual({ url: "https://example.com" });
  });

  it("parses mixed text", () => {
    const result = markdownToRichText("Hello **world**!");
    expect(result).toHaveLength(3);
    expect(result[0]!.plain_text).toBe("Hello ");
    expect(result[1]!.plain_text).toBe("world");
    expect(result[1]!.annotations.bold).toBe(true);
    expect(result[2]!.plain_text).toBe("!");
  });

  it("returns empty array for empty string", () => {
    expect(markdownToRichText("")).toEqual([]);
  });
});

describe("round-trip", () => {
  it("preserves plain text", () => {
    const md = "Hello world";
    expect(richTextToMarkdown(markdownToRichText(md))).toBe(md);
  });

  it("preserves bold", () => {
    const md = "Say **hello** there";
    expect(richTextToMarkdown(markdownToRichText(md))).toBe(md);
  });

  it("preserves links", () => {
    const md = "Visit [site](https://example.com) now";
    expect(richTextToMarkdown(markdownToRichText(md))).toBe(md);
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `source ~/.bashrc && npx vitest run lib/notion-richtext.test.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add lib/notion-richtext.ts lib/notion-richtext.test.ts
git commit -m "Add Notion rich text ↔ markdown converter with tests"
```

---

### Task 2: Block converter

Converts between Notion block objects and markdown. Depends on richtext converter.

**Files:**
- Create: `lib/notion-blocks.ts`
- Create: `lib/notion-blocks.test.ts`

- [ ] **Step 1: Create `lib/notion-blocks.ts`**

```typescript
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

function blockToLine(block: NotionBlock): string {
  const text = richTextToMarkdown(getRichText(block));
  switch (block.type) {
    case "paragraph": return text || "";
    case "heading_1": return `# ${text}`;
    case "heading_2": return `## ${text}`;
    case "heading_3": return `### ${text}`;
    case "bulleted_list_item": return `- ${text}`;
    case "numbered_list_item": return `1. ${text}`;
    case "to_do": return toDoLine(block, text);
    case "code": return codeLine(block);
    case "quote": return `> ${text}`;
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
    const line = lines[i]!;
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
  const lang = lines[start]!.slice(3).trim();
  const codeLines: string[] = [];
  let i = start + 1;
  while (i < lines.length && !lines[i]!.startsWith("```")) {
    codeLines.push(lines[i]!);
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

  const heading = line.match(/^(#{1,3}) (.+)/);
  if (heading) return headingBlock(heading);

  if (line.startsWith("- [x] ") || line.startsWith("- [ ] ")) return toDoBlock(line);
  if (line.startsWith("- ")) return richTextBlock("bulleted_list_item", line.slice(2));
  if (/^\d+\. /.test(line)) return richTextBlock("numbered_list_item", line.replace(/^\d+\. /, ""));
  if (line.startsWith("> ")) return richTextBlock("quote", line.slice(2));

  return richTextBlock("paragraph", line);
}

function headingBlock(match: RegExpMatchArray): NotionBlock {
  const level = match[1]!.length as 1 | 2 | 3;
  const type = `heading_${level}` as const;
  return richTextBlock(type, match[2]!);
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
```

- [ ] **Step 2: Create `lib/notion-blocks.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { blocksToMarkdown, markdownToBlocks } from "./notion-blocks.js";
import type { NotionBlock } from "./notion-blocks.js";
import { markdownToRichText } from "./notion-richtext.js";

function textBlock(type: string, text: string): NotionBlock {
  return {
    id: "b1", type, has_children: false,
    [type]: { rich_text: markdownToRichText(text) },
  };
}

describe("blocksToMarkdown", () => {
  it("converts paragraph", () => {
    expect(blocksToMarkdown([textBlock("paragraph", "Hello")])).toBe("Hello");
  });

  it("converts headings", () => {
    const blocks = [
      textBlock("heading_1", "H1"),
      textBlock("heading_2", "H2"),
      textBlock("heading_3", "H3"),
    ];
    expect(blocksToMarkdown(blocks)).toBe("# H1\n## H2\n### H3");
  });

  it("converts bullet list", () => {
    expect(blocksToMarkdown([textBlock("bulleted_list_item", "item")])).toBe("- item");
  });

  it("converts numbered list", () => {
    expect(blocksToMarkdown([textBlock("numbered_list_item", "item")])).toBe("1. item");
  });

  it("converts to-do checked", () => {
    const block: NotionBlock = {
      id: "b1", type: "to_do", has_children: false,
      to_do: { rich_text: markdownToRichText("done"), checked: true },
    };
    expect(blocksToMarkdown([block])).toBe("- [x] done");
  });

  it("converts to-do unchecked", () => {
    const block: NotionBlock = {
      id: "b1", type: "to_do", has_children: false,
      to_do: { rich_text: markdownToRichText("pending"), checked: false },
    };
    expect(blocksToMarkdown([block])).toBe("- [ ] pending");
  });

  it("converts code block", () => {
    const block: NotionBlock = {
      id: "b1", type: "code", has_children: false,
      code: { rich_text: markdownToRichText("const x = 1;"), language: "typescript" },
    };
    expect(blocksToMarkdown([block])).toBe("```typescript\nconst x = 1;\n```");
  });

  it("converts quote", () => {
    expect(blocksToMarkdown([textBlock("quote", "wise words")])).toBe("> wise words");
  });

  it("converts divider", () => {
    const block: NotionBlock = { id: "b1", type: "divider", has_children: false, divider: {} };
    expect(blocksToMarkdown([block])).toBe("---");
  });

  it("marks unsupported blocks", () => {
    const block: NotionBlock = { id: "b1", type: "embed", has_children: false };
    expect(blocksToMarkdown([block])).toBe("[unsupported: embed]");
  });

  it("handles callout with emoji", () => {
    const block: NotionBlock = {
      id: "b1", type: "callout", has_children: false,
      callout: {
        rich_text: markdownToRichText("important"),
        icon: { type: "emoji", emoji: "💡" },
      },
    };
    expect(blocksToMarkdown([block])).toBe("> 💡 important");
  });
});

describe("markdownToBlocks", () => {
  it("parses paragraph", () => {
    const blocks = markdownToBlocks("Hello world");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("paragraph");
  });

  it("parses headings", () => {
    const blocks = markdownToBlocks("# H1\n## H2\n### H3");
    expect(blocks.map((b) => b.type)).toEqual(["heading_1", "heading_2", "heading_3"]);
  });

  it("parses bullet list", () => {
    const blocks = markdownToBlocks("- item one\n- item two");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.type).toBe("bulleted_list_item");
  });

  it("parses numbered list", () => {
    const blocks = markdownToBlocks("1. first\n2. second");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.type).toBe("numbered_list_item");
  });

  it("parses to-do items", () => {
    const blocks = markdownToBlocks("- [ ] pending\n- [x] done");
    expect(blocks[0]!.type).toBe("to_do");
    expect((blocks[0]!.to_do as { checked: boolean }).checked).toBe(false);
    expect((blocks[1]!.to_do as { checked: boolean }).checked).toBe(true);
  });

  it("parses code block", () => {
    const blocks = markdownToBlocks("```typescript\nconst x = 1;\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("code");
    expect((blocks[0]!.code as { language: string }).language).toBe("typescript");
  });

  it("parses quote", () => {
    const blocks = markdownToBlocks("> wise words");
    expect(blocks[0]!.type).toBe("quote");
  });

  it("parses divider", () => {
    const blocks = markdownToBlocks("---");
    expect(blocks[0]!.type).toBe("divider");
  });

  it("skips empty lines", () => {
    const blocks = markdownToBlocks("line one\n\nline two");
    expect(blocks).toHaveLength(2);
  });
});

describe("round-trip", () => {
  it("preserves simple document", () => {
    const md = "# Title\n\nHello world\n\n- item one\n- item two";
    const result = blocksToMarkdown(markdownToBlocks(md));
    expect(result).toBe("# Title\nHello world\n- item one\n- item two");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `source ~/.bashrc && npx vitest run lib/notion-blocks.test.ts lib/notion-richtext.test.ts`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add lib/notion-blocks.ts lib/notion-blocks.test.ts
git commit -m "Add Notion block ↔ markdown converter with tests"
```

---

## Chunk 2: Interface, Twin, and Production Client

### Task 3: Add NotionClient interface to deps.ts

**Files:**
- Modify: `lib/deps.ts:147-174`

- [ ] **Step 1: Add NotionPage and NotionClient interfaces**

Add after the `TranscriptionClient` interface (after line 151):

```typescript
// --- Notion ---

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  lastEditedTime: string;
}

export interface NotionClient {
  search(query: string): Promise<NotionPage[]>;
  getPage(pageId: string): Promise<{ page: NotionPage; markdown: string }>;
  createPage(parentId: string, title: string, markdown: string): Promise<NotionPage>;
  updatePage(pageId: string, markdown: string): Promise<void>;
  appendToPage(pageId: string, markdown: string): Promise<void>;
}
```

- [ ] **Step 2: Add `notion` to the `Deps` interface**

```typescript
export interface Deps {
  redis: RedisClient;
  telegram: TelegramClient;
  calendar: CalendarProvider;
  claude: ClaudeClient;
  transcription: TranscriptionClient;
  notion: NotionClient;
  clock: Clock;
}
```

- [ ] **Step 3: Run typecheck**

Run: `source ~/.bashrc && npm run typecheck`
Expected: FAIL — existing code constructs `Deps` without `notion`. That's expected; we'll fix compilation in Tasks 4-5 when we add the twin and client.

- [ ] **Step 4: Commit (allow typecheck failure for now)**

```bash
git add lib/deps.ts
git commit -m "Add NotionClient interface and NotionPage type to deps"
```

---

### Task 4: Create NotionTwin

The twin is coded against the Notion SDK's method signatures — `search()`, `pages.retrieve()`, `pages.create()`, `blocks.children.list()`, `blocks.children.append()`, `blocks.delete()`. A factory wraps this into the `NotionClient` deps interface using the markdown converters.

**Files:**
- Create: `twins/notion.ts`

- [ ] **Step 0: Add `twins/` to ESLint ignores**

`twins/` is not currently in ESLint ignores and this file will exceed 200 lines. Add `"twins/"` to the ignores array in `eslint.config.js`:

```typescript
ignores: ["node_modules/", "dist/", "coverage/", "logs/", "tui/", "twins/"],
```

- [ ] **Step 1: Create `twins/notion.ts`**

The twin uses a `_store` Map internally to avoid colliding with the SDK-shaped `pages` object. The factory uses `Promise.resolve()` (not `async`) to satisfy `@typescript-eslint/require-await`.

```typescript
/**
 * Digital twin for Notion, coded against the @notionhq/client SDK interface.
 * A factory function wraps it into a NotionClient for Deps injection.
 */

import type { NotionClient, NotionPage } from "../lib/deps.js";
import type { NotionBlock } from "../lib/notion-blocks.js";
import { blocksToMarkdown, markdownToBlocks } from "../lib/notion-blocks.js";
import { markdownToRichText } from "../lib/notion-richtext.js";

interface StoredPage {
  id: string;
  title: string;
  parentId: string;
  blocks: NotionBlock[];
  createdTime: string;
  lastEditedTime: string;
  url: string;
}

let nextId = 1;
function genId(): string {
  return `page-${String(nextId++)}`;
}

function genBlockId(): string {
  return `block-${String(nextId++)}`;
}

export class NotionTwin {
  // Named _store to avoid collision with the SDK-shaped `pages` object below
  private _store = new Map<string, StoredPage>();

  // --- SDK-shaped methods ---

  search(params: { query: string }): { results: NotionSearchResult[] } {
    const query = params.query.toLowerCase();
    const results: NotionSearchResult[] = [];
    for (const page of this._store.values()) {
      if (page.title.toLowerCase().includes(query)) {
        results.push(pageToSearchResult(page));
      }
    }
    return { results };
  }

  pages = {
    _twin: this as NotionTwin,
    retrieve(params: { page_id: string }): NotionPageResponse {
      const page = this._twin.getStoredPage(params.page_id);
      return pageToResponse(page);
    },
    create(params: NotionCreateParams): NotionPageResponse {
      const id = genId();
      const now = new Date().toISOString();
      const title = extractTitle(params.properties);
      const blocks = (params.children ?? []).map(assignBlockId);
      const page: StoredPage = {
        id, title, parentId: params.parent.page_id,
        blocks, createdTime: now, lastEditedTime: now,
        url: `https://notion.so/${id}`,
      };
      this._twin._store.set(id, page);
      return pageToResponse(page);
    },
  };

  blocks = {
    _twin: this as NotionTwin,
    children: {
      _twin: this as unknown as NotionTwin,
      list(params: { block_id: string }): NotionListResponse {
        const twin = (this as unknown as { _twin: NotionTwin })._twin;
        const page = twin.getStoredPage(params.block_id);
        return { results: page.blocks, has_more: false, next_cursor: null };
      },
      append(params: { block_id: string; children: NotionBlock[] }): { results: NotionBlock[] } {
        const twin = (this as unknown as { _twin: NotionTwin })._twin;
        const page = twin.getStoredPage(params.block_id);
        const newBlocks = params.children.map(assignBlockId);
        page.blocks.push(...newBlocks);
        page.lastEditedTime = new Date().toISOString();
        return { results: newBlocks };
      },
    },
    delete(params: { block_id: string }): void {
      for (const page of this._twin._store.values()) {
        const idx = page.blocks.findIndex((b) => b.id === params.block_id);
        if (idx !== -1) {
          page.blocks.splice(idx, 1);
          page.lastEditedTime = new Date().toISOString();
          return;
        }
      }
      throw new Error(`Block not found: ${params.block_id}`);
    },
  };

  // --- Test helpers ---

  addPage(title: string, markdown: string, parentId = "root"): string {
    const id = genId();
    const now = new Date().toISOString();
    const blocks = markdownToBlocks(markdown).map(assignBlockId);
    this._store.set(id, {
      id, title, parentId, blocks,
      createdTime: now, lastEditedTime: now,
      url: `https://notion.so/${id}`,
    });
    return id;
  }

  getStoredPage(id: string): StoredPage {
    const page = this._store.get(id);
    if (!page) throw new Error(`Page not found: ${id}`);
    return page;
  }

  getPageCount(): number {
    return this._store.size;
  }

  reset(): void {
    this._store.clear();
    nextId = 1;
  }
}

// --- Factory: twin → NotionClient ---
// Uses Promise.resolve() instead of async to satisfy @typescript-eslint/require-await

export function createNotionTwin(): { client: NotionClient; twin: NotionTwin } {
  const twin = new NotionTwin();

  const client: NotionClient = {
    search(query: string): Promise<NotionPage[]> {
      const { results } = twin.search({ query });
      return Promise.resolve(results.map(searchResultToPage));
    },
    getPage(pageId: string): Promise<{ page: NotionPage; markdown: string }> {
      const pageResp = twin.pages.retrieve({ page_id: pageId });
      const { results } = twin.blocks.children.list({ block_id: pageId });
      const page = responseToPage(pageResp);
      return Promise.resolve({ page, markdown: blocksToMarkdown(results) });
    },
    createPage(parentId: string, title: string, markdown: string): Promise<NotionPage> {
      const blocks = markdownToBlocks(markdown);
      const resp = twin.pages.create({
        parent: { page_id: parentId },
        properties: { title: { title: markdownToRichText(title) } },
        children: blocks,
      });
      return Promise.resolve(responseToPage(resp));
    },
    updatePage(pageId: string, markdown: string): Promise<void> {
      const { results: existing } = twin.blocks.children.list({ block_id: pageId });
      for (const block of existing) twin.blocks.delete({ block_id: block.id });
      const newBlocks = markdownToBlocks(markdown);
      twin.blocks.children.append({ block_id: pageId, children: newBlocks });
      return Promise.resolve();
    },
    appendToPage(pageId: string, markdown: string): Promise<void> {
      const blocks = markdownToBlocks(markdown);
      twin.blocks.children.append({ block_id: pageId, children: blocks });
      return Promise.resolve();
    },
  };

  return { client, twin };
}

// --- Internal types matching SDK response shapes ---

interface NotionSearchResult {
  object: "page";
  id: string;
  url: string;
  last_edited_time: string;
  properties: { title: { title: Array<{ plain_text: string }> } };
}

interface NotionPageResponse {
  object: "page";
  id: string;
  url: string;
  last_edited_time: string;
  properties: { title: { title: Array<{ plain_text: string }> } };
}

interface NotionCreateParams {
  parent: { page_id: string };
  properties: { title: { title: unknown[] } };
  children?: NotionBlock[];
}

interface NotionListResponse {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
}

function pageToSearchResult(page: StoredPage): NotionSearchResult {
  return {
    object: "page", id: page.id, url: page.url,
    last_edited_time: page.lastEditedTime,
    properties: { title: { title: [{ plain_text: page.title }] } },
  };
}

function pageToResponse(page: StoredPage): NotionPageResponse {
  return {
    object: "page", id: page.id, url: page.url,
    last_edited_time: page.lastEditedTime,
    properties: { title: { title: [{ plain_text: page.title }] } },
  };
}

function extractTitle(props: { title: { title: unknown[] } }): string {
  const titleArr = props.title.title as Array<{ plain_text?: string }>;
  return titleArr[0]?.plain_text ?? "Untitled";
}

function searchResultToPage(r: NotionSearchResult): NotionPage {
  return {
    id: r.id, url: r.url, lastEditedTime: r.last_edited_time,
    title: r.properties.title.title[0]?.plain_text ?? "Untitled",
  };
}

function responseToPage(r: NotionPageResponse): NotionPage {
  return {
    id: r.id, url: r.url, lastEditedTime: r.last_edited_time,
    title: r.properties.title.title[0]?.plain_text ?? "Untitled",
  };
}

function assignBlockId(block: NotionBlock): NotionBlock {
  return { ...block, id: block.id || genBlockId() };
}
```

- [ ] **Step 2: Fix compilation — add `notion` to all existing Deps and AgentDeps construction sites**

Two types of construction sites need updating:
1. **`Deps` objects** — search: `grep -rn "transcription:" tests/ api/ --include="*.ts"`
2. **`AgentDeps` objects** — search: `grep -rn "AgentDeps\|agentDeps:" tests/ --include="*.ts"`

**For `Deps` construction sites** (found in `api/telegram.test.ts`, `tests/integration/features-0-2.test.ts`, `tests/integration/voice.test.ts`):

Add import at top:
```typescript
import { createNotionTwin } from "../twins/notion.js";
// or "../../twins/notion.js" depending on depth
```

Wherever you see `transcription: new TranscriptionTwin(),`, add after it:
```typescript
notion: createNotionTwin().client,
```

**For `AgentDeps` construction sites** (found in `tests/integration/features-3-7.test.ts`):

This file builds `AgentDeps` directly (not `Deps`). Add import:
```typescript
import { createNotionTwin } from "../../twins/notion.js";
```

In the `setup()` function's `agentDeps` object, add `notion`:
```typescript
agentDeps: {
  claude,
  redis,
  calendar: new CalendarProviderTwin(calendarTwin),
  notion: createNotionTwin().client,
  clock,
},
```

- [ ] **Step 3: Run typecheck**

Run: `source ~/.bashrc && npm run typecheck`
Expected: Pass — all Deps construction sites now include `notion`

- [ ] **Step 4: Run all tests**

Run: `source ~/.bashrc && npx vitest run`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add twins/notion.ts api/telegram.test.ts tests/
git commit -m "Add NotionTwin coded against SDK interface"
```

---

### Task 5: Create production Notion client

**Files:**
- Create: `lib/notion-client.ts`
- Modify: `lib/prod-deps.ts`
- Modify: `package.json` (add `@notionhq/client` dependency)

- [ ] **Step 1: Install @notionhq/client**

Run: `source ~/.bashrc && npm install @notionhq/client`

- [ ] **Step 2: Create `lib/notion-client.ts`**

```typescript
/**
 * Production Notion client wrapping @notionhq/client SDK.
 * Translates between NotionClient interface and SDK calls.
 */

import { Client } from "@notionhq/client";
import type { NotionClient, NotionPage } from "./deps.js";
import type { NotionBlock } from "./notion-blocks.js";
import { blocksToMarkdown, markdownToBlocks } from "./notion-blocks.js";

const MAX_BLOCKS = 500;
const MAX_UPDATE_BLOCKS = 100;
const CONCURRENT_DELETES = 3;

export function createNotionClient(apiKey: string): NotionClient {
  const sdk = new Client({ auth: apiKey });
  return {
    search: (query) => searchPages(sdk, query),
    getPage: (pageId) => getPage(sdk, pageId),
    createPage: (parentId, title, md) => createPage(sdk, parentId, title, md),
    updatePage: (pageId, md) => updatePage(sdk, pageId, md),
    appendToPage: (pageId, md) => appendToPage(sdk, pageId, md),
  };
}

async function searchPages(sdk: Client, query: string): Promise<NotionPage[]> {
  const response = await sdk.search({
    query,
    filter: { value: "page", property: "object" },
    page_size: 10,
  });
  return response.results
    .filter((r): r is PageObjectResponse => r.object === "page" && "properties" in r)
    .map(extractPage);
}

async function getPage(
  sdk: Client, pageId: string,
): Promise<{ page: NotionPage; markdown: string }> {
  const pageResp = await sdk.pages.retrieve({ page_id: pageId });
  if (!("properties" in pageResp)) throw new Error("Page not found");
  const blocks = await fetchAllBlocks(sdk, pageId);
  let markdown = blocksToMarkdown(blocks as NotionBlock[]);
  if (blocks.length >= MAX_BLOCKS) {
    markdown += "\n\n[Content truncated — page has more blocks than the 500-block limit]";
  }
  return { page: extractPage(pageResp as PageObjectResponse), markdown };
}

async function createPage(
  sdk: Client, parentId: string, title: string, md: string,
): Promise<NotionPage> {
  const blocks = markdownToBlocks(md);
  const response = await sdk.pages.create({
    parent: { page_id: parentId },
    properties: { title: { title: [{ text: { content: title } }] } },
    children: blocks as Parameters<typeof sdk.pages.create>[0]["children"],
  });
  return extractPage(response as unknown as PageObjectResponse);
}

async function updatePage(sdk: Client, pageId: string, md: string): Promise<void> {
  const existing = await fetchAllBlocks(sdk, pageId);
  if (existing.length > MAX_UPDATE_BLOCKS) {
    throw new Error(
      `Page has too many blocks (${String(existing.length)}). Use append_notion_page instead.`,
    );
  }
  await deleteBlocksBatched(sdk, existing);
  const newBlocks = markdownToBlocks(md);
  await sdk.blocks.children.append({
    block_id: pageId,
    children: newBlocks as Parameters<typeof sdk.blocks.children.append>[0]["children"],
  });
}

async function appendToPage(sdk: Client, pageId: string, md: string): Promise<void> {
  const blocks = markdownToBlocks(md);
  await sdk.blocks.children.append({
    block_id: pageId,
    children: blocks as Parameters<typeof sdk.blocks.children.append>[0]["children"],
  });
}

async function fetchAllBlocks(
  sdk: Client, blockId: string,
): Promise<BlockObjectResponse[]> {
  const blocks: BlockObjectResponse[] = [];
  let cursor: string | undefined;
  while (blocks.length < MAX_BLOCKS) {
    const resp = await sdk.blocks.children.list({
      block_id: blockId, start_cursor: cursor, page_size: 100,
    });
    blocks.push(...(resp.results as BlockObjectResponse[]));
    if (!resp.has_more) break;
    cursor = resp.next_cursor ?? undefined;
  }
  return blocks;
}

async function deleteBlocksBatched(
  sdk: Client, blocks: BlockObjectResponse[],
): Promise<void> {
  for (let i = 0; i < blocks.length; i += CONCURRENT_DELETES) {
    const batch = blocks.slice(i, i + CONCURRENT_DELETES);
    await Promise.all(batch.map((b) => sdk.blocks.delete({ block_id: b.id })));
  }
}

// --- SDK type helpers ---

interface PageObjectResponse {
  id: string;
  url: string;
  last_edited_time: string;
  properties: Record<string, unknown>;
}

type BlockObjectResponse = { id: string; type: string; has_children: boolean };

function extractPage(page: PageObjectResponse): NotionPage {
  return {
    id: page.id,
    url: page.url,
    lastEditedTime: page.last_edited_time,
    title: extractTitle(page),
  };
}

function extractTitle(page: PageObjectResponse): string {
  const titleProp = page.properties.title ?? page.properties.Title;
  if (!titleProp) return "Untitled";
  const titleObj = titleProp as { title?: Array<{ plain_text: string }> };
  return titleObj.title?.[0]?.plain_text ?? "Untitled";
}
```

- [ ] **Step 3: Wire in prod-deps.ts**

Add to `lib/prod-deps.ts`:

Import at top:
```typescript
import type { NotionClient } from "./deps.js";
import { createNotionClient } from "./notion-client.js";
```

Add a builder function after `buildTranscriptionClient`:
```typescript
function buildNotionClient(): NotionClient {
  const apiKey = optionalEnv("NOTION_API_KEY");
  if (!apiKey) {
    return {
      search: () => Promise.reject(new Error("Notion isn't configured yet.")),
      getPage: () => Promise.reject(new Error("Notion isn't configured yet.")),
      createPage: () => Promise.reject(new Error("Notion isn't configured yet.")),
      updatePage: () => Promise.reject(new Error("Notion isn't configured yet.")),
      appendToPage: () => Promise.reject(new Error("Notion isn't configured yet.")),
    };
  }
  return createNotionClient(apiKey);
}
```

Add to the `_deps` construction in `getProdDeps()`:
```typescript
notion: buildNotionClient(),
```

- [ ] **Step 4: Run typecheck**

Run: `source ~/.bashrc && npm run typecheck`
Expected: Pass

- [ ] **Step 5: Commit**

```bash
git add lib/notion-client.ts lib/prod-deps.ts package.json package-lock.json
git commit -m "Add production Notion client wrapping @notionhq/client SDK"
```

---

## Chunk 3: Tools, Dispatch, and Wiring

### Task 6: Add Notion tool schemas

**Files:**
- Modify: `tools/index.ts` (max-lines: off for this file)

- [ ] **Step 1: Add 5 Notion tool definitions**

Add before the `confirmAction` tool definition, and add them to the `TOOL_DEFINITIONS` array:

```typescript
const searchNotion: ClaudeTool = {
  name: "search_notion",
  description:
    "Search the user's Notion workspace for pages by title or content. Returns matching pages with their IDs. Use this to find pages before reading or creating them.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search text to find pages by title or content.",
      },
    },
    required: ["query"],
  },
};

const readNotionPage: ClaudeTool = {
  name: "read_notion_page",
  description:
    "Read a Notion page's content as markdown. Returns the page title, URL, and full content. Always read a page before updating it.",
  input_schema: {
    type: "object",
    properties: {
      page_id: {
        type: "string",
        description: "The Notion page ID to read.",
      },
    },
    required: ["page_id"],
  },
};

const createNotionPage: ClaudeTool = {
  name: "create_notion_page",
  description:
    "Create a new Notion page under a parent page. Content is written as markdown and converted to Notion blocks. Use search_notion first to find the right parent page.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "The page title.",
      },
      markdown: {
        type: "string",
        description: "The page content as markdown.",
      },
      parent_page_id: {
        type: "string",
        description:
          "The ID of the parent page. Use search_notion to find the right parent.",
      },
    },
    required: ["title", "markdown", "parent_page_id"],
  },
};

const updateNotionPage: ClaudeTool = {
  name: "update_notion_page",
  description:
    "Replace all content of a Notion page with new markdown. This is destructive — always read the page first with read_notion_page. Pages with more than 100 blocks cannot be updated; use append_notion_page instead.",
  input_schema: {
    type: "object",
    properties: {
      page_id: {
        type: "string",
        description: "The Notion page ID to update.",
      },
      markdown: {
        type: "string",
        description: "The new page content as markdown (replaces all existing content).",
      },
    },
    required: ["page_id", "markdown"],
  },
};

const appendNotionPage: ClaudeTool = {
  name: "append_notion_page",
  description:
    "Append markdown content to the end of an existing Notion page. Non-destructive — existing content is preserved. Good for adding to lists, notes, or logs.",
  input_schema: {
    type: "object",
    properties: {
      page_id: {
        type: "string",
        description: "The Notion page ID to append to.",
      },
      markdown: {
        type: "string",
        description: "The markdown content to append to the end of the page.",
      },
    },
    required: ["page_id", "markdown"],
  },
};
```

Update the `TOOL_DEFINITIONS` array:
```typescript
export const TOOL_DEFINITIONS: ClaudeTool[] = [
  readMemory, writeMemory, deleteMemory, listMemoryKeys, appendMemory,
  listEvents, createEvent, createRecurringEvent, deleteCalendarEvent, findEvents,
  searchNotion, readNotionPage, createNotionPage, updateNotionPage, appendNotionPage,
  confirmAction,
];
```

- [ ] **Step 2: Run typecheck**

Run: `source ~/.bashrc && npm run typecheck`
Expected: Pass

- [ ] **Step 3: Commit**

```bash
git add tools/index.ts
git commit -m "Add 5 Notion tool schemas for search, read, create, update, append"
```

---

### Task 7: Add Notion tool dispatch

Create a separate dispatch file to stay under the 200-line limit in `agent-dispatch.ts`.

**Files:**
- Create: `lib/notion-dispatch.ts`
- Modify: `lib/agent-dispatch.ts`

- [ ] **Step 1: Create `lib/notion-dispatch.ts`**

```typescript
/**
 * Dispatch Notion tool calls to the NotionClient.
 * Separated from agent-dispatch.ts to stay under line limits.
 */

import type { NotionClient } from "./deps.js";
import type { ToolResult } from "./types.js";

type ToolInput = Record<string, unknown>;

const NOTION_TOOLS = new Set([
  "search_notion", "read_notion_page",
  "create_notion_page", "update_notion_page", "append_notion_page",
]);

export function isNotionTool(name: string): boolean {
  return NOTION_TOOLS.has(name);
}

function str(input: ToolInput, key: string): string {
  const val = input[key];
  if (typeof val !== "string") throw new Error(`Missing required string field: ${key}`);
  return val;
}

export async function routeNotionTool(
  notion: NotionClient, name: string, input: ToolInput,
): Promise<ToolResult> {
  switch (name) {
    case "search_notion": {
      const pages = await notion.search(str(input, "query"));
      return { success: true, data: pages };
    }
    case "read_notion_page": {
      const { page, markdown } = await notion.getPage(str(input, "page_id"));
      return { success: true, data: { ...page, content: markdown } };
    }
    case "create_notion_page": {
      const page = await notion.createPage(
        str(input, "parent_page_id"), str(input, "title"), str(input, "markdown"),
      );
      return { success: true, data: page };
    }
    case "update_notion_page":
      await notion.updatePage(str(input, "page_id"), str(input, "markdown"));
      return { success: true, data: "Page updated." };
    case "append_notion_page":
      await notion.appendToPage(str(input, "page_id"), str(input, "markdown"));
      return { success: true, data: "Content appended." };
    default:
      return { success: false, error: `Unknown Notion tool: ${name}` };
  }
}
```

- [ ] **Step 2: Wire into `lib/agent-dispatch.ts`**

Add import at top of `agent-dispatch.ts`:
```typescript
import type { NotionClient } from "./deps.js";
import { isNotionTool, routeNotionTool } from "./notion-dispatch.js";
```

Add `notion` to `DispatchDeps`:
```typescript
export interface DispatchDeps {
  redis: RedisClient;
  calendar: CalendarProvider;
  notion: NotionClient;
  clock: Clock;
}
```

Add Notion routing in `routeToolCall`, before the `confirm_action` check:
```typescript
  if (isNotionTool(name)) {
    return routeNotionTool(deps.notion, name, input);
  }
```

Add Notion mutating tools to `MUTATING_TOOLS`:
```typescript
const MUTATING_TOOLS = new Set([
  "write_memory", "delete_memory", "append_memory",
  "create_event", "create_recurring_event", "delete_calendar_event",
  "create_notion_page", "update_notion_page", "append_notion_page",
]);
```

- [ ] **Step 3: Update `lib/agent.ts` — add `notion` to `AgentDeps`**

In `lib/agent.ts`, add `notion` to the `AgentDeps` interface:
```typescript
import type { NotionClient } from "./deps.js";
```

```typescript
export interface AgentDeps {
  claude: ClaudeClient;
  redis: RedisClient;
  calendar: CalendarProvider;
  notion: NotionClient;
  clock: Clock;
}
```

- [ ] **Step 4: Add system prompt line**

In the `buildSystemPrompt` function array in `lib/agent.ts`, add after the voice message line:
```typescript
"You have access to the user's Notion workspace. Use search_notion to find pages before creating duplicates. Always read a page with read_notion_page before updating it with update_notion_page, since update replaces all content. Use append_notion_page to add content without overwriting. When sharing Notion content in Telegram, summarize rather than dumping full markdown.",
```

- [ ] **Step 5: Run typecheck**

Run: `source ~/.bashrc && npm run typecheck`
Expected: Pass

- [ ] **Step 6: Commit**

```bash
git add lib/notion-dispatch.ts lib/agent-dispatch.ts lib/agent.ts
git commit -m "Add Notion tool dispatch and system prompt guidance"
```

---

### Task 8: Final wiring and env

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add NOTION_API_KEY to .env.example**

Add at the end:
```
# Notion (internal integration — optional)
NOTION_API_KEY=ntn_...
```

- [ ] **Step 2: Run full quality gate**

Run: `source ~/.bashrc && npm run typecheck && npm run lint && npx vitest run`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "Add NOTION_API_KEY to .env.example"
```

---

## Chunk 4: Integration Tests

### Task 9: Integration tests

End-to-end tests using the NotionTwin to verify the full tool dispatch pipeline.

**Files:**
- Create: `tests/integration/notion.test.ts`

- [ ] **Step 1: Create `tests/integration/notion.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createNotionTwin } from "../../twins/notion.js";
import { dispatchTool } from "../../lib/agent-dispatch.js";
import type { FamilyMember } from "../../lib/types.js";
import type { DispatchDeps } from "../../lib/agent-dispatch.js";
import { RedisTwin } from "../../twins/redis.js";
import { CalendarTwin } from "../../twins/calendar.js";
import { CalendarProviderTwin } from "../../twins/calendar-provider.js";

const member: FamilyMember = {
  id: "marius", name: "Marius", chatId: 123,
  timezone: "Pacific/Auckland", role: "admin", isAdmin: true,
};

function buildDeps(notionClient: ReturnType<typeof createNotionTwin>["client"]): DispatchDeps {
  return {
    redis: new RedisTwin(),
    calendar: new CalendarProviderTwin(new CalendarTwin()),
    notion: notionClient,
    clock: { now: () => new Date("2026-03-13T12:00:00Z") },
  };
}

describe("Notion integration", () => {
  let twin: ReturnType<typeof createNotionTwin>["twin"];
  let deps: DispatchDeps;

  beforeEach(() => {
    const { client, twin: t } = createNotionTwin();
    twin = t;
    deps = buildDeps(client);
  });

  it("search finds pages by title", async () => {
    twin.addPage("Lasagna Recipe", "# Lasagna\n\n- 500g mince");
    twin.addPage("Budget 2026", "## Q1 Goals");

    const result = await dispatchTool(deps, member, "search_notion", { query: "lasagna" });
    expect(result.success).toBe(true);
    const pages = result.data as Array<{ title: string }>;
    expect(pages).toHaveLength(1);
    expect(pages[0]!.title).toBe("Lasagna Recipe");
  });

  it("search returns empty for no matches", async () => {
    const result = await dispatchTool(deps, member, "search_notion", { query: "nonexistent" });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("read returns page content as markdown", async () => {
    const pageId = twin.addPage("My Recipe", "# Ingredients\n\n- flour\n- sugar");
    const result = await dispatchTool(deps, member, "read_notion_page", { page_id: pageId });
    expect(result.success).toBe(true);
    const data = result.data as { title: string; content: string };
    expect(data.title).toBe("My Recipe");
    expect(data.content).toContain("# Ingredients");
    expect(data.content).toContain("- flour");
  });

  it("read returns error for missing page", async () => {
    const result = await dispatchTool(deps, member, "read_notion_page", { page_id: "nonexistent" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("create makes a new page with content", async () => {
    const parentId = twin.addPage("Recipes", "");
    const result = await dispatchTool(deps, member, "create_notion_page", {
      parent_page_id: parentId, title: "New Dish", markdown: "# Steps\n\n1. Cook\n2. Serve",
    });
    expect(result.success).toBe(true);
    const data = result.data as { title: string; id: string };
    expect(data.title).toBe("New Dish");
    expect(twin.getPageCount()).toBe(2);
  });

  it("update replaces page content", async () => {
    const pageId = twin.addPage("Old Content", "Original text");
    await dispatchTool(deps, member, "update_notion_page", {
      page_id: pageId, markdown: "New text here",
    });
    const readResult = await dispatchTool(deps, member, "read_notion_page", { page_id: pageId });
    const data = readResult.data as { content: string };
    expect(data.content).toContain("New text here");
    expect(data.content).not.toContain("Original");
  });

  it("append adds content to end of page", async () => {
    const pageId = twin.addPage("Shopping", "- milk");
    await dispatchTool(deps, member, "append_notion_page", {
      page_id: pageId, markdown: "- bread\n- eggs",
    });
    const readResult = await dispatchTool(deps, member, "read_notion_page", { page_id: pageId });
    const data = readResult.data as { content: string };
    expect(data.content).toContain("- milk");
    expect(data.content).toContain("- bread");
    expect(data.content).toContain("- eggs");
  });

  it("update refuses pages with too many blocks", async () => {
    // Build a page with > 100 blocks
    const lines = Array.from({ length: 105 }, (_, i) => `- item ${String(i)}`).join("\n");
    const pageId = twin.addPage("Big Page", lines);
    const result = await dispatchTool(deps, member, "update_notion_page", {
      page_id: pageId, markdown: "New content",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("too many blocks");
  });

  it("notion tools are audited as mutations", async () => {
    const parentId = twin.addPage("Parent", "");
    await dispatchTool(deps, member, "create_notion_page", {
      parent_page_id: parentId, title: "Audited", markdown: "test",
    });
    // Verify audit was written (check Redis log:audit)
    const auditResult = await deps.redis.execute(["LRANGE", "log:audit", "0", "-1"]);
    const entries = (auditResult.result as string[]).map((e) =>
      typeof e === "string" ? JSON.parse(e) : e,
    );
    const notionAudit = entries.find(
      (e: { action: string }) => e.action === "create_notion_page",
    );
    expect(notionAudit).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the integration tests**

Run: `source ~/.bashrc && npx vitest run tests/integration/notion.test.ts`
Expected: All pass

- [ ] **Step 3: Run full quality gate**

Run: `source ~/.bashrc && npm run typecheck && npm run lint && npx vitest run`
Expected: All pass — no regressions

- [ ] **Step 4: Commit**

```bash
git add tests/integration/notion.test.ts
git commit -m "Add Notion integration tests"
```

---

### Task 10: Deploy and manual test

- [ ] **Step 1: Add NOTION_API_KEY to Vercel env**

Run: `source ~/.bashrc && printf '%s' '<key-from-env-file>' | npx vercel env add NOTION_API_KEY production`

(Get the actual key value from the user's .env file first)

- [ ] **Step 2: Push to deploy**

```bash
git push origin main
```

- [ ] **Step 3: Manual test via Telegram**

Send Zoe:
- "Can you search my Notion for recipes?"
- "Read the first result"
- "Add a new item to the shopping list page"

Verify each tool call works end-to-end.
