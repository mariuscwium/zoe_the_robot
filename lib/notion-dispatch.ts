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
