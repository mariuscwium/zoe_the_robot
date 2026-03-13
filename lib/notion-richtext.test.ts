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
    expect(result.at(0)?.plain_text).toBe("hello");
    expect(result.at(0)?.annotations.bold).toBe(false);
  });

  it("parses bold", () => {
    const result = markdownToRichText("**bold**");
    expect(result).toHaveLength(1);
    expect(result.at(0)?.plain_text).toBe("bold");
    expect(result.at(0)?.annotations.bold).toBe(true);
  });

  it("parses italic", () => {
    const result = markdownToRichText("*italic*");
    expect(result).toHaveLength(1);
    expect(result.at(0)?.annotations.italic).toBe(true);
  });

  it("parses inline code", () => {
    const result = markdownToRichText("`code`");
    expect(result).toHaveLength(1);
    expect(result.at(0)?.annotations.code).toBe(true);
  });

  it("parses strikethrough", () => {
    const result = markdownToRichText("~~gone~~");
    expect(result).toHaveLength(1);
    expect(result.at(0)?.annotations.strikethrough).toBe(true);
  });

  it("parses links", () => {
    const result = markdownToRichText("[click](https://example.com)");
    expect(result).toHaveLength(1);
    expect(result.at(0)?.href).toBe("https://example.com");
    expect(result.at(0)?.text.link).toEqual({ url: "https://example.com" });
  });

  it("parses mixed text", () => {
    const result = markdownToRichText("Hello **world**!");
    expect(result).toHaveLength(3);
    expect(result.at(0)?.plain_text).toBe("Hello ");
    expect(result.at(1)?.plain_text).toBe("world");
    expect(result.at(1)?.annotations.bold).toBe(true);
    expect(result.at(2)?.plain_text).toBe("!");
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
