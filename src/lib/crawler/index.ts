import { chromium, type Browser, type Page } from "playwright";
import { extractInPage, type InPageResult } from "./pageScript";
import {
  VIEWPORTS,
  TARGET_PAGE_HINTS,
  type CrawlBundle,
  type CrawlOptions,
  type CrawledPage,
  type CrawlScreenshot,
  type PageExtract,
  type Viewport,
} from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 DesignDNABot/1.0";

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

async function autoScroll(page: Page): Promise<void> {
  // Trigger lazy-loaded content + ensure full-page metrics are accurate.
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let total = 0;
      const step = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= document.body.scrollHeight - window.innerHeight || total > 20000) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 60);
    });
  });
  await page.waitForTimeout(300);
}

/** Discover internal links worth crawling, ranked by target-page hints. */
async function discoverLinks(page: Page, startUrl: string): Promise<string[]> {
  const hrefs: string[] = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter(Boolean),
  );
  const seen = new Set<string>();
  const ranked: { url: string; score: number }[] = [];
  for (const raw of hrefs) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    u.hash = "";
    const clean = u.toString();
    if (!sameHost(clean, startUrl)) continue;
    if (clean === startUrl) continue;
    if (seen.has(clean)) continue;
    if (/\.(pdf|zip|png|jpg|jpeg|svg|webp|mp4|gif)$/i.test(u.pathname)) continue;
    seen.add(clean);
    const path = u.pathname.toLowerCase();
    const hintIdx = TARGET_PAGE_HINTS.findIndex((h) => path.includes(h));
    const score = hintIdx >= 0 ? 100 - hintIdx : 0;
    ranked.push({ url: clean, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map((r) => r.url);
}

function toPageExtract(
  url: string,
  base: InPageResult,
  responsive: PageExtract["responsive"],
  rawHtml: string,
): PageExtract {
  return {
    url,
    title: base.title,
    cssVariables: base.cssVariables,
    fonts: base.fontCounts,
    colors: base.colorCounts,
    styleSamples: base.styleSamples as PageExtract["styleSamples"],
    layout: base.layout,
    blocks: base.blocks,
    colorSignals: base.colorSignals,
    wpColors: base.wpColors,
    sectionFingerprints: base.sectionFingerprints,
    components: base.components,
    responsive,
    stylesheetHrefs: base.stylesheetHrefs,
    inlineStyles: base.inlineStyles,
    rawHtml,
  };
}

async function capture(
  page: Page,
  opts: CrawlOptions,
  kind: CrawlScreenshot["kind"],
  label: string,
  url: string,
  selector?: string,
): Promise<CrawlScreenshot | null> {
  try {
    let buf: Buffer;
    let width = 0;
    let height = 0;
    if (selector) {
      const el = await page.$(selector);
      if (!el) return null;
      const box = await el.boundingBox();
      if (!box || box.height < 20) return null;
      buf = await el.screenshot({ type: "png" });
      width = Math.round(box.width);
      height = Math.round(box.height);
    } else {
      buf = await page.screenshot({ type: "png", fullPage: kind === "DESKTOP" });
      const vp = page.viewportSize();
      width = vp?.width ?? 0;
      height = vp?.height ?? 0;
    }
    const storageKey = await opts.saveScreenshot(buf, { kind, label, pageUrl: url });
    return { storageKey, kind, width, height, label, pageUrl: url };
  } catch {
    return null;
  }
}

async function crawlOne(
  browser: Browser,
  url: string,
  opts: CrawlOptions,
): Promise<CrawledPage | null> {
  const timeout = opts.timeoutMs ?? 30_000;
  const log = opts.log ?? (() => {});
  const context = await browser.newContext({ userAgent: UA, viewport: VIEWPORTS[0] });
  // tsx/esbuild wraps named functions with a __name() helper; when we serialize
  // extractInPage into the page it must exist there too. Polyfill as identity.
  await context.addInitScript(() => {
    const g = globalThis as unknown as { __name?: (f: unknown) => unknown };
    if (!g.__name) g.__name = (f) => f;
  });
  const page = await context.newPage();
  try {
    log(`visiting ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    await page.waitForTimeout(800);
    await autoScroll(page);

    const base = await page.evaluate(extractInPage);
    const rawHtml = (await page.content()).slice(0, 400_000);

    // Per-viewport responsive signal.
    const responsive = {} as PageExtract["responsive"];
    const screenshots: CrawlScreenshot[] = [];
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(400);
      const sig = await page.evaluate(() => {
        const cols = Array.from(document.querySelectorAll("*"))
          .slice(0, 800)
          .map((el) => getComputedStyle(el).gridTemplateColumns)
          .filter((c) => c && c !== "none")
          .map((c) => c.split(" ").length);
        return {
          documentWidth: document.documentElement.scrollWidth,
          columns: Array.from(new Set(cols)).slice(0, 8),
        };
      });
      responsive[vp.name as Viewport] = sig;
      const kind = vp.name.toUpperCase() as CrawlScreenshot["kind"];
      const shot = await capture(page, opts, kind, `${vp.name} viewport`, url);
      if (shot) screenshots.push(shot);
    }

    // Reset to desktop for component captures.
    await page.setViewportSize(VIEWPORTS[0]);
    await page.waitForTimeout(300);
    const navShot = await capture(page, opts, "NAVIGATION", "navigation", url, "nav, header");
    if (navShot) screenshots.push(navShot);
    const footShot = await capture(page, opts, "FOOTER", "footer", url, "footer");
    if (footShot) screenshots.push(footShot);

    // Up to 4 representative section captures.
    const sectionSelectors = await page.evaluate(() => {
      const out: string[] = [];
      const secs = Array.from(document.querySelectorAll("section, main > div")).slice(0, 8);
      secs.forEach((s, i) => {
        const r = (s as HTMLElement).getBoundingClientRect();
        if (r.height > 200) {
          if (!s.id) s.id = `__dna_sec_${i}`;
          out.push(`#${s.id}`);
        }
      });
      return out.slice(0, 4);
    });
    for (let i = 0; i < sectionSelectors.length; i++) {
      const shot = await capture(page, opts, "SECTION", `section ${i + 1}`, url, sectionSelectors[i]);
      if (shot) screenshots.push(shot);
    }

    return { url, extract: toPageExtract(url, base, responsive, rawHtml), screenshots };
  } catch (err) {
    log(`failed ${url}: ${(err as Error).message}`);
    return null;
  } finally {
    await context.close();
  }
}

