/**
 * Phase 5 validation: `npm run extract`
 * Loads .crawl-out/bundle.json, runs the extraction engine + deterministic DNA
 * (no API keys needed), writes .crawl-out/design-dna.json.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { extract } from "../src/lib/extraction";
import { buildDeterministicDna } from "../src/lib/dna/deterministic";
import { buildDesignSystem } from "../src/lib/designsystem";
import { buildBrandContext } from "../src/lib/brand";
import { buildRecipeBook } from "../src/lib/recipe";
import type { CrawlBundle } from "../src/lib/crawler/types";

async function main() {
  const outDir = path.join(process.cwd(), ".crawl-out");
  const bundle = JSON.parse(
    await fs.readFile(path.join(outDir, "bundle.json"), "utf8"),
  ) as CrawlBundle;

  const { evidence, brandNotes } = await extract({
    bundle,
    fetchStylesheets: true,
    log: (m) => console.log(`[extract] ${m}`),
  });
  void brandNotes;

  const dna = buildDeterministicDna(evidence);
  await fs.writeFile(path.join(outDir, "design-dna.json"), JSON.stringify(dna, null, 2));

  console.log("\n=== Design DNA (deterministic) ===");
  console.log("philosophy:", dna.designPhilosophy.summary);
  console.log("mode:", dna.colors.mode);
  console.log("\n--- COLOR DECISIONS (importance + evidence) ---");
  for (const [role, d] of Object.entries(dna.colors.decisions)) {
    if (d) console.log(`  ${role}: ${d.value}  ← ${d.evidence.join(", ")}  (conf ${d.confidence.toFixed(2)})`);
  }
  console.log("  ignored (wp/neutral):", dna.colors.ignored.join(", ") || "none");
  console.log("\n--- TYPOGRAPHY ---");
  console.log("fonts:", dna.typography.fonts.map((f) => `${f.family}(${f.role})`).join(", "));
  console.log("h1:", dna.typography.scale[0].fontSize, "/", dna.typography.scale[0].fontWeight);
  console.log("\n--- SECTIONS (advanced taxonomy) ---");
  console.log(dna.sections.map((s) => `${s.type}×${s.frequency}[${s.fingerprint?.columns}col]`).join(", "));
  console.log("\n--- COMPONENT VARIANTS ---");
  for (const c of dna.components) {
    console.log(`  ${c.type}: ${c.variants.length} variants`);
    for (const v of c.variants.slice(0, 3))
      console.log(`     r=${v.radius} h=${v.height ?? "-"} w=${v.fontWeight ?? "-"} bg=${v.background ?? "-"} ×${v.usageCount}`);
  }
  console.log("\n--- BRAND PERSONALITY ---");
  console.log(JSON.stringify(dna.brandPersonality));
  console.log("visualAnalysis source:", dna.visualAnalysis.source, "| density:", dna.visualAnalysis.layoutDensity, "| premium:", dna.visualAnalysis.premiumLevel);
  console.log("\n--- CONFIDENCE REPORT ---");
  console.log("grounded:", dna.confidenceReport.groundedData.length, "inferred:", dna.confidenceReport.inferredData.length);
  console.log("visualConf:", dna.confidenceReport.visualConfidence, "structuralConf:", dna.confidenceReport.structuralConfidence, "overall:", dna.confidenceReport.overallConfidence);
  console.log("layout containers:", dna.layout.containers.slice(0, 4), "cols:", dna.layout.columns);
  console.log("cornerStyle:", dna.visualRules.cornerStyle, "shadow:", dna.visualRules.shadowStyle);

  const { system, css } = buildDesignSystem(dna);
  await fs.writeFile(path.join(outDir, "design-system.css"), css);
  console.log("\n=== Design System ===");
  console.log("color tokens:", Object.keys(system.tokens.colors).join(", "));
  console.log("font tokens:", system.tokens.fonts);
  console.log("components:", system.components.map((c) => c.className).join(", "));
  console.log("layouts:", system.layouts.map((l) => l.type).join(", "));
  console.log("css bytes:", css.length);

  const brand = await buildBrandContext(evidence, dna);
  await fs.writeFile(path.join(outDir, "brand-context.json"), JSON.stringify(brand, null, 2));
  console.log("\n=== Brand Context (Phase 6.5) ===");
  console.log("assets:", brand.assets.length, "(roles:", Array.from(new Set(brand.assets.map((a) => a.role))).join(", ") + ")");
  console.log("copy items:", brand.copyLibrary.length, "| headlines:", brand.headlines.length, "| features:", brand.features.length);
  console.log("voice:", brand.brandVoice.tone, "| sentence:", brand.brandVoice.sentenceLength, "| tech:", brand.brandVoice.technicalDepth, "| conversion:", brand.brandVoice.conversionStyle);
  console.log("vocabulary:", brand.brandVoice.vocabulary.slice(0, 8).join(", "));
  console.log("cta patterns:", brand.ctaPatterns.slice(0, 6).join(", "));
  console.log("imagery:", brand.screenshotAnalysis.imageryStyle, "| product presentation:", brand.screenshotAnalysis.productPresentationStyle);

  // Phase 7.5 — Section Recipes + Content DNA, merged into the design system.
  const book = buildRecipeBook(evidence, dna, brand);
  system.recipes = book.recipes;
  system.contentPattern = book.contentPattern;
  await fs.writeFile(path.join(outDir, "design-system.json"), JSON.stringify(system, null, 2));
  await fs.writeFile(path.join(outDir, "recipe-book.json"), JSON.stringify(book, null, 2));
  console.log("\n=== Section Recipes (Phase 7.5) ===");
  for (const r of book.recipes)
    console.log(`  ${r.type} [${r.variant}] cols=${r.columns} media=${r.mediaPlacement} cta=${r.ctaCount}${r.card ? ` cards=${r.card.count}(${r.card.slots.join("/")})` : ""} slots=[${r.slots.map((s) => s.kind).join(",")}]`);
  console.log("contentPattern headline:", JSON.stringify(book.contentPattern.headline), "| cta verbLed:", book.contentPattern.cta.verbLed);
  console.log(`\nWrote design-dna.json, design-system.json, design-system.css, brand-context.json, recipe-book.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
