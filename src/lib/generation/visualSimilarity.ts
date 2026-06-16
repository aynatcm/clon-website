import { chromium } from "playwright";
import { extractInPage } from "@/lib/crawler/pageScript";
import type { DesignDna } from "@/lib/dna/schema";
import type { DesignSystem } from "@/lib/designsystem/schema";
import type { PageArchitecture } from "./schema";

/**
 * Visual similarity layer (problem 7) — renders the GENERATED HTML, re-extracts
 * computed styles, and measures how faithfully it reproduces the DNA. Layout
 * fidelity (grid/column/split structure + container) is measured here so the
 * combiner can penalize layout mismatch heavily (requirement 9: layout 40%).
 */

export interface VisualBreakdown {
  color: number;
  corners: number;
  typography: number;
  layout: number; // structural fidelity (container + columns + grid/split)
  sections: number;
  structuralComplete: boolean; // all required structural elements rendered
  missing: string[];
  method: "rendered" | "skipped";
}

interface StructuralCensus {
  validSplits: number; // dna-split with content column + non-empty visual column
  validGrids: number; // dna-grid with >= 2 dna-card
  validLogos: number; // dna-logos with >= 2 items
  forms: number;
  nonEmptyMedia: number;
  emptyMedia: number;
}

/** Counts the actual structural elements present in the rendered DOM. */
function structuralCensus(): StructuralCensus {
  const all = (sel: string) => Array.from(document.querySelectorAll(sel));
  const validSplits = all(".dna-split").filter(
    (el) => el.querySelector(".dna-split__content") && hasArtifact(el.querySelector(".dna-media")),
  ).length;
  const validGrids = all(".dna-grid").filter((el) => el.querySelectorAll(".dna-card").length >= 2).length;
  const validLogos = all(".dna-logos").filter((el) => el.querySelectorAll(".dna-logos__item").length >= 2).length;
  const media = all(".dna-media");
  const nonEmptyMedia = media.filter((el) => hasArtifact(el)).length;
  return {
    validSplits,
    validGrids,
    validLogos,
    forms: document.querySelectorAll("form").length,
    nonEmptyMedia,
    emptyMedia: media.length - nonEmptyMedia,
  };

  function hasArtifact(el: Element | null): boolean {
    if (!el) return false;
    if ((el as HTMLElement).dataset.generatedMock === "true") return false;
    // real visual = child elements (svg/mockup) OR a background IMAGE (url),
    // NOT a decorative gradient alone.
    if (el.childElementCount > 0) return true;
    const bg = getComputedStyle(el).backgroundImage || "";
    return /url\(/.test(bg);
  }
}

function rgb(hex: string): [number, number, number] | null {
  const m = hex.replace("#", "");
  if (m.length < 6) return null;
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
function colorDist(a: string, b: string): number {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return 999;
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
}
function nearestMatch(target: string, pool: string[]): number {
  if (!pool.length) return 0;
  const best = Math.min(...pool.map((c) => colorDist(target, c)));
  return Math.max(0, 1 - best / 120);
}
const px = (v?: string) => {
  const m = (v ?? "").match(/(-?\d+(\.\d+)?)px/);
  return m ? parseFloat(m[1]) : NaN;
};

/** Expected column count for an architecture section, from its detected layout. */
function expectedColumns(variant: string | undefined, columns: number | undefined): number {
  if (variant === "split") return 2;
  if (variant === "grid") return Math.max(2, columns ?? 3);
  return 1;
}

export async function visualSimilarity(
  html: string,
  dna: DesignDna,
  arch: PageArchitecture,
  system: DesignSystem,
): Promise<{ score: number; breakdown: VisualBreakdown; issues: string[] }> {
  const issues: string[] = [];
  let rendered: ReturnType<typeof extractInPage> | null = null;
  let census: StructuralCensus | null = null;

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript(() => {
        const g = globalThis as unknown as { __name?: (f: unknown) => unknown };
        if (!g.__name) g.__name = (f) => f;
      });
      const page = await ctx.newPage();
      await page.setContent(html, { waitUntil: "networkidle", timeout: 15_000 }).catch(async () => {
        await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15_000 });
      });
      await page.waitForTimeout(300);
      rendered = await page.evaluate(extractInPage);
      census = await page.evaluate(structuralCensus);
    } finally {
      await browser.close();
    }
  } catch (err) {
    issues.push(`visual render failed: ${(err as Error).message.slice(0, 80)}`);
    return {
      score: 0,
      breakdown: { color: 0, corners: 0, typography: 0, layout: 0, sections: 0, structuralComplete: false, missing: ["render failed"], method: "skipped" },
      issues,
    };
  }

  // --- color ---
  const renderedColors = Array.from(new Set(rendered.colorSignals.map((s) => s.color)));
  const targetColors = [
    dna.colors.decisions.primary?.value,
    dna.colors.decisions.cta?.value,
    dna.colors.decisions.accent?.value,
    dna.colors.decisions.background?.value,
    dna.colors.decisions.text?.value,
  ].filter(Boolean) as string[];
  const color = targetColors.length
    ? Math.round((targetColors.reduce((s, c) => s + nearestMatch(c, renderedColors), 0) / targetColors.length) * 100)
    : 60;
  if (color < 70) issues.push("visual: rendered colors drift from brand colors");

  // --- corners ---
  const renderedRadius = px(rendered.components.button[0]?.radius);
  const expectedR =
    dna.visualRules.cornerStyle === "pill" ? 999 : dna.visualRules.cornerStyle === "rounded" ? 16 : dna.visualRules.cornerStyle === "sharp" ? 0 : 8;
  let corners = 70;
  if (!isNaN(renderedRadius)) {
    if (expectedR >= 999) corners = renderedRadius >= 100 ? 100 : 40;
    else corners = Math.max(0, 100 - Math.min(100, Math.abs(renderedRadius - expectedR) * 4));
  }

  // --- typography ---
  const renderedFonts = rendered.fontCounts.map((f) => f.family.toLowerCase());
  const dnaFonts = dna.typography.fonts.map((f) => f.family.toLowerCase());
  const fontHit = dnaFonts.filter((f) => renderedFonts.some((r) => r.includes(f) || f.includes(r))).length;
  const typography = dnaFonts.length ? Math.round((fontHit / dnaFonts.length) * 100) : 60;

  // --- LAYOUT FIDELITY (structural) ---
  // container width proximity
  const dnaContainer = px(dna.layout.maxContentWidth) || px(dna.layout.containers[0]);
  const renderedContainer = Math.max(0, ...rendered.layout.containerWidths);
  let containerScore = 60;
  if (!isNaN(dnaContainer) && renderedContainer > 0) {
    containerScore = Math.round((Math.min(dnaContainer, renderedContainer) / Math.max(dnaContainer, renderedContainer)) * 100);
  }
  // multi-column structure: expected vs rendered
  const expectedMulti = arch.sections.filter((s) => {
    const l = system.layouts.find((x) => x.type === s.type);
    return expectedColumns(s.layout || l?.variant, l?.columns) >= 2;
  }).length;
  const renderedMulti = rendered.sectionFingerprints.filter((f) => f.columns >= 2).length;
  const columnScore = expectedMulti === 0 ? 100 : Math.round((Math.min(renderedMulti, expectedMulti) / expectedMulti) * 100);
  if (expectedMulti > renderedMulti) issues.push(`layout: ${renderedMulti}/${expectedMulti} multi-column sections rendered`);
  // split presence (content + visual area)
  const splitExpected = arch.sections.some((s) => (s.layout || system.layouts.find((x) => x.type === s.type)?.variant) === "split");
  const splitPresent = /dna-split/.test(html) && /dna-media/.test(html);
  const splitScore = !splitExpected ? 100 : splitPresent ? 100 : 30;
  if (splitExpected && !splitPresent) issues.push("layout: split-hero (content+visual) not reproduced");
  const gridPresent = rendered.layout.gridTemplates.length > 0 || renderedMulti > 0;

  let layout = Math.round(containerScore * 0.34 + columnScore * 0.33 + splitScore * 0.18 + (gridPresent ? 100 : 0) * 0.15);

  // === STRUCTURAL COMPLETENESS GATE ===
  // Required structural elements per detected layout. layout score may NOT
  // exceed 90 unless EVERY required element is present in the rendered page.
  const need = { split: 0, gridCards: 0, logos: 0, form: 0 };
  for (const s of arch.sections) {
    const l = system.layouts.find((x) => x.type === s.type);
    const variant = s.layout || l?.variant;
    if (variant === "split") need.split++;
    else if (variant === "grid") need.gridCards++;
    else if (variant === "logos") need.logos++;
    else if (variant === "form" || s.type === "contact-section") need.form++;
  }
  const c = census ?? { validSplits: 0, validGrids: 0, validLogos: 0, forms: 0, nonEmptyMedia: 0, emptyMedia: 0 };
  const missing: string[] = [];
  if (c.validSplits < need.split)
    missing.push(`split-hero: content+visual columns in grid (${c.validSplits}/${need.split})`);
  if (c.validGrids < need.gridCards)
    missing.push(`grid/pricing: repeated cards in grid (${c.validGrids}/${need.gridCards})`);
  if (c.validLogos < need.logos) missing.push(`logo-cloud: repeated logos (${c.validLogos}/${need.logos})`);
  if (c.forms < need.form) missing.push(`contact-section: form (${c.forms}/${need.form})`);
  if (c.emptyMedia > 0) missing.push(`media area empty (${c.emptyMedia}) — needs a visual artifact`);
  const structuralComplete = missing.length === 0;
  issues.push(...missing.map((m) => `layout: ${m}`));
  if (!structuralComplete) layout = Math.min(layout, 90);

  // --- sections type overlap (secondary) ---
  const dnaTypes = new Set(dna.sections.map((s) => s.type));
  const renderedTypes = new Set(rendered.sectionFingerprints.map((s) => s.type));
  let overlap = 0;
  for (const t of renderedTypes) if (dnaTypes.has(t)) overlap++;
  const sections = renderedTypes.size ? Math.round((overlap / renderedTypes.size) * 100) : 50;

  const breakdown: VisualBreakdown = { color, corners, typography, layout, sections, structuralComplete, missing, method: "rendered" };
  // composite (display only); combiner re-weights into the 40/30/15/15 buckets
  const score = Math.round(layout * 0.4 + color * 0.25 + corners * 0.15 + typography * 0.2);
  return { score, breakdown, issues };
}
