import type { DesignDna } from "@/lib/dna/schema";
import type { DesignSystem } from "@/lib/designsystem/schema";
import type { BrandContext } from "@/lib/brand/schema";
import { isUsableAssetUrl } from "@/lib/brand/assets";
import { structured, aiFeatures } from "@/lib/ai/claude";
import { PageArchitectureSchema, type GenerationRequest, type PageArchitecture } from "./schema";

// Section type -> preferred asset roles (for media-bearing layouts).
const ASSET_ROLE_PREF: Record<string, string[]> = {
  hero: ["dashboard", "product-shot", "hero-image", "illustration"],
  "split-hero": ["dashboard", "product-shot", "hero-image", "illustration"],
  "feature-grid": ["feature-image", "illustration", "product-shot"],
  "service-grid": ["feature-image", "illustration"],
  "team-section": ["team-photo", "testimonial-avatar"],
  testimonials: ["testimonial-avatar"],
  "logo-cloud": ["logo"],
  pricing: ["illustration", "feature-image"],
  stats: ["illustration"],
  "content-block": ["product-shot", "illustration", "feature-image"],
  "case-studies": ["product-shot", "feature-image"],
  portfolio: ["product-shot", "feature-image"],
};

function pickAsset(sectionType: string, brand?: BrandContext): { role: string; url?: string } {
  const prefs = ASSET_ROLE_PREF[sectionType] ?? ["product-shot", "illustration"];
  if (!brand) return { role: `${prefs[0]}` };
  for (const role of prefs) {
    const a = brand.assets.find((x) => x.role === role && isUsableAssetUrl(x.url));
    if (a) return { role, url: a.url };
  }
  // any real raster asset as last resort
  const any = brand.assets.find((x) => isUsableAssetUrl(x.url) && x.role !== "logo");
  return { role: prefs[0], url: any?.url };
}

/**
 * Phase 9 — LAYOUT-DRIVEN page architecture. Every section MUST originate from
 * a detected layout in `system.layouts` (the source of truth). Requested
 * sections are mapped to the closest detected layout; nothing generic is
 * invented. The resolved layout's structural variant is carried to the renderer.
 */

const DEFAULT_SECTIONS: Record<string, string[]> = {
  landing: ["hero", "logos", "feature-grid", "stats", "testimonials", "cta", "footer"],
  about: ["hero", "story", "stats", "team", "cta", "footer"],
  pricing: ["hero", "pricing", "feature-grid", "testimonials", "cta", "footer"],
  careers: ["hero", "story", "stats", "feature-grid", "cta", "footer"],
  contact: ["hero", "contact", "footer"],
  custom: ["hero", "feature-grid", "cta", "footer"],
};

// Requested label -> ordered preference of DETECTED layout types (requirement 5).
const ALIAS: Record<string, string[]> = {
  hero: ["split-hero", "hero", "content-block"],
  "split-hero": ["split-hero", "hero"],
  story: ["content-block", "split-hero", "feature-grid"],
  about: ["content-block", "split-hero"],
  features: ["feature-grid", "service-grid", "stats"],
  "feature-grid": ["feature-grid", "service-grid"],
  services: ["service-grid", "feature-grid"],
  process: ["process-section", "feature-grid"],
  timeline: ["timeline", "process-section", "stats"],
  team: ["team-section", "feature-grid", "testimonials"],
  faq: ["faq", "content-block"],
  pricing: ["pricing", "feature-comparison", "feature-grid"],
  stats: ["stats", "feature-grid"],
  logos: ["logo-cloud", "feature-grid"],
  "logo-cloud": ["logo-cloud"],
  testimonials: ["testimonials", "feature-grid", "content-block"],
  portfolio: ["portfolio", "feature-grid"],
  "case-studies": ["case-studies", "feature-grid", "content-block"],
  comparison: ["feature-comparison", "pricing"],
  trust: ["trust-section", "logo-cloud", "stats"],
  cta: ["footer-cta", "cta", "contact-section"],
  contact: ["contact-section", "footer-cta", "cta"],
  form: ["contact-section", "cta"],
  footer: ["footer"],
  "content-block": ["content-block"],
};

interface ResolvedLayout {
  type: string; // detected layout type
  variant: string; // structural variant
  sourcePattern: string;
}

