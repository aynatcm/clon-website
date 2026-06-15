/**
 * Standalone crawler test: `npm run crawl -- <url> [maxPages]`
 * Saves screenshots + bundle to .crawl-out/ for inspection. No DB / keys needed.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { crawl } from "../src/lib/crawler";

async function main() {
  const url = process.argv[2] ?? "https://example.com";
  const maxPages = Number(process.argv[3] ?? 3);
  const outDir = path.join(process.cwd(), ".crawl-out");
  const shotDir = path.join(outDir, "screenshots");
  await fs.mkdir(shotDir, { recursive: true });

  let n = 0;
  const bundle = await crawl(url, {
    maxPages,
    timeoutMs: 30_000,
    log: (m) => console.log(`[crawl] ${m}`),
    saveScreenshot: async (buf, meta) => {
      const key = `${String(n++).padStart(3, "0")}-${meta.kind}-${meta.label.replace(/\W+/g, "_")}.png`;
      await fs.writeFile(path.join(shotDir, key), buf);
      return key;
    },
  });

  await fs.writeFile(
    path.join(outDir, "bundle.json"),
    JSON.stringify(
      bundle,
      (k, v) => (k === "rawHtml" ? `[${(v as string)?.length ?? 0} bytes]` : v),
      2,
    ),
  );

  console.log(`\nPages: ${bundle.pages.length}`);
  for (const p of bundle.pages) {
    console.log(
      `  ${p.url}\n    fonts=${p.extract.fonts.length} colors=${p.extract.colors.length} blocks=${p.extract.blocks.length} cssVars=${Object.keys(p.extract.cssVariables).length} shots=${p.screenshots.length}`,
    );
  }
  console.log(`\nWrote ${outDir}/bundle.json and ${n} screenshots.`);
  if (bundle.errors.length) console.log("Errors:", bundle.errors);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
