import type { BrandContext } from "@/lib/brand/schema";
import type { DesignSystem } from "@/lib/designsystem/schema";

const ASSET_PRIORITY: Record<string, number> = {
  dashboard: 100,
  "product-shot": 96,
  "hero-image": 92,
  "feature-image": 82,
  illustration: 76,
  logo: 72,
  icon: 55,
  "team-photo": 48,
  "testimonial-avatar": 42,
  "background-graphic": 36,
};

function isUsableAssetUrl(url: string) {
  return /^https?:\/\//i.test(url) || url.startsWith("/") || url.startsWith("data:image/");
}

export function brandAssetPayload(brand?: BrandContext, max = 36) {
  if (!brand) return [];
  return brand.assets
    .filter((a) => isUsableAssetUrl(a.url))
    .map((a) => ({
      url: a.url,
      role: a.role,
      type: a.type,
      alt: a.alt,
      dimensions: `${a.width || 0}x${a.height || 0}`,
      page: a.page,
      priority: (ASSET_PRIORITY[a.role] ?? 20) + Math.min(20, Math.round((a.width * a.height) / 200_000)),
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, max)
    .map(({ priority: _priority, ...a }) => a);
}

export function brandVariablePayload(brand: BrandContext | undefined, system?: DesignSystem, max = 80) {
  const vars = new Map<string, string>();
  for (const v of brand?.rawVariables ?? []) vars.set(v.name, v.value);
  for (const [name, value] of Object.entries(brand?.cssVariables ?? {})) {
    if (vars.size >= max) break;
    if (!vars.has(name)) vars.set(name, value);
  }
  for (const [name, value] of Object.entries(system?.tokens.colors ?? {})) vars.set(`--token-color-${name}`, value);
  for (const [name, value] of Object.entries(system?.tokens.spacing ?? {})) vars.set(`--token-space-${name}`, value);
  for (const [name, value] of Object.entries(system?.tokens.radii ?? {})) vars.set(`--token-radius-${name}`, value);
  return Array.from(vars.entries())
    .slice(0, max)
    .map(([name, value]) => ({ name, value }));
}

export function requiredAssetUrlsBySection(brand?: BrandContext) {
  const assets = brandAssetPayload(brand, 40);
  const byRole = (roles: string[]) => assets.find((a) => roles.includes(a.role))?.url;
  return {
    hero: byRole(["dashboard", "product-shot", "hero-image", "illustration"]),
    media: byRole(["dashboard", "product-shot", "feature-image", "illustration", "hero-image"]),
    logo: byRole(["logo"]),
    icon: byRole(["icon"]),
  };
}

export function generationContextBlock(brand: BrandContext | undefined, system?: DesignSystem) {
  if (!brand) return "";
  return `=== MANDATORY ASSET LIBRARY (CRAWLED REAL MEDIA) ===
Use these exact URLs when rendering media. Prefer dashboard/product-shot/hero-image for split heroes and feature media. Prefer logo assets for logo-cloud sections. Do not invent external image URLs.
${JSON.stringify(brandAssetPayload(brand), null, 2)}

=== REQUIRED ASSET URL HINTS BY SECTION ROLE ===
${JSON.stringify(requiredAssetUrlsBySection(brand), null, 2)}

=== ORIGINAL CSS VARIABLES / RAW SOURCE TOKENS ===
These are CSS variables and token-like values crawled from the original site. Use them as the source styling vocabulary when adding page-specific CSS.
${JSON.stringify(brandVariablePayload(brand, system), null, 2)}
`;
}