/** Resolve a requested section to a DETECTED layout (never generic). */
function resolveToLayout(requested: string, system: DesignSystem): ResolvedLayout {
  const available = new Map(system.layouts.map((l) => [l.type, l]));
  const prefs = ALIAS[requested] ?? [requested];

  for (const cand of prefs) {
    const l = available.get(cand);
    if (l) {
      const exact = cand === requested;
      return {
        type: l.type,
        variant: l.variant,
        sourcePattern: exact ? `detected layout: ${l.type}` : `closest detected layout "${l.type}" for "${requested}"`,
      };
    }
  }
  // Last resort: extend a STRUCTURALLY similar detected layout (never footer/nav).
  // Pick the variant the request implies, then the most frequent match.
  const GRID_REQ = new Set([
    "features", "feature-grid", "services", "service-grid", "stats", "pricing",
    "testimonials", "team", "portfolio", "case-studies", "comparison", "process", "trust",
  ]);
  const desiredVariant = GRID_REQ.has(requested)
    ? "grid"
    : requested === "hero" || requested === "split-hero"
      ? "split"
      : requested === "cta" || requested === "contact" || requested === "form"
        ? "form"
        : "stacked";
  const content = system.layouts.filter((l) => l.type !== "footer" && l.type !== "nav");
  const byVariant = content
    .filter((l) => l.variant === desiredVariant)
    .sort((a, b) => b.frequency - a.frequency);
  const fallback = byVariant[0] ?? [...content].sort((a, b) => b.frequency - a.frequency)[0];
  if (fallback) {
    return {
      type: fallback.type,
      variant: fallback.variant,
      sourcePattern: `no exact match for "${requested}" — extended structurally-similar "${fallback.type}" (${fallback.variant})`,
    };
  }
  // System has no layouts at all — degrade to a content block.
  return { type: "content-block", variant: "stacked", sourcePattern: `no detected layouts; content-block for "${requested}"` };
}

function deterministicArchitecture(req: GenerationRequest, system: DesignSystem, brand?: BrandContext): PageArchitecture {
  const wanted = req.sections.length ? req.sections : DEFAULT_SECTIONS[req.pageType] ?? DEFAULT_SECTIONS.custom;
  const product = req.title ?? brand?.products[0] ?? "the product";
  const cta = brand?.ctaPatterns[0] ?? "standard-cta";
  const copyPattern = brand?.brandVoice.conversionStyle ?? "product-led";

  const sections = wanted.map((w) => {
    const r = resolveToLayout(w, system);
    const layoutDef = system.layouts.find((l) => l.type === r.type);
    const needsMedia = r.variant === "split" || r.variant === "media" || r.variant === "logos" || layoutDef?.hasMedia;
    const asset = needsMedia ? pickAsset(r.type, brand) : undefined;
    return {
      type: r.type,
      sourcePattern: r.sourcePattern,
      heading: brandHeadingFor(w, req, brand),
      subheading: subFor(w, req),
      contentSlots: {},
      layout: r.variant,
      visualAsset: asset?.role,
      visualAssetUrl: asset?.url,
      copyPattern,
      componentPattern: cta,
      sectionPattern: brand?.sectionPatterns.find((p) => p.startsWith(r.type)) ?? r.type,
      notes: `Instantiates detected ${r.type} layout (${r.variant}).`,
    };
  });

  return PageArchitectureSchema.parse({
    pageTitle: req.title ?? `${titleCase(req.pageType)} — ${product}`,
    metaDescription: (req.brief || `${titleCase(req.pageType)} page`).slice(0, 155),
    sections,
    rationale: "Each section instantiates a detected layout and reuses the brand's real assets, copy and voice.",
  });
}

/** Prefer a real harvested headline matching the section before a synthetic one. */
function brandHeadingFor(type: string, req: GenerationRequest, brand?: BrandContext): string {
  if (brand && (type === "hero" || type === "split-hero") && brand.headlines.length && !req.brief) {
    return brand.headlines[0];
  }
  return headingFor(type, req);
}

