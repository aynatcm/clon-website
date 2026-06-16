import type { DesignDna } from "@/lib/dna/schema";
import type { DesignSystem } from "@/lib/designsystem/schema";
import type { BrandContext } from "@/lib/brand/schema";
import { isUsableAssetUrl } from "@/lib/brand/assets";
import { esc } from "./render";
import { renderRecipeSection } from "@/lib/recipe/render";
import { fillSlots, type FillRequest } from "@/lib/recipe/slots";
import type { SectionRecipe } from "@/lib/recipe/schema";
import { PageArchitectureSchema, type GenerationRequest, type PageArchitecture } from "./schema";

/**
 * Phase 7.5 generation = RECIPE INSTANTIATION. Requested sections map to
 * detected recipes; slots are filled (content only); recipes render their own
 * fixed structure. AI never emits layout/HTML here.
 */

const DEFAULT_SECTIONS: Record<string, string[]> = {
  landing: ["hero", "logo-cloud", "feature-grid", "stats", "testimonials", "cta", "footer"],
  about: ["hero", "content-block", "stats", "team-section", "cta", "footer"],
  pricing: ["hero", "pricing", "feature-grid", "testimonials", "cta", "footer"],
  services: ["hero", "features", "pricing", "cta"],
  careers: ["hero", "content-block", "stats", "feature-grid", "cta", "footer"],
  contact: ["hero", "contact-section", "footer"],
  custom: ["hero", "feature-grid", "cta", "footer"],
};

const ALIAS: Record<string, string[]> = {
  hero: ["hero", "split-hero", "content-block"],
  story: ["content-block", "split-hero"],
  services: ["service-grid", "feature-grid", "team-section", "stats", "pricing"],
  features: ["feature-grid", "service-grid", "split-hero", "stats", "team-section", "pricing"],
  grid: ["feature-grid", "service-grid", "split-hero"],
  team: ["team-section", "feature-grid"],
  benefits: ["stats", "team-section", "feature-grid"],
  pricing: ["pricing", "feature-comparison", "feature-grid"],
  stats: ["stats", "feature-grid"],
  form: ["contact-section"],
  faq: ["faq", "content-block"],
  faqs: ["faq", "content-block"],
  logos: ["logo-cloud", "feature-grid"],
  testimonials: ["testimonials", "feature-grid"],
  cta: ["footer-cta", "cta", "content-block", "split-hero", "contact-section"],
  contact: ["contact-section", "footer-cta", "cta"],
  footer: ["footer"],
};

const ASSET_ROLE_PREF: Record<string, string[]> = {
  hero: ["dashboard", "product-shot", "hero-image", "illustration"],
  "split-hero": ["dashboard", "product-shot", "hero-image", "illustration"],
  "content-block": ["product-shot", "illustration", "feature-image"],
  "feature-grid": ["feature-image", "illustration"],
};

function pickAssetUrl(type: string, brand: BrandContext | undefined, idx = 0): string | undefined {
  if (!brand) return undefined;
  for (const role of ASSET_ROLE_PREF[type] ?? ["product-shot", "illustration", "feature-image"]) {
    const matching = brand.assets.filter((x) => x.role === role && isUsableAssetUrl(x.url));
    const a = matching[idx % Math.max(1, matching.length)];
    if (a) return a.url;
  }
  const matching = brand.assets.filter((x) => isUsableAssetUrl(x.url) && x.role !== "logo");
  return matching[idx % Math.max(1, matching.length)]?.url;
}

/** Resolve each requested section to the CLOSEST detected recipe. */
export interface ResolvedRecipe {
  recipe: SectionRecipe;
  intent: string;
  reason: string;
}

