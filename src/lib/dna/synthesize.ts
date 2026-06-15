import type { Evidence } from "@/lib/extraction/evidence";
import { structured, type ImageInput, aiFeatures } from "@/lib/ai/claude";
import { getObjectBuffer } from "@/lib/storage/r2";
import { DesignDnaSchema, type DesignDna } from "./schema";
import { buildDeterministicDna } from "./deterministic";
import { analyzeVisualBrand } from "./visual";

/**
 * Phase 5/7 — Design DNA synthesis. Order of authority (problem 4):
 *   1. Visual Brand Analysis (screenshots)  ← runs first, OUTRANKS CSS
 *   2. Importance-weighted color evidence
 *   3. Structural fingerprints (sections / components)
 * Claude refines semantics on top of the grounded deterministic seed. Falls
 * back to the seed when AI is unavailable.
 */

async function loadVisionImages(ev: Evidence, max = 6): Promise<ImageInput[]> {
  const priority = ["DESKTOP", "MOBILE", "NAVIGATION", "FOOTER", "SECTION", "TABLET"];
  const picked: typeof ev.screenshots = [];
  for (const kind of priority) {
    const s = ev.screenshots.find((x) => x.kind === kind && !picked.includes(x));
    if (s) picked.push(s);
    if (picked.length >= max) break;
  }
  for (const s of ev.screenshots) {
    if (picked.length >= max) break;
    if (!picked.includes(s)) picked.push(s);
  }
  const out: ImageInput[] = [];
  for (const s of picked) {
    try {
      const buf = await getObjectBuffer(s.key);
      if (buf.length > 4_500_000) continue;
      out.push({ base64: buf.toString("base64"), mediaType: "image/png" });
    } catch {
      /* skip */
    }
  }
  return out;
}

function evidenceDigest(ev: Evidence) {
  return {
    startUrl: ev.startUrl,
    pageTitles: ev.titles,
    colorRoles: ev.colorRoles, // importance-based decisions + evidence + ignored
    fonts: ev.fonts,
    typeSamples: {
      h1: ev.styleByRole["h1"],
      h2: ev.styleByRole["h2"],
      h3: ev.styleByRole["h3"],
      body: ev.styleByRole["p"],
      button: ev.styleByRole["button"],
    },
    spacing: ev.spacing,
    radii: ev.radii,
    shadows: ev.shadows,
    containers: ev.containers,
    grids: ev.grids,
    responsive: ev.responsive,
    sections: ev.sections.map((s) => ({ type: s.type, frequency: s.frequency, fingerprint: s.fingerprint, evidence: s.evidence })),
    components: ev.components,
  };
}

const SYSTEM = `You are a Visual Reverse-Engineering Specialist and Design System Architect.
You extract the Design DNA of an existing product so new pages can EXTEND its design language.
Authority order (STRICT):
1. The Visual Brand Analysis (from screenshots) is authoritative. If CSS numbers disagree with what the screenshots show, TRUST THE SCREENSHOTS.
2. Brand colors come from VISUAL IMPORTANCE (CTA/nav/hero/links) — never from raw frequency. Never promote white backgrounds or WordPress/Gutenberg editor colors to brand colors.
3. Keep numeric tokens (sizes, spacing, containers, radii) consistent with the evidence.
Every color decision must carry an evidence trail. Prioritize visual continuity over creativity.
Output ONLY JSON matching the schema (full DNA, not a diff). No prose.`;

export interface SynthesisInput {
  evidence: Evidence;
  extraNotes?: string;
}

export async function synthesizeDna(input: SynthesisInput): Promise<DesignDna> {
  // Phase 4.5 — visual analysis FIRST (vision-first authority).
  const visual = await analyzeVisualBrand(input.evidence);
  const seed = buildDeterministicDna(input.evidence, visual);

  if (!aiFeatures.ai) return seed;

  const images = await loadVisionImages(input.evidence);
  const digest = evidenceDigest(input.evidence);

  const prompt = `Produce the COMPLETE Design DNA for this product.

A grounded DETERMINISTIC SEED (already valid) is provided — refine it without contradicting the evidence:
- Keep the importance-based color decisions and their evidence trails. Re-label tokens semantically if needed but do not invent unseen colors.
- Use the Visual Brand Analysis as the authority for philosophy axes, brandPersonality, whitespace, density, hierarchy, alignment, CTA prominence.
- Describe each component's variants and each section's structure precisely (use the fingerprints).
- Fill the confidenceReport: list groundedData vs inferredData and explain WHY each major decision was made.

=== VISUAL BRAND ANALYSIS (authoritative, source: ${visual.source}) ===
${JSON.stringify(visual)}

=== DETERMINISTIC SEED ===
${JSON.stringify(seed)}

=== STRUCTURAL EVIDENCE ===
${JSON.stringify(digest)}
${input.extraNotes ? `\n=== USER BRAND NOTES ===\n${input.extraNotes.slice(0, 4000)}` : ""}`;

  try {
    const dna = await structured(DesignDnaSchema, prompt, {
      system: SYSTEM,
      images,
      maxTokens: 14000,
      temperature: 0.2,
    });
    // Preserve grounded artifacts the model might drop.
    if (!dna.screenshots?.length) dna.screenshots = seed.screenshots;
    if (!dna.colors.decisions?.primary && seed.colors.decisions.primary) dna.colors.decisions = seed.colors.decisions;
    if (!dna.visualAnalysis) dna.visualAnalysis = visual;
    if (!dna.provenance.sources.includes("vision") && visual.source === "vision") dna.provenance.sources.push("vision");
    if (!dna.provenance.sources.includes("playwright")) dna.provenance.sources.push("playwright");
    return dna;
  } catch {
    return { ...seed, provenance: { ...seed.provenance, notes: "AI synthesis failed; deterministic+visual fallback." } };
  }
}
