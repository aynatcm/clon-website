import sharp from "sharp";
import type { BrandContext } from "./schema";

export function isUsableAssetUrl(url: string | undefined): url is string {
  if (!url) return false;
  return /^https?:\/\//.test(url) || /^data:image\//.test(url) || url.startsWith("/");
}

export async function withEmbeddedScreenshotAssets(
  brand: BrandContext | undefined,
  loadScreenshot: (key: string) => Promise<Buffer>,
  opts: { max?: number; width?: number; height?: number } = {},
): Promise<BrandContext | undefined> {
  if (!brand?.screenshots.length) return brand;

  const max = opts.max ?? 8;
  const width = opts.width ?? 1200;
  const height = opts.height ?? 720;
  const preferred = [
    ...brand.screenshots.filter((s) => s.kind === "SECTION"),
    ...brand.screenshots.filter((s) => s.kind === "DESKTOP"),
    ...brand.screenshots.filter((s) => s.kind === "TABLET"),
  ].slice(0, max);

  const embedded = [];
  for (const shot of preferred) {
    try {
      const source = await loadScreenshot(shot.key);
      const bytes = await sharp(source)
        .resize({ width, height, fit: "cover", position: "top" })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      embedded.push({
        url: `data:image/jpeg;base64,${bytes.toString("base64")}`,
        type: "screenshot",
        alt: shot.label || shot.kind.toLowerCase(),
        width,
        height,
        role: shot.kind === "SECTION" ? "product-shot" : "dashboard",
        page: "embedded-crawl-screenshot",
      });
    } catch {
      /* generation must continue when an optional screenshot is unavailable */
    }
  }

  return embedded.length ? { ...brand, assets: [...embedded, ...brand.assets] } : brand;
}
