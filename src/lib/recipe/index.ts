import type { Evidence } from "@/lib/extraction/evidence";
import type { DesignDna } from "@/lib/dna/schema";
import type { BrandContext } from "@/lib/brand/schema";
import {
  RecipeBookSchema,
  type RecipeBook,
  type SectionRecipe,
  type SlotSpec,
  type ContentPattern,
} from "./schema";

export * from "./schema";

const VARIANT_FOR: Record<string, string> = {
  hero: "split",
  "split-hero": "split",
  "feature-grid": "grid",
  "service-grid": "grid",
  "team-section": "grid",
  stats: "grid",
  pricing: "grid",
  testimonials: "grid",
  portfolio: "grid",
  "case-studies": "grid",
  "feature-comparison": "grid",
  "process-section": "grid",
  "trust-section": "grid",
  "logo-cloud": "logos",
  "contact-section": "form",
  cta: "centered",
  "footer-cta": "centered",
  "content-block": "stacked",
  footer: "stacked",
};

function headingLevel(type: string): number {
  return type === "hero" || type === "split-hero" ? 1 : 2;
}

/** Build the ordered slot graph for a section from its measured fingerprint. */
function buildSlots(r: {
  type: string;
  variant: string;
  hasEyebrow: boolean;
  hasSub: boolean;
  ctaCount: number;
  mediaPlacement: string;
  cardCount: number;
}): SlotSpec[] {
  const slots: SlotSpec[] = [];
  if (r.hasEyebrow) slots.push({ id: "eyebrow", kind: "eyebrow", maxChars: 32 });
  slots.push({ id: "heading", kind: "heading", level: headingLevel(r.type), maxChars: r.type === "hero" ? 70 : 60 });
  if (r.hasSub) slots.push({ id: "subheading", kind: "subheading", maxChars: 160 });

  if (r.variant === "logos") {
    slots.push({ id: "logos", kind: "logoGroup", count: Math.max(4, r.cardCount || 5) });
  } else if (r.type === "stats") {
    slots.push({ id: "stats", kind: "statGroup", count: Math.max(2, r.cardCount || 3) });
  } else if (r.variant === "grid" && r.cardCount >= 2) {
    slots.push({ id: "cards", kind: "cardGroup", count: r.cardCount });
  } else if (r.variant === "form") {
    slots.push({ id: "form", kind: "form" });
  }

  if (r.mediaPlacement !== "none" && r.variant !== "logos" && r.variant !== "grid" && r.type !== "footer") {
    slots.push({ id: "media", kind: "media" });
  }
  // CTA count is intent, not raw link count — cap so a nav-heavy hero stays sane.
  const ctas = r.variant === "logos" || r.variant === "grid" ? 0 : Math.min(2, r.ctaCount);
  for (let i = 0; i < ctas; i++) {
    slots.push({ id: `cta${i + 1}`, kind: "cta", maxChars: 28 });
  }
  return slots;
}