function headingFor(type: string, req: GenerationRequest): string {
  const p = req.title ?? "";
  const map: Record<string, string> = {
    hero: req.brief ? req.brief.split(/[.\n]/)[0].slice(0, 80) : `${titleCase(req.pageType)}`,
    "split-hero": req.brief ? req.brief.split(/[.\n]/)[0].slice(0, 80) : `${titleCase(req.pageType)}`,
    "feature-grid": "Everything you need",
    features: "Everything you need",
    pricing: "Simple, transparent pricing",
    testimonials: "Loved by teams",
    team: "Meet the team",
    stats: "By the numbers",
    logos: "Trusted by",
    story: "Our story",
    cta: p ? `Start building with ${p}` : "Start building today",
    "footer-cta": p ? `Ready to try ${p}?` : "Ready when you are",
    contact: "Talk to the team",
    form: "Talk to the team",
    footer: "",
    timeline: "How we got here",
  };
  return map[type] ?? titleCase(type);
}
function subFor(type: string, req: GenerationRequest): string {
  if (type === "hero" || type === "split-hero") return req.brief.slice(0, 160) || `A closer look at ${req.title ?? "the product"}.`;
  if (type === "cta" || type === "footer-cta") return "Set up your workspace in minutes.";
  return "";
}
function titleCase(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

const SYSTEM = `You are a Design System Architect. You plan a new page that EXTENDS an existing product by INSTANTIATING its detected layouts.
STRICT rules:
- Every section's "type" MUST be one of the detected layout types provided. Never invent a section type that is not in the layout library.
- Set "layout" to that detected layout's structural variant (split/grid/centered/form/stacked/logos/media).
- "sourcePattern" must name the detected layout it extends.
- Write real, specific, on-brand copy. NO lorem ipsum, NO placeholders.
Output ONLY JSON matching the schema.`;

export async function architectPage(
  req: GenerationRequest,
  dna: DesignDna,
  system: DesignSystem,
  brand?: BrandContext,
): Promise<PageArchitecture> {
  const fallback = deterministicArchitecture(req, system, brand);
  if (!aiFeatures.ai) return fallback;

  const prompt = `Plan a "${req.pageType}" page by INSTANTIATING this product's detected layouts.

Requested sections: ${req.sections.length ? req.sections.join(", ") : "(choose from detected layouts)"}
Brief: ${req.brief || "(infer on-brand content)"}
${req.audience ? `Audience: ${req.audience}` : ""}
Title: ${req.title ?? "(none)"}

=== DETECTED LAYOUTS (the ONLY allowed section types) ===
${JSON.stringify(system.layouts.map((l) => ({ type: l.type, variant: l.variant, columns: l.columns, hasMedia: l.hasMedia, hasForm: l.hasForm, structure: l.structure })))}
=== COMPONENT FINGERPRINTS ===
${JSON.stringify(system.components.map((c) => ({ type: c.type, className: c.className, fingerprint: c.fingerprint })))}
=== BRAND ===
${dna.designPhilosophy.summary} | ${dna.designPhilosophy.keywords.join(", ")}
${brand ? `=== BRAND VOICE === ${JSON.stringify(brand.brandVoice)}
=== REAL HEADLINES (reuse / echo this voice) === ${JSON.stringify(brand.headlines.slice(0, 12))}
=== REAL CTA LABELS === ${JSON.stringify(brand.ctaPatterns)}
=== AVAILABLE ASSETS (role → use for media sections) === ${JSON.stringify(brand.assets.slice(0, 20).map((a) => ({ role: a.role, url: a.url })))}
=== FORBIDDEN GENERIC PHRASES (never use) === ${JSON.stringify(brand.forbiddenPhrases)}` : ""}

For each section set: visualAsset (asset role for media layouts), visualAssetUrl (a real asset URL when available), copyPattern (${brand?.brandVoice.conversionStyle ?? "product-led"}), componentPattern (${brand?.ctaPatterns[0] ?? "standard-cta"}), sectionPattern.
Match the brand voice; reuse real headline/CTA vocabulary. Map each requested section to the CLOSEST detected layout type and set its variant. Return full PageArchitecture JSON; contentSlots maps slot name -> real copy.`;

  try {
    const arch = await structured(PageArchitectureSchema, prompt, { system: SYSTEM, maxTokens: 6000, temperature: 0.4 });
    // Enforce requirement 2/3: coerce any hallucinated type back to a detected layout.
    const valid = new Set(system.layouts.map((l) => l.type));
    arch.sections = arch.sections.map((s) => {
      let sec = s;
      if (valid.has(s.type)) {
        const l = system.layouts.find((x) => x.type === s.type)!;
        sec = { ...s, layout: s.layout || l.variant };
      } else {
        const r = resolveToLayout(s.type, system);
        sec = { ...s, type: r.type, layout: r.variant, sourcePattern: r.sourcePattern };
      }
      // Backfill brand fields: media sections MUST resolve to a real asset.
      const layoutDef = system.layouts.find((l) => l.type === sec.type);
      const needsMedia = sec.layout === "split" || sec.layout === "media" || sec.layout === "logos" || layoutDef?.hasMedia;
      if (needsMedia && !isUsableAssetUrl(sec.visualAssetUrl)) {
        const a = pickAsset(sec.type, brand);
        sec = { ...sec, visualAsset: sec.visualAsset ?? a.role, visualAssetUrl: a.url };
      }
      return {
        ...sec,
        copyPattern: sec.copyPattern ?? brand?.brandVoice.conversionStyle,
        componentPattern: sec.componentPattern ?? brand?.ctaPatterns[0],
      };
    });
    return arch;
  } catch {
    return fallback;
  }
}
