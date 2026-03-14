/**
 * Fetch web page content via Jina Reader (r.jina.ai).
 * Returns clean markdown. No API key required.
 */

const MAX_CONTENT_LENGTH = 50_000;
const FETCH_TIMEOUT_MS = 15_000;

export async function fetchPageContent(url: string): Promise<string> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(jinaUrl, {
      signal: controller.signal,
      headers: { Accept: "text/markdown" },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch page (${String(response.status)})`);
    }
    const text = await response.text();
    if (text.length > MAX_CONTENT_LENGTH) {
      return text.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated at 50k characters]";
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}