export function buildRecipeBook(ev: Evidence, dna: DesignDna, brand?: BrandContext): RecipeBook {
  const recipes: SectionRecipe[] = ev.sections.flatMap((s, idx) => {
    const allFps = s.fingerprints?.length ? s.fingerprints : [s.fingerprint];
    const fps = s.type === "footer" ? allFps.slice(0, 1) : allFps;
    return fps.map((fp, variantIdx) => {
    const mediaHeavy = (s.type === "hero" || s.type === "split-hero") && fp.imageCount >= 8;
    const variant = mediaHeavy ? "media" : VARIANT_FOR[s.type] ?? (fp.columns >= 2 ? "grid" : "stacked");
    const hasSub = (fp.paragraphCount ?? 0) >= 1 && variant !== "logos";
    const cardCount = fp.cardCount && fp.cardCount >= 2 ? fp.cardCount : variant === "grid" ? Math.max(3, fp.columns || 3) : 0;
    const slots = buildSlots({
      type: s.type,
      variant,
      hasEyebrow: !!fp.hasEyebrow,
      hasSub,
      ctaCount: Math.min(3, fp.ctaCount ?? 0),
      mediaPlacement: mediaHeavy ? "bottom" : fp.mediaSide ?? "none",
      cardCount,
    });
    const card =
      variant === "grid" && cardCount >= 2
        ? {
            count: cardCount,
            hasIcon: !!fp.cardHasIcon,
            hasCta: !!fp.cardHasCta,
            slots: [...(fp.cardHasIcon ? ["icon"] : []), "heading", "body", ...(fp.cardHasCta ? ["cta"] : [])],
          }
        : undefined;

    return {
      id: `${s.type}-${idx}-${variantIdx}`,
      type: s.type,
      variant,
      frequency: s.frequency,
      columns: mediaHeavy ? 1 : Math.max(1, fp.columns || 1),
      mediaPlacement: (mediaHeavy ? "bottom" : fp.mediaSide ?? "none") as SectionRecipe["mediaPlacement"],
      ctaCount: Math.min(3, fp.ctaCount ?? 0),
      alignment: s.type === "hero" || s.type === "cta" || s.type === "footer-cta" ? "center" : "left",
      spacing: { top: fp.paddingTop ?? "64px", bottom: fp.paddingBottom ?? "64px", gap: fp.gap ?? "24px" },
      card,
      slots,
      background: fp.background,
      evidence: [s.evidence[variantIdx] ?? s.evidence[0] ?? "detected"],
    };
    });
  });

  return RecipeBookSchema.parse({ recipes, contentPattern: buildContentPattern(ev, dna, brand) });
}

function buildContentPattern(ev: Evidence, dna: DesignDna, brand?: BrandContext): ContentPattern {
  const headlines = ev.content.filter((c) => c.type === "headline" || c.type === "tagline").map((c) => c.content);
  const subs = ev.content.filter((c) => c.type === "subheadline").map((c) => c.content);
  const features = ev.content.filter((c) => c.type === "feature-name").map((c) => c.content);
  const ctas = ev.content.filter((c) => c.type === "cta-label" && isUsefulCtaLabel(c.content)).map((c) => c.content);
  const wordsOf = (arr: string[]) => (arr.length ? Math.round(arr.reduce((s, h) => s + h.split(/\s+/).length, 0) / arr.length) : 0);

  const avgHeadWords = wordsOf(headlines) || 6;
  const upperRatio = headlines.filter((h) => h === h.toUpperCase()).length / Math.max(1, headlines.length);
  const titleRatio = headlines.filter((h) => /^[A-Z]/.test(h)).length / Math.max(1, headlines.length);
  const verbLed = ctas.filter((c) => /^(get|start|try|build|create|see|join|book|talk|explore|learn|open)/i.test(c)).length > ctas.length / 2;

  return {
    headline: {
      avgWords: avgHeadWords,
      style: avgHeadWords <= 5 ? "punchy noun-phrase" : avgHeadWords <= 9 ? "benefit statement" : "descriptive sentence",
      casing: upperRatio > 0.4 ? "uppercase" : titleRatio > 0.6 ? "sentence/title" : "mixed",
    },
    subheadline: { avgWords: wordsOf(subs) || 18 },
    cta: { labels: Array.from(new Set(ctas)).slice(0, 8), verbLed },
    feature: {
      naming: wordsOf(features) <= 2 ? "short label" : "phrase",
      hasIcon: ev.sections.some((s) => s.fingerprint.cardHasIcon),
      bodyWords: 14,
    },
    vocabulary: brand?.brandVoice.vocabulary ?? [],
  };
}

function isUsefulCtaLabel(s: string) {
  const key = s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  if (!key || key.length < 3) return false;
  if (/^(product|products|features|company|resources|legal|more|favorites|workspace|projects|initiatives|inbox|reviews|pulse|my issues|linear)$/i.test(key)) {
    return false;
  }
  return /\b(open|sign|contact|talk|demo|sales|try|start|book|download|view|learn|apply|join|send|submit)\b/i.test(s);
}
