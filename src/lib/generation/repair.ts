import { chromium } from "playwright";
import { z } from "zod";
import { structured, type ImageInput, aiFeatures } from "@/lib/ai/claude";
import { getObjectBuffer } from "@/lib/storage/r2";
import type { DesignDna } from "@/lib/dna/schema";
import type { SimilarityReport } from "./schema";

/**
 * Phase 7.5 — closed-loop visual repair. Screenshot the generated page, compare
 * to the original reference screenshot with Claude Vision, and apply a TARGETED
 * CSS patch (overrides only — never structural changes, so recipes stay intact)
 * until similarity exceeds the target or the round budget is exhausted.
 */

const PatchSchema = z.object({
  css: z.string(), // CSS override rules only
  changes: z.array(z.string()).default([]),
});

async function screenshot(html: string): Promise<Buffer | null> {
  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.setContent(html, { waitUntil: "networkidle", timeout: 15_000 }).catch(async () => {
        await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15_000 });
      });
      await page.waitForTimeout(300);
      return await page.screenshot({ type: "png", fullPage: false });
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}

function applyPatch(html: string, css: string): string {
  const block = `\n<style data-repair>\n${css}\n</style>\n`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${block}</head>`);
  return html.replace(/<\/body>/i, `${block}</body>`);
}

export interface RepairResult {
  html: string;
  report: SimilarityReport;
  rounds: number;
  changes: string[];
}

/**
 * @param score recompute similarity for a candidate HTML
 * @param target stop once overallSimilarity exceeds this (default 90)
 */
export async function visualRepair(
  initialHtml: string,
  initialReport: SimilarityReport,
  dna: DesignDna,
  score: (html: string) => Promise<SimilarityReport>,
  opts: { target?: number; maxRounds?: number; log?: (m: string) => void } = {},
): Promise<RepairResult> {
  const target = opts.target ?? 90;
  const maxRounds = opts.maxRounds ?? 3;
  const log = opts.log ?? (() => {});
  const allChanges: string[] = [];

  let bestHtml = initialHtml;
  let bestReport = initialReport;

  // Reference screenshot (original desktop capture) for visual comparison.
  const refKey = dna.screenshots.find((s) => s.kind === "DESKTOP")?.key ?? dna.screenshots[0]?.key;
  if (!aiFeatures.ai || !refKey) {
    log("visual repair skipped (no AI or no reference screenshot)");
    return { html: bestHtml, report: bestReport, rounds: 0, changes: [] };
  }
  let refImg: ImageInput | null = null;
  try {
    const buf = await getObjectBuffer(refKey);
    refImg = { base64: buf.toString("base64"), mediaType: "image/png" };
  } catch {
    return { html: bestHtml, report: bestReport, rounds: 0, changes: [] };
  }

  for (let round = 0; round < maxRounds; round++) {
    if (bestReport.overallSimilarity > target) break;
    const shot = await screenshot(bestHtml);
    if (!shot) break;
    const genImg: ImageInput = { base64: shot.toString("base64"), mediaType: "image/png" };

    let patch;
    try {
      patch = await structured(
        PatchSchema,
        `Image 1 is the ORIGINAL product page (reference). Image 2 is the GENERATED page that should match the original's visual language.
Return a TARGETED CSS PATCH (overrides only) to close the visual gap: spacing rhythm, type scale/weight, color emphasis, card/button density, container width, alignment.
HARD RULES:
- CSS overrides ONLY. Do NOT change HTML structure, column counts, or section composition.
- Prefer adjusting existing dna-* classes and CSS variables.
- Keep it minimal and on-brand.
Current weakest dimensions: ${JSON.stringify({ layout: bestReport.layout, visual: bestReport.visual, brand: bestReport.brandSimilarity, typography: bestReport.typography, spacing: bestReport.spacing })}
Known issues: ${JSON.stringify(bestReport.issues.slice(0, 8))}
Return JSON { css, changes }.`,
        { system: "You are a visual QA engineer. Output a minimal CSS override patch as JSON. No structural changes.", images: [refImg, genImg], maxTokens: 2000, temperature: 0.3 },
      );
    } catch {
      break;
    }
    if (!patch.css.trim()) break;

    const candidate = applyPatch(bestHtml, patch.css);
    const candidateReport = await score(candidate);
    log(`repair round ${round + 1}: ${bestReport.overallSimilarity} → ${candidateReport.overallSimilarity}`);
    if (candidateReport.overallSimilarity > bestReport.overallSimilarity) {
      bestHtml = candidate;
      bestReport = candidateReport;
      allChanges.push(...patch.changes);
    } else {
      break; // no improvement — stop
    }
  }

  return { html: bestHtml, report: bestReport, rounds: allChanges.length ? maxRounds : 0, changes: allChanges };
}
