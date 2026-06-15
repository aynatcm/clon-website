import * as cheerio from "cheerio";

/**
 * Cheerio analysis of raw HTML — used for uploaded HTML sources and as a
 * fallback structural extractor when Playwright is unavailable. Mirrors the
 * block taxonomy used by the in-page crawler script.
 */

export interface HtmlBlock {
  type: string;
  tag: string;
  classes: string;
  text: string;
  childCount: number;
}

export interface HtmlAnalysis {
  title?: string;
  description?: string;
  headings: { level: number; text: string }[];
  blocks: HtmlBlock[];
  inlineStyles: string[];
  stylesheetHrefs: string[];
  linkTexts: string[];
}

function classify(tag: string, hay: string): string | null {
  if (tag === "nav" || /(^|\s)nav|navbar|menu/.test(hay)) return "nav";
  if (tag === "footer" || /footer/.test(hay)) return "footer";
  if (/hero|jumbotron|masthead/.test(hay)) return "hero";
  if (/pricing|plan|tier/.test(hay)) return "pricing";
  if (/testimonial|review|quote/.test(hay)) return "testimonials";
  if (/feature/.test(hay)) return "feature-grid";
  if (/logo(s|-cloud|wall)/.test(hay)) return "logos";
  if (/stat|metric/.test(hay)) return "stats";
  if (/cta|call-to-action|get-started|signup/.test(hay)) return "cta";
  if (/team|people|member/.test(hay)) return "team";
  if (/card/.test(hay)) return "card";
  if (tag === "form" || /form/.test(hay)) return "form";
  return null;
}

export function analyzeHtml(html: string): HtmlAnalysis {
  const $ = cheerio.load(html);
  const headings: HtmlAnalysis["headings"] = [];
  $("h1,h2,h3").each((_, el) => {
    const level = Number(el.tagName.slice(1));
    const text = $(el).text().trim().replace(/\s+/g, " ").slice(0, 120);
    if (text) headings.push({ level, text });
  });

  const blocks: HtmlBlock[] = [];
  const seen = new Set<unknown>();
  $(
    'nav,footer,form,section,header,[class*="hero"],[class*="feature"],[class*="pricing"],[class*="testimonial"],[class*="cta"],[class*="logo"],[class*="stat"],[class*="team"],[class*="card"]',
  ).each((_, el) => {
    if (seen.has(el)) return;
    seen.add(el);
    const tag = el.tagName.toLowerCase();
    const classes = ($(el).attr("class") || "").toLowerCase();
    const id = ($(el).attr("id") || "").toLowerCase();
    const type = classify(tag, `${classes} ${id}`);
    if (!type) return;
    blocks.push({
      type,
      tag,
      classes: classes.slice(0, 160),
      text: $(el).text().trim().replace(/\s+/g, " ").slice(0, 180),
      childCount: $(el).children().length,
    });
  });

  return {
    title: $("title").first().text().trim() || undefined,
    description: $('meta[name="description"]').attr("content")?.trim(),
    headings: headings.slice(0, 40),
    blocks: blocks.slice(0, 80),
    inlineStyles: $("style")
      .map((_, el) => $(el).text())
      .get()
      .filter((t) => t.trim())
      .slice(0, 12),
    stylesheetHrefs: $('link[rel="stylesheet"]')
      .map((_, el) => $(el).attr("href") || "")
      .get()
      .filter(Boolean),
    linkTexts: $("a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .slice(0, 60),
  };
}
