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
  const clock = { now: () => new Date("2026-03-13T12:00:00Z") };
  return {
    redis: new RedisTwin(clock),
    calendar: new CalendarProviderTwin(new CalendarTwin()),
    notion: notionClient,
    clock,
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
    const pages = result.data as { title: string }[];
    expect(pages).toHaveLength(1);
    expect(pages[0]?.title).toBe("Lasagna Recipe");
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
    const auditResult = await deps.redis.execute(["LRANGE", "log:audit", "0", "-1"]);
    const entries = (auditResult.result as string[]).map((e): { action: string } =>
      typeof e === "string" ? (JSON.parse(e) as { action: string }) : (e as { action: string }),
    );
    const notionAudit = entries.find((e) => e.action === "create_notion_page");
    expect(notionAudit).toBeDefined();
  });
});
