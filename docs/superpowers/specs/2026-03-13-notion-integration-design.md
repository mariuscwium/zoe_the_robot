# Notion Integration Design Spec

## Goal

Give Zoe full read/write access to the user's Notion workspace so she can search, read, create, update, and append pages — primarily recipes and side hustle notes. Content is translated between Notion's block model and markdown.

## Architecture

Same dependency injection pattern as calendar and transcription:

1. `NotionClient` interface in `lib/deps.ts`
2. Production client in `lib/clients.ts` wrapping `@notionhq/client` SDK
3. Optional wiring in `lib/prod-deps.ts` (needs `NOTION_API_KEY`)
4. 5 new tools in `tools/index.ts`
5. Tool dispatch in `lib/agent-dispatch.ts`
6. Markdown ↔ blocks converter split across `lib/notion-blocks.ts` (block ↔ markdown) and `lib/notion-richtext.ts` (inline annotation parsing)
7. `NotionTwin` coded against the `@notionhq/client` SDK interface, wrapped to produce a `NotionClient`

### Authentication

Notion internal integration — single bearer token (`NOTION_API_KEY`). No OAuth flow needed. The user creates an integration at notion.so/my-integrations, copies the token to `.env` and Vercel env vars.

The integration must be "connected" to pages in the Notion workspace UI for access. Full workspace access is available if the integration is added at the workspace level.

## NotionClient Interface

```typescript
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

The production client translates between this clean interface and the SDK's block-based API. The markdown conversion happens inside the client, not in the tool dispatch layer.

## Tools

### search_notion

- **Input:** `{ query: string }`
- **Output:** Array of `{ id, title, url, lastEditedTime }`
- Uses `notion.search()` with `filter: { value: "page", property: "object" }`
- Returns up to 10 results

### read_notion_page

- **Input:** `{ page_id: string }`
- **Output:** `{ title, url, lastEditedTime, content }` where content is markdown
- Fetches page metadata via `notion.pages.retrieve()`
- Fetches all blocks via `notion.blocks.children.list()` with pagination
- Converts blocks to markdown, handling nested children up to 2 levels deep

### create_notion_page

- **Input:** `{ title: string, markdown: string, parent_page_id: string }`
- **Output:** `{ id, title, url }`
- Creates as child page under `parent_page_id`
- `parent_page_id` is required — the Notion API needs an explicit parent for internal integrations
- Zoe can use `search_notion` to find a suitable parent page if the user doesn't specify one
- Converts markdown to blocks and passes as `children` to `notion.pages.create()`

### update_notion_page

- **Input:** `{ page_id: string, markdown: string }`
- **Output:** `{ success: true }`
- Destructive overwrite: deletes all existing top-level blocks, then appends new ones
- System prompt tells Zoe to always read before updating
- Delete via `notion.blocks.delete()` for each existing block, then `notion.blocks.children.append()` with new blocks
- **Guard:** Refuses to update pages with more than 100 top-level blocks — returns `{ error: "Page has too many blocks (N). Use append_notion_page instead." }`. This avoids serial delete storms and Vercel timeouts.
- Deletes are batched with 3 concurrent requests at a time to stay within Notion's rate limits

### append_notion_page

- **Input:** `{ page_id: string, markdown: string }`
- **Output:** `{ success: true }`
- Non-destructive: appends blocks to end of page
- Uses `notion.blocks.children.append()`

## Markdown ↔ Blocks Converter

Pure functions split across two files to stay under the 200-line lint limit:
- `lib/notion-richtext.ts` — rich text annotation parsing (inline formatting ↔ markdown)
- `lib/notion-blocks.ts` — block-level conversion (blocks ↔ markdown lines), uses richtext helpers

### Blocks → Markdown (`blocksToMarkdown`)

Supported block types:
- `paragraph` → plain text with inline formatting
- `heading_1/2/3` → `# / ## / ###`
- `bulleted_list_item` → `- `
- `numbered_list_item` → `1. `
- `to_do` → `- [ ] ` / `- [x] `
- `code` → fenced code block with language
- `quote` → `> `
- `divider` → `---`
- `callout` → `> ` with emoji prefix

Rich text annotations → markdown inline:
- `bold` → `**text**`
- `italic` → `*text*`
- `code` → `` `text` ``
- `strikethrough` → `~~text~~`
- `link` → `[text](url)`

Unsupported block types → `[unsupported: <type>]`

Nested children (up to 2 levels): indented with 2 spaces per level.

### Markdown → Blocks (`markdownToBlocks`)

