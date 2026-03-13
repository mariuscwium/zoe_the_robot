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
