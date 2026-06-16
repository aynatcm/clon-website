import type { DesignDna } from "@/lib/dna/schema";
import type { DesignSystem } from "@/lib/designsystem/schema";
import type { BrandContext } from "@/lib/brand/schema";
import { complete, aiFeatures } from "@/lib/ai/claude";
import { renderHtml } from "./render";
import type { PageArchitecture, SimilarityReport } from "./schema";
import { generationContextBlock } from "./promptContext";

/**
 * Phase 11 — production HTML. Single self-contained file with the design-system
 * CSS inlined, using the canonical dna-* classes so it visually belongs to the
 * source product. AI writes real on-brand copy + markup; deterministic renderer
 * is the floor / fallback.
 */

function extractHtml(text: string): string | null {
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;
  const start = body.search(/<!DOCTYPE html>|<html[\s>]/i);
  if (start === -1) return null;
  return body.slice(start).trim();
}

const SYSTEM = `You are a Senior Frontend Engineer producing a SINGLE, production-ready HTML file that EXTENDS an existing product by INSTANTIATING its detected layouts — not by recoloring a generic template.
Hard requirements:
- One self-contained .html file. Inline ALL CSS in a single <style>. Start with <!DOCTYPE html>.
- Include the provided Design System CSS verbatim inside <style>, then add only minimal page-specific CSS.
- LAYOUT-DRIVEN: each section MUST reproduce its detected layout's structure:
  · variant "split"   -> <div class="dna-split"> with a content area AND a visual area (dna-media). Two-column grid.
  · variant "grid"    -> <div class="dna-grid dna-grid--N"> of dna-card items (N = the layout's columns).
  · variant "centered"-> centered hero/cta block.
  · variant "form"    -> form using dna-input fields + dna-button.
  · variant "logos"   -> dna-logos row.
  · variant "stacked" -> prose content-block.
  Preserve grid/column counts exactly as given. If a layout is a 12-column split, render display:grid with two columns (content + visual).
- Apply component fingerprints: buttons use dna-button/dna-cta (measured radius/padding/weight/shadow); cards use dna-card (measured radius/border/shadow/padding); inputs use dna-input.
- Use ONLY the brand's colors, fonts, radii, spacing. No foreign styles. No generic sections.
- MEDIA: every media-bearing section MUST contain a real visual. If the section provides visualAssetUrl, render <img src="{url}" alt="..." class="dna-media__img"> inside .dna-media. NEVER output an empty <div class="dna-media"></div>. If no asset, build a style-matched mock (window chrome + chart/code/UI), never empty.
- ASSETS: use exact URLs from MANDATORY ASSET LIBRARY. Never make up image URLs. If a section has media, choose a crawled asset matching the section role before falling back to a mock.
- VARIABLES: page-specific CSS must reuse ORIGINAL CSS VARIABLES / RAW SOURCE TOKENS when possible; avoid introducing unrelated token names or arbitrary colors.
- COPY/VOICE: write in the brand's voice (tone, sentence length, vocabulary). Reuse the brand's real headlines and CTA labels. NEVER use the forbidden generic phrases. Echo the product's actual terminology.
- Semantic HTML5, accessible (labels, alt, aria, landmarks), responsive, SEO-friendly. NO lorem ipsum / placeholders / TODOs.
- Output ONLY the HTML.`;

export async function generateHtml(
  arch: PageArchitecture,
  dna: DesignDna,
  system: DesignSystem,
  css: string,
  opts: { refineFrom?: { html: string; report: SimilarityReport }; brand?: BrandContext } = {},
): Promise<string> {
  const brand = opts.brand;
  const fallback = renderHtml(arch, system, dna, css, brand);
  if (!aiFeatures.ai) return fallback;

  const refine = opts.refineFrom
    ? `\n\n=== PREVIOUS ATTEMPT SCORED ${opts.refineFrom.report.overall}/100 (need >= 85) ===
Fix these issues, keep everything else continuous:
${opts.refineFrom.report.issues.map((i) => `- ${i}`).join("\n")}`
    : "";

  const prompt = `Generate the "${arch.pageTitle}" page.

=== PAGE ARCHITECTURE ===
${JSON.stringify(arch)}

=== BRAND PERSONALITY ===
${dna.designPhilosophy.summary}
Keywords: ${dna.designPhilosophy.keywords.join(", ")}
Visual rules: whitespace=${dna.visualRules.whitespace}, corners=${dna.visualRules.cornerStyle}, shadows=${dna.visualRules.shadowStyle}, composition=${dna.visualRules.composition}

=== SECTION → DETECTED LAYOUT (instantiate each structure exactly) ===
${JSON.stringify(
  arch.sections.map((s) => {
    const l = system.layouts.find((x) => x.type === s.type);
    return {
      type: s.type,
      variant: s.layout || l?.variant,
      columns: l?.columns,
      hasMedia: l?.hasMedia,
      hasForm: l?.hasForm,
      structure: l?.structure,
    };
  }),
)}

=== COMPONENT FINGERPRINTS (buttons/cards/inputs must inherit these) ===
${JSON.stringify(system.components.map((c) => ({ type: c.type, className: c.className, fingerprint: c.fingerprint })))}
${
  brand
    ? `
=== BRAND VOICE (write in this voice) ===
${JSON.stringify(brand.brandVoice)}
=== REAL COPY LIBRARY (reuse vocabulary, headline & CTA style) ===
headlines: ${JSON.stringify(brand.headlines.slice(0, 12))}
features: ${JSON.stringify(brand.features.slice(0, 12))}
ctaLabels: ${JSON.stringify(brand.ctaPatterns)}
navLabels: ${JSON.stringify(brand.navigationPatterns)}
${generationContextBlock(brand, system)}
=== SCREENSHOT / IMAGERY ANALYSIS ===
${JSON.stringify(brand.screenshotAnalysis)}
=== SECTION PATTERNS ===
${JSON.stringify(brand.sectionPatterns)}
=== FORBIDDEN GENERIC PHRASES (never write these) ===
${JSON.stringify(brand.forbiddenPhrases)}
`
    : ""
}
=== DESIGN SYSTEM CSS (include verbatim inside <style>) ===
${css}

=== TOKEN REFERENCE ===
colors: ${JSON.stringify(system.tokens.colors)}
fonts: ${JSON.stringify(system.tokens.fonts)}
containers: ${JSON.stringify(system.tokens.containers)}
${refine}

Produce the complete HTML file now. Every section must reproduce its detected layout's structure and column count.`;

  try {
    const text = await complete(prompt, {
      system: SYSTEM,
      maxTokens: 16000,
      temperature: 0.4,
    });
    const html = extractHtml(text);
    if (html && html.length > 400 && /<\/html>/i.test(html)) return html;
    return fallback;
  } catch {
    return fallback;
  }
}