Parses markdown line by line:
- `# ` → `heading_1`, `## ` → `heading_2`, `### ` → `heading_3`
- `- ` → `bulleted_list_item`
- `1. ` (or any `N. `) → `numbered_list_item`
- `- [ ] ` / `- [x] ` → `to_do`
- `> ` → `quote`
- `` ``` `` → `code` (with optional language)
- `---` → `divider`
- Everything else → `paragraph`

Inline formatting parsed with regex:
- `**text**` → bold annotation
- `*text*` → italic annotation
- `` `text` `` → code annotation
- `~~text~~` → strikethrough annotation
- `[text](url)` → link

## Production Client

Uses `@notionhq/client` SDK (npm package `@notionhq/client`).

```typescript
import { Client } from "@notionhq/client";
```

Key SDK methods used:
- `client.search({ query, filter })` — search pages
- `client.pages.retrieve({ page_id })` — page metadata
- `client.pages.create({ parent, properties, children })` — create page with content
- `client.blocks.children.list({ block_id, page_size })` — read blocks (paginated)
- `client.blocks.children.append({ block_id, children })` — append blocks
- `client.blocks.delete({ block_id })` — delete individual block

Pagination: `blocks.children.list` returns `has_more` and `next_cursor`. The client loops until all blocks are fetched, with a hard cap of 500 blocks total (including nested children). If truncated, the markdown ends with `\n\n[Content truncated — page has more blocks than the 500-block limit]`.

## NotionTwin

Coded against the `@notionhq/client` SDK interface — not just the `NotionClient` deps interface. The twin implements the same method signatures as the real SDK client so it catches integration issues.

In-memory store:
- `pages: Map<string, { title, parentId, blocks, createdTime, lastEditedTime }>`
- Blocks stored as SDK block objects (same shape as API responses)

Methods matching SDK:
- `search()` → filters pages by query string in title
- `pages.retrieve()` → returns page object
- `pages.create()` → stores page + blocks, returns page object
- `blocks.children.list()` → returns blocks for a page
- `blocks.children.append()` → adds blocks to page
- `blocks.delete()` → removes block by ID

Test helpers:
- `addPage(title, blocks)` → seed pages for test scenarios
- `getPages()` → inspect internal state
- `reset()` → clear all data

The production `createNotionClient()` wraps the real SDK and returns a `NotionClient`. The twin's internal store uses the same block object shapes as the SDK API responses. A factory function `createNotionTwin()` returns both the `NotionClient` interface (for injection into `Deps`) and the twin instance (for test assertions/seeding). This keeps the `Deps` interface clean while still testing against realistic SDK shapes.

## System Prompt Addition

```
You have access to the user's Notion workspace. Use search_notion to find pages before creating duplicates. Always read a page with read_notion_page before updating it with update_notion_page, since update replaces all content. Use append_notion_page to add content without overwriting. When sharing Notion content in Telegram, summarize rather than dumping full markdown.
```

## Error Handling

- Missing `NOTION_API_KEY` → stub client rejects with "Notion isn't configured yet." (same pattern as transcription)
- Page not found → tool returns `{ error: "Page not found" }`
- API rate limit (429) → tool returns `{ error: "Notion rate limit, try again shortly" }`
- No access to page → tool returns `{ error: "No access to this page. Make sure the Notion integration is connected." }`

## Files

| File | Change |
|------|--------|
| `lib/deps.ts` | Add `NotionClient`, `NotionPage`, add `notion` to `Deps` |
| `lib/notion-richtext.ts` | New — rich text annotation ↔ markdown inline formatting |
| `lib/notion-blocks.ts` | New — block-level ↔ markdown conversion |
| `lib/clients.ts` | Add `createNotionClient()` |
| `lib/prod-deps.ts` | Wire optional `NOTION_API_KEY` |
| `tools/index.ts` | Add 5 Notion tool schemas |
| `lib/agent-dispatch.ts` | Add `notion` to `DispatchDeps`, add `routeNotionTool()` |
| `lib/agent.ts` | Update system prompt |
| `twins/notion.ts` | New — NotionTwin (coded against SDK interface) |
| `lib/notion-richtext.test.ts` | New — richtext converter unit tests |
| `lib/notion-blocks.test.ts` | New — block converter unit tests |
| `tests/integration/notion.test.ts` | New — integration scenarios |
| `.env.example` | Add `NOTION_API_KEY` |
| `package.json` | Add `@notionhq/client` dependency |

## Testing

### Unit tests (`lib/notion-richtext.test.ts`)
- Bold, italic, code, strikethrough, links
- Mixed inline formatting in single line
- Plain text (no formatting)
- Round-trip: rich text → markdown → rich text

### Unit tests (`lib/notion-blocks.test.ts`)
- Headings, paragraphs, lists, code blocks, quotes, dividers, to-dos, callouts
- Unsupported blocks produce `[unsupported: <type>]`
- Nested children indented correctly
- Round-trip: markdown → blocks → markdown preserves content
- Empty content, edge cases

### Integration tests (`tests/integration/notion.test.ts`)
- Search returns matching pages
- Read page returns title + markdown content
- Create page with markdown content
- Update page replaces content
- Append adds to end of page
- Page not found returns error
- Agent receives Notion tools and can use them
- Missing API key → "not configured" response

## Verification

1. `npm run quality` passes
2. Manual test: search, read, create, update a real Notion page
3. All existing tests pass (no regressions)
