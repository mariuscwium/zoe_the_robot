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
    .filter((r) => r.object === "page" && "properties" in r)
    .map((r) => extractPage(r as unknown as PageObjectResponse));
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
    children: blocks as unknown as Parameters<typeof sdk.pages.create>[0]["children"],
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
    children: newBlocks as unknown as Parameters<typeof sdk.blocks.children.append>[0]["children"],
  });
}

async function appendToPage(sdk: Client, pageId: string, md: string): Promise<void> {
  const blocks = markdownToBlocks(md);
  await sdk.blocks.children.append({
    block_id: pageId,
    children: blocks as unknown as Parameters<typeof sdk.blocks.children.append>[0]["children"],
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

interface PageObjectResponse {
  id: string;
  url: string;
  last_edited_time: string;
  properties: Record<string, unknown>;
}

interface BlockObjectResponse { id: string; type: string; has_children: boolean }

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
  const titleObj = titleProp as { title?: { plain_text: string }[] };
  return titleObj.title?.[0]?.plain_text ?? "Untitled";
}
