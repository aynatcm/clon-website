/**
 * Phases 8-11 validation: `npx tsx scripts/generate.ts [pageType] [sections]`
 * Loads .crawl-out/design-dna.json, builds the design system, generates a page
 * (deterministic without a key), scores similarity, writes the HTML.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildDesignSystem } from "../src/lib/designsystem";
import { generatePage } from "../src/lib/generation";
import { DesignDnaSchema } from "../src/lib/dna/schema";

async function main() {
  const pageType = process.argv[2] ?? "about";
  const sections = (process.argv[3] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const outDir = path.join(process.cwd(), ".crawl-out");

  const dna = DesignDnaSchema.parse(
    JSON.parse(await fs.readFile(path.join(outDir, "design-dna.json"), "utf8")),
  );
  const { system, css } = buildDesignSystem(dna);

  const result = await generatePage(
    {
      pageType,
      sections,
      brief: "Build the future of software. We help teams move faster with focused tools.",
      title: "Acme",
      audience: "product teams",
    },
    dna,
    system,
    css,
    { log: (m) => console.log(`[gen] ${m}`) },
  );

  const file = path.join(outDir, `page-${pageType}.html`);
  await fs.writeFile(file, result.html);

  console.log("\n=== Generation result ===");
  console.log("page title:", result.architecture.pageTitle);
  console.log("sections:", result.architecture.sections.map((s) => `${s.type}<-${s.sourcePattern}`).join(", "));
  console.log("iterations:", result.iterations);
  console.log("similarity:", JSON.stringify(result.similarity, null, 2));
  console.log("html bytes:", result.html.length);
  console.log(`\nWrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