function structuralFallback(intent: string, recipes: SectionRecipe[], used = new Set<string>()): SectionRecipe | undefined {
  const content = recipes.filter((r) => r.type !== "footer" && r.type !== "nav");
  const unused = content.filter((r) => !used.has(r.id));
  const pool = unused.length ? unused : content;
  if (/feature|service|benefit|capabilit/i.test(intent)) {
    return (
      pool.find((r) => r.variant === "split" && r.mediaPlacement !== "none") ??
      pool.find((r) => r.variant === "grid" && (r.card?.count ?? 0) >= 3) ??
      pool.find((r) => r.variant === "grid") ??
      pool.find((r) => r.variant === "split")
    );
  }
  if (/form|contact/i.test(intent)) return pool.find((r) => r.variant === "form") ?? pool.find((r) => r.type.includes("cta"));
  if (/cta/i.test(intent)) {
    return (
      pool.find((r) => r.type === "footer-cta" || r.type === "cta") ??
      pool.find((r) => r.ctaCount > 0 && r.variant !== "form") ??
      pool.find((r) => r.type === "content-block") ??
      pool.find((r) => r.variant === "form")
    );
  }
  if (/faq|question/i.test(intent)) return pool.find((r) => r.type === "content-block") ?? pool.find((r) => r.variant === "stacked");
  if (/benefit/i.test(intent)) return pool.find((r) => r.type === "stats") ?? pool.find((r) => r.variant === "grid");
  if (/logo|trust/i.test(intent)) return pool.find((r) => r.variant === "logos");
  return [...pool].sort((a, b) => b.frequency - a.frequency)[0];
}

function variantIndex(recipe: SectionRecipe): number {
  const n = Number(recipe.id.split("-").at(-1));
  return Number.isFinite(n) ? n : 0;
}

function chooseRecipeForIntent(intent: string, candidates: SectionRecipe[], used: Set<string>): SectionRecipe | undefined {
  if (!candidates.length) return undefined;
  const scored = candidates.map((recipe) => {
    let score = 0;
    const vIdx = variantIndex(recipe);
    const isUsed = used.has(recipe.id);
    if (!isUsed) score += 30;
    if (intent === "hero") {
      score += recipe.type === "hero" ? 100 : 0;
      score += recipe.type === "split-hero" ? 35 : 0;
      score += vIdx === 0 ? 50 : 0;
      score += recipe.variant === "media" ? 45 : 0;
      score += recipe.variant === "split" ? 35 : 0;
      score += recipe.mediaPlacement !== "none" ? 25 : 0;
      score += recipe.ctaCount > 0 ? 15 : 0;
    } else if (/feature|service/i.test(intent)) {
      score += recipe.variant === "grid" && (recipe.card?.count ?? 0) >= 3 ? 70 : 0;
      score += recipe.type === "feature-grid" || recipe.type === "service-grid" ? 45 : 0;
      score += recipe.variant === "split" && recipe.mediaPlacement !== "none" ? 30 : 0;
      score += recipe.type === "split-hero" && vIdx > 0 ? 10 : 0;
      score -= recipe.type === "split-hero" && vIdx === 0 ? 55 : 0;
    } else if (/benefit|story/i.test(intent)) {
      score += recipe.variant === "split" && recipe.mediaPlacement !== "none" ? 55 : 0;
      score += recipe.variant === "grid" && (recipe.card?.count ?? 0) >= 3 ? 35 : 0;
      score -= recipe.type === "split-hero" && vIdx === 0 ? 45 : 0;
    } else if (/cta/i.test(intent) && !/contact|form/i.test(intent)) {
      score += recipe.type === "footer-cta" || recipe.type === "cta" ? 90 : 0;
      score += recipe.variant === "centered" ? 80 : 0;
      score += recipe.ctaCount > 0 ? 45 : 0;
      score += recipe.type === "content-block" ? 30 : 0;
      score += recipe.variant === "form" ? -80 : 0;
      score += recipe.type === "contact-section" ? -60 : 0;
    } else if (/contact|form/i.test(intent)) {
      score += recipe.variant === "form" ? 85 : 0;
      score += recipe.type === "footer-cta" || recipe.type === "cta" ? 35 : 0;
      score += recipe.type === "contact-section" ? 65 : 0;
    } else if (/pricing/i.test(intent)) {
      score += recipe.type === "pricing" ? 90 : 0;
      score += recipe.variant === "grid" ? 25 : 0;
    } else if (/logo|trust/i.test(intent)) {
      score += recipe.variant === "logos" ? 90 : 0;
    }
    score += Math.min(20, recipe.frequency);
    if (isUsed) score -= 130;
    return { recipe, score };
  });
  return scored.sort((a, b) => b.score - a.score)[0]?.recipe;
}