/**
 * Phase 3 entry point. Crawls the homepage, discovers key pages, and captures
 * screenshots + computed-style extracts across desktop/tablet/mobile.
 */
export async function crawl(startUrl: string, opts: CrawlOptions): Promise<CrawlBundle> {
  const maxPages = opts.maxPages ?? 8;
  const log = opts.log ?? (() => {});
  const errors: string[] = [];
  const pages: CrawledPage[] = [];

  let normalized = startUrl;
  if (!/^https?:\/\//.test(normalized)) normalized = `https://${normalized}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const home = await crawlOne(browser, normalized, opts);
    let discovered: string[] = [];
    if (home) {
      pages.push(home);
      // Re-open homepage just to read links (cheap) — reuse extract blocks instead.
      const ctx = await browser.newContext({ userAgent: UA });
      await ctx.addInitScript(() => {
        const g = globalThis as unknown as { __name?: (f: unknown) => unknown };
        if (!g.__name) g.__name = (f) => f;
      });
      const p = await ctx.newPage();
      try {
        await p.goto(normalized, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs ?? 30000 });
        discovered = await discoverLinks(p, normalized);
      } catch {
        /* ignore */
      } finally {
        await ctx.close();
      }
    } else {
      errors.push(`could not load homepage ${normalized}`);
    }

    const toVisit = discovered.slice(0, Math.max(0, maxPages - 1));
    for (const url of toVisit) {
      const result = await crawlOne(browser, url, opts);
      if (result) pages.push(result);
      else errors.push(`skipped ${url}`);
    }

    log(`crawl complete: ${pages.length} pages, ${pages.reduce((n, p) => n + p.screenshots.length, 0)} screenshots`);
    return { startUrl: normalized, pages, discoveredUrls: discovered, errors };
  } finally {
    await browser.close();
  }
}
