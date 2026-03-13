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
  private _store = new Map<string, StoredPage>();

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