export function resolveRecipes(request: GenerationRequest, system: DesignSystem): ResolvedRecipe[] {
  const byType = new Map<string, SectionRecipe[]>();
  for (const recipe of system.recipes) {
    const list = byType.get(recipe.type) ?? [];
    list.push(recipe);
    byType.set(recipe.type, list);
  }
  const wanted = request.sections.length ? request.sections : DEFAULT_SECTIONS[request.pageType] ?? DEFAULT_SECTIONS.custom;
  const out: ResolvedRecipe[] = [];
  const used = new Set<string>();
  for (const w of wanted) {
    const prefs = ALIAS[w] ?? [w];
    const candidates = prefs.flatMap((pref) => byType.get(pref) ?? []);
    let chosen = chooseRecipeForIntent(w, candidates, used);
    let reason = chosen ? `exact/alias:${chosen.type}` : "";
    if (!chosen) {
      chosen = structuralFallback(w, system.recipes, used);
      reason = chosen ? `structural:${chosen.type}` : "none";
    }
    if (chosen) {
      used.add(chosen.id);
      out.push({ recipe: chosen, intent: w, reason });
    }
  }
  return out;
}

export interface RecipePage {
  html: string;
  architecture: PageArchitecture;
}

export async function generateRecipePage(
  request: GenerationRequest,
  dna: DesignDna,
  system: DesignSystem,
  css: string,
  brand: BrandContext | undefined,
  log: (m: string) => void = () => {},
): Promise<RecipePage> {
  const resolved = resolveRecipes(request, system);
  const recipes = resolved.map((r) => r.recipe);
  const cp = system.contentPattern;
  const fillReq: FillRequest = { pageType: request.pageType, title: request.title, brief: request.brief, audience: request.audience };

  log(`instantiating ${recipes.length} recipes: ${recipes.map((r) => `${r.type}(${r.variant})`).join(", ")}`);

  const archSections: PageArchitecture["sections"] = [];
  const bodies: string[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const { recipe, intent, reason } = resolved[i];
    const values = await fillSlots(recipe, brand, cp, { ...fillReq, sectionIntent: intent }, i);
    const needsMedia = recipe.mediaPlacement !== "none" || recipe.variant === "split" || recipe.variant === "media";
    const assetUrl = needsMedia ? pickAssetUrl(recipe.type, brand, i) : undefined;
    bodies.push(renderRecipeSection(recipe, values, system, brand, i, assetUrl));
    const headingId = recipe.slots.find((s) => s.kind === "heading")?.id;
    const headingVal = headingId && typeof values[headingId] === "string" ? (values[headingId] as string) : undefined;
    archSections.push({
      type: recipe.type,
      sourcePattern: `recipe:${recipe.id}; intent:${intent}; match:${reason} (${recipe.evidence.join(", ") || "detected"})`,
      heading: headingVal,
      contentSlots: {},
      layout: recipe.variant,
      visualAsset: needsMedia ? recipe.type : undefined,
      visualAssetUrl: assetUrl,
      componentPattern: brand?.ctaPatterns[0],
      copyPattern: brand?.brandVoice.conversionStyle,
      sectionPattern: `${intent}->${recipe.type}×${recipe.frequency}`,
    });
  }

  const architecture = PageArchitectureSchema.parse({
    pageTitle: request.title ?? brand?.products[0] ?? `${request.pageType} page`,
    metaDescription: (request.brief || `${request.pageType} page`).slice(0, 155),
    sections: archSections,
    rationale: "Each section instantiates a detected Section Recipe; AI filled content slots only.",
  });

  const html = wrapDocument(architecture.pageTitle, architecture.metaDescription, css, dna, bodies.join("\n"), brand);
  return { html, architecture };
}

