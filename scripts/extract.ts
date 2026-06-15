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
  await fs.writeFile(path.join(outDir, "design-system.json"), JSON.stringify(system, null, 2));
  await fs.writeFile(path.join(outDir, "design-system.css"), css);
  console.log("\n=== Design System ===");
  console.log("color tokens:", Object.keys(system.tokens.colors).join(", "));
  console.log("font tokens:", system.tokens.fonts);
  console.log("components:", system.components.map((c) => c.className).join(", "));
  console.log("layouts:", system.layouts.map((l) => l.type).join(", "));
  console.log("css bytes:", css.length);
  console.log(`\nWrote design-dna.json, design-system.json, design-system.css`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
