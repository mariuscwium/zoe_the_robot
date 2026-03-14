import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchPageContent } from "./web-fetch.js";

describe("fetchPageContent", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("fetches content via jina reader", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("# Recipe\n\nDelicious food"),
    });

    const result = await fetchPageContent("https://example.com/recipe");
    expect(result).toBe("# Recipe\n\nDelicious food");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://r.jina.ai/https://example.com/recipe",
      expect.objectContaining({ headers: { Accept: "text/markdown" } }),
    );
  });

  it("truncates content exceeding 50k characters", async () => {
    const longContent = "x".repeat(60_000);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(longContent),
    });

    const result = await fetchPageContent("https://example.com");
    expect(result.length).toBeLessThan(60_000);
    expect(result).toContain("[Content truncated at 50k characters]");
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(fetchPageContent("https://example.com/missing"))
      .rejects.toThrow("Failed to fetch page (404)");
  });
});