function brandHeader(brand: BrandContext | undefined) {
  const product = brand?.products[0] ?? "Product";
  const navAll = (brand?.navigationPatterns ?? []).filter((n) => !/log in|sign up|open app/i.test(n));
  const nav = navAll.slice(0, 6);
  const cta =
    (brand?.ctaPatterns ?? []).find((c) => /[a-záéíóúñ]/i.test(c) && !c.endsWith("-cta") && !/open app|get started|learn more/i.test(c)) ??
    navAll.find((n) => /\b(contacto|contact)\b/i.test(n)) ??
    navAll.find((n) => /\b(servicios|services|proyectos|projects|leer|más|mas)\b/i.test(n)) ??
    "Contacto";
  return `<header class="dna-site-nav">
    <a class="dna-site-brand" href="#"><span class="dna-site-dot" aria-hidden="true"></span>${esc(product)}</a>
    <nav>${nav.map((n) => `<a href="#">${esc(n)}</a>`).join("")}</nav>
    <a class="dna-site-cta" href="#cta">${esc(cta)}</a>
  </header>`;
}

function brandFooter(brand: BrandContext | undefined) {
  const product = brand?.products[0] ?? "Product";
  const nav = (brand?.navigationPatterns ?? []).slice(0, 10);
  return `<footer class="dna-site-footer">
    <div class="dna-site-footer__brand">${esc(product)}</div>
    <div class="dna-site-footer__links">${nav.map((n) => `<a href="#">${esc(n)}</a>`).join("")}</div>
  </footer>`;
}

function wrapDocument(title: string, description: string, css: string, dna: DesignDna, body: string, brand?: BrandContext): string {
  const families = dna.typography.fonts
    .filter((f) => f.source !== "system" && !/system|-apple|sans-serif|serif|mono$/i.test(f.family))
    .map((f) => f.family.replace(/\s+/g, "+"));
  const fontLinks = families.length
    ? `  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}:wght@400;500;600;700`).join("&")}&display=swap" rel="stylesheet">`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
${fontLinks}
  <style>
${css}
  .dna-site-nav { position: sticky; top: 0; z-index: 10; min-height: 52px; display:flex; align-items:center; justify-content:space-between; gap:1.5rem; padding:0 22px; font-size:12px; background:color-mix(in srgb, var(--color-background,#08090a) 88%, transparent); border-bottom:1px solid color-mix(in srgb, var(--color-border,#23252a) 55%, transparent); backdrop-filter: blur(12px); }
  .dna-site-brand { display:inline-flex; align-items:center; gap:.45rem; font-weight:600; color:var(--color-text,#f7f8f8); }
  .dna-site-dot { width:12px; height:12px; border-radius:3px; background:var(--color-text,#f7f8f8); opacity:.9; }
  .dna-site-nav nav { display:flex; align-items:center; gap:1.1rem; color:color-mix(in srgb, var(--color-text,#fff) 66%, transparent); }
  .dna-site-nav nav a:hover { color:var(--color-text,#fff); }
  .dna-site-cta { border:1px solid var(--color-border,#37393a); border-radius:999px; padding:.28rem .7rem; background:var(--color-text,#f7f8f8); color:var(--color-background,#08090a); font-weight:600; }
  .dna-section__sub { font-size: 1.125rem; opacity: .8; max-width: 60ch; }
  .dna-cardicon { display:inline-block; width:36px; height:36px; border-radius:8px; background:var(--color-secondary,var(--color-accent,var(--color-border,#666))); opacity:.85; margin-bottom:.75rem; }
  .dna-site-footer { border-top:1px solid var(--color-border,rgba(127,127,127,.2)); padding:56px 22px; display:grid; grid-template-columns:1fr 2fr; gap:2rem; color:color-mix(in srgb, var(--color-text,#fff) 62%, transparent); font-size:12px; }
  .dna-site-footer__brand { color:var(--color-text,#fff); font-weight:600; }
  .dna-site-footer__links { display:flex; gap:1rem 2rem; flex-wrap:wrap; justify-content:flex-end; }
  @media (max-width: 760px) { .dna-site-nav nav { display:none; } .dna-site-footer { grid-template-columns:1fr; } .dna-site-footer__links { justify-content:flex-start; } }
  </style>
</head>
<body>
${brandHeader(brand)}
${body}
${brandFooter(brand)}
</body>
</html>`;
}
