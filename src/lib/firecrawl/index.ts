import { env, features } from "@/lib/env";

/**
 * Phase 4 — Firecrawl (SECONDARY source). Discovers pages, content, metadata,
 * and recurring templates to merge with Playwright findings. Returns empty
 * results (never throws) when not configured, so the pipeline degrades.
 */

export interface FirecrawlPage {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
  html?: string;
}

export interface FirecrawlResult {
  available: boolean;
  pages: FirecrawlPage[];
  discoveredUrls: string[];
  sitemap: string[];
}

const EMPTY: FirecrawlResult = { available: false, pages: [], discoveredUrls: [], sitemap: [] };

async function api<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${env.FIRECRAWL_API_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function firecrawlSite(
  url: string,
  opts: { limit?: number } = {},
): Promise<FirecrawlResult> {
  if (!features.firecrawl) return EMPTY;
  const limit = opts.limit ?? 10;

  // 1) map endpoint for fast URL discovery / sitemap.
  const map = await api<{ links?: string[] }>("/v1/map", { url, limit: 100 });
  const discoveredUrls = map?.links ?? [];

  // 2) crawl a handful of pages for content + metadata.
  const crawl = await api<{
    data?: Array<{
      markdown?: string;
      html?: string;
      metadata?: { title?: string; description?: string; sourceURL?: string; url?: string };
    }>;
  }>("/v1/crawl", {
    url,
    limit,
    scrapeOptions: { formats: ["markdown", "html"] },
  });

  const pages: FirecrawlPage[] =
    crawl?.data?.map((d) => ({
      url: d.metadata?.sourceURL ?? d.metadata?.url ?? url,
      title: d.metadata?.title,
      description: d.metadata?.description,
      markdown: d.markdown,
      html: d.html,
    })) ?? [];

  return {
    available: true,
    pages,
    discoveredUrls,
    sitemap: discoveredUrls,
  };
}
