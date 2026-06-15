import type { CrawlBundle } from "@/lib/crawler/types";
import type { FirecrawlResult } from "@/lib/firecrawl";
import { analyzeCss, type CssAnalysis } from "./css";
import { analyzeHtml } from "./html";
import { buildEvidence, type Evidence } from "./evidence";

export type { Evidence } from "./evidence";

export interface UploadedSource {
  kind: "CSS" | "HTML" | "SCREENSHOT" | "ASSET" | "BRAND_GUIDELINE" | "DESIGN_REFERENCE";
  text?: string; // inline text for CSS/HTML/brand notes
}

export interface ExtractionInput {
  bundle: CrawlBundle;
  firecrawl?: FirecrawlResult;
  uploaded?: UploadedSource[];
  fetchStylesheets?: boolean;
  log?: (msg: string) => void;
}

async function fetchCss(href: string): Promise<string | null> {
  try {
    const res = await fetch(href, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("css") && !href.endsWith(".css")) return null;
    return (await res.text()).slice(0, 600_000);
  } catch {
    return null;
  }
}

/**
 * Phase 5 — assemble all sources into one grounded Evidence object. Merges
 * Playwright (primary), fetched/inline/uploaded CSS, uploaded HTML, and
 * Firecrawl content. Never throws on a missing source.
 */
export async function extract(input: ExtractionInput): Promise<{
  evidence: Evidence;
  brandNotes: string;
}> {
  const log = input.log ?? (() => {});
  const cssParts: CssAnalysis[] = [];

  // 1) inline <style> from every crawled page
  for (const page of input.bundle.pages) {
    for (const css of page.extract.inlineStyles) cssParts.push(analyzeCss(css));
  }

  // 2) external stylesheets (best-effort, capped)
  if (input.fetchStylesheets !== false) {
    const hrefs = new Set<string>();
    for (const page of input.bundle.pages) {
      for (const h of page.extract.stylesheetHrefs) hrefs.add(h);
    }
    const limited = Array.from(hrefs).slice(0, 8);
    log(`fetching ${limited.length} stylesheets`);
    const texts = await Promise.all(limited.map(fetchCss));
    for (const t of texts) if (t) cssParts.push(analyzeCss(t));
  }

  // 3) uploaded CSS + HTML + brand notes (fallback/augmentation)
  let brandNotes = "";
  for (const src of input.uploaded ?? []) {
    if (!src.text) continue;
    if (src.kind === "CSS") cssParts.push(analyzeCss(src.text));
    else if (src.kind === "HTML") {
      const h = analyzeHtml(src.text);
      for (const s of h.inlineStyles) cssParts.push(analyzeCss(s));
    } else if (src.kind === "BRAND_GUIDELINE" || src.kind === "DESIGN_REFERENCE") {
      brandNotes += `\n${src.text}`;
    }
  }

  // 4) Firecrawl HTML content (augment CSS mining if present)
  if (input.firecrawl?.available) {
    for (const p of input.firecrawl.pages.slice(0, 6)) {
      if (p.html) {
        const h = analyzeHtml(p.html);
        for (const s of h.inlineStyles) cssParts.push(analyzeCss(s));
      }
    }
  }

  const evidence = buildEvidence(input.bundle, cssParts);
  log(
    `evidence: ${evidence.colors.length} colors, ${evidence.fonts.length} fonts, ${evidence.blocksByType.length} block types, ${evidence.screenshots.length} screenshots`,
  );
  return { evidence, brandNotes: brandNotes.trim() };
}
