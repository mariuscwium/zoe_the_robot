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
