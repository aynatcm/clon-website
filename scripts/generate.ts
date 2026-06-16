/**
 * Phases 8-11 validation: `npx tsx scripts/generate.ts [pageType] [sections]`
 * Loads .crawl-out/design-dna.json, builds the design system, generates a page
 * (deterministic without a key), scores similarity, writes the HTML.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildDesignSystem } from "../src/lib/designsystem";
import { DesignSystemSchema } from "../src/lib/designsystem/schema";
import { generatePage } from "../src/lib/generation";
import { DesignDnaSchema } from "../src/lib/dna/schema";
import { BrandContextSchema } from "../src/lib/brand/schema";
import { withEmbeddedScreenshotAssets } from "../src/lib/brand/assets";

async function main() {
  const rawPageType = process.argv[2] ?? "about";
  const pageType = normalizePageType(rawPageType);
  const sections = process.argv
    .slice(3)
    .join(",")
    .split(",")
    .map((s) => normalizeSection(s))
    .filter(Boolean);
  const outDir = path.join(process.cwd(), ".crawl-out");

  const dna = DesignDnaSchema.parse(
    JSON.parse(await fs.readFile(path.join(outDir, "design-dna.json"), "utf8")),
  );
  // Prefer the persisted design system (carries Section Recipes); rebuild if absent.
  const built = buildDesignSystem(dna);
  let css = built.css;
  let system = built.system;
  try {
    system = DesignSystemSchema.parse(JSON.parse(await fs.readFile(path.join(outDir, "design-system.json"), "utf8")));
    css = await fs.readFile(path.join(outDir, "design-system.css"), "utf8");
  } catch {
    /* use freshly built system (no recipes) */
  }

  let brand;
  try {
    brand = BrandContextSchema.parse(JSON.parse(await fs.readFile(path.join(outDir, "brand-context.json"), "utf8")));
  } catch {
    brand = undefined;
  }
  brand = await withEmbeddedScreenshotAssets(brand, (key) => fs.readFile(path.join(outDir, "screenshots", key)), { max: 10 });
  console.log(
    `[ctx] recipes=${system.recipes?.length ?? 0} layouts=${system.layouts.length} assets=${brand?.assets.length ?? 0} rawVars=${brand?.rawVariables.length ?? 0}`,
  );

  const result = await generatePage(
    {
      pageType,
      sections,
      brief: "",
      title: brand?.products[0],
      audience: "product teams",
    },
    dna,
    system,
    css,
    { log: (m) => console.log(`[gen] ${m}`), brand },
  );

  const file = path.join(outDir, `page-${pageType}.html`);
  await fs.writeFile(file, result.html);
  const rawFile = path.join(outDir, `page-${rawPageType}.html`);
  if (rawFile !== file) await fs.writeFile(rawFile, result.html);

  console.log("\n=== Generation result ===");
  console.log("page title:", result.architecture.pageTitle);
  console.log("sections:", result.architecture.sections.map((s) => `${s.type}<-${s.sourcePattern}`).join(", "));
  console.log("iterations:", result.iterations);
  console.log("similarity:", JSON.stringify(result.similarity, null, 2));
  console.log("html bytes:", result.html.length);
  console.log(`\nWrote ${file}`);
  if (rawFile !== file) console.log(`Wrote ${rawFile} (alias for normalized page type "${pageType}")`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

function normalizePageType(input: string): string {
  const key = input.trim().toLowerCase();
  const aliases: Record<string, string> = {
    carrer: "careers",
    carrers: "careers",
    career: "careers",
    careers: "careers",
  };
  return aliases[key] ?? key;
}

function normalizeSection(input: string): string {
  const key = input.trim().toLowerCase();
  const aliases: Record<string, string> = {
    faqs: "faq",
    questions: "faq",
    grid: "feature-grid",
    cards: "feature-grid",
    form: "contact-section",
  };
  return aliases[key] ?? key;
}
