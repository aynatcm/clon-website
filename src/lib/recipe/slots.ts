import { z } from "zod";
import type { BrandContext } from "@/lib/brand/schema";
import { structured, aiFeatures } from "@/lib/ai/claude";
import { brandAssetPayload, brandVariablePayload } from "@/lib/generation/promptContext";
import type { SectionRecipe, ContentPattern, SlotValues } from "./schema";

/**
 * Slot-fill — the ONLY place AI touches generation, and it produces CONTENT
 * ONLY (text per slot). Structure (layout/columns/cta-count/cards/media/
 * spacing) is fixed by the recipe and never produced here.
 */

export interface FillRequest {
  pageType: string;
  sectionIntent?: string;
  title?: string;
  brief?: string;
  audience?: string;
}

function heuristicFill(
  recipe: SectionRecipe,
  brand: BrandContext | undefined,
  cp: ContentPattern | undefined,
  req: FillRequest,
  idx: number,
): SlotValues {
  const v: SlotValues = {};
  const product = req.title ?? brand?.products[0] ?? "the product";
  const intent = req.sectionIntent ?? recipe.type;
  const realHeadline = brand?.headlines[idx] ?? brand?.headlines[0];
  const contextualHeadline = pickContextualHeadline(brand, req.pageType, intent);
  const realCtas = realCtaLabels(brand, cp);

  for (const slot of recipe.slots) {
    switch (slot.kind) {
      case "eyebrow":
        v[slot.id] = TYPE_EYEBROW[intent] ?? TYPE_EYEBROW[recipe.type] ?? "Overview";
        break;
      case "heading":
        v[slot.id] =
          intent === "hero"
            ? contextualHeadline ?? pageHeadingFromBrand(brand, req.pageType, product) ?? realHeadline ?? titleCase(req.pageType)
            : intent === "cta"
              ? ctaHeadingFromBrand(brand, req.pageType, product) ?? contextualHeadline ?? sectionHeadingFromBrand(brand, intent, idx) ?? titleCase(intent)
              : contextualHeadline ?? sectionHeadingFromBrand(brand, intent, idx) ?? sectionHeadingFromBrand(brand, recipe.type, idx) ?? titleCase(intent);
        break;
      case "subheading":
        v[slot.id] =
          req.brief?.slice(0, 150) ||
          subheadingFromBrand(brand, intent, idx) ||
          (intent === "hero" ? subheadingFromBrand(brand, req.pageType, idx) : undefined) ||
          conciseBrandSentence(brand, product);
        break;
      case "cta":
        v[slot.id] = realCtas.shift() ?? neutralCta(brand, cp);
        break;
      case "cardGroup": {
        const n = recipe.card?.count ?? slot.count ?? 3;
        const intentPool = CARD_POOL[intent] ?? CARD_POOL[recipe.type];
        v[slot.id] = brandCards(brand, intent, n, intentPool);
        break;
      }
      case "statGroup": {
        const n = slot.count ?? 3;
        v[slot.id] = brandStats(brand, intent, n);
        break;
      }
      case "logoGroup": {
        const n = slot.count ?? 5;
        const names = (brand?.products.length ? brand.products : ["Acme", "Globex", "Initech", "Umbrella", "Hooli", "Stark"]).slice(0, n);
        v[slot.id] = names;
        break;
      }
      case "media":
        v[slot.id] = ""; // resolved to a real asset URL by the renderer/architecture
        break;
      case "form":
        v[slot.id] = realCtas.find((c) => /send|contact|sales|talk|submit/i.test(c)) ?? realCtas[0] ?? "Submit";
        break;
    }
  }
  return v;
}

const TYPE_EYEBROW: Record<string, string> = {
  services: "Services",
  features: "Capabilities",
  benefits: "Benefits",
  form: "Contact",
  faq: "FAQ",
  "feature-grid": "Features",
  pricing: "Pricing",
  "team-section": "Team",
  stats: "Results",
  testimonials: "Customers",
};

function realCtaLabels(brand: BrandContext | undefined, cp: ContentPattern | undefined): string[] {
  return Array.from(
    new Set(
      [
        ...(cp?.cta.labels ?? []),
        ...(brand?.ctaPatterns ?? []),
        ...(brand?.copyLibrary ?? []).filter((c) => c.type === "cta-label").map((c) => c.content),
        ...(brand?.navigationPatterns ?? []).filter((c) => /\b(contacto|contact|servicios|services|proyectos|projects|leer|más|mas|sign up|log in|open app|demo|sales)\b/i.test(c)),
      ].filter((c) => {
        const t = String(c ?? "").replace(/\s+/g, " ").trim();
        return /[a-z]/i.test(t) && t.length <= 32 && !t.endsWith("-cta") && isUsefulCtaLabel(t) && !/^(learn more|get started|start building|continue)$/i.test(t);
      }),
    ),
  ).slice(0, 8);
}

function subheadingFromBrand(brand: BrandContext | undefined, intent: string, idx = 0): string | undefined {
  const subs = (brand?.copyLibrary ?? [])
    .filter((c) => c.type === "subheadline" && usefulCopy(c.content))
    .map((c) => c.content);
  if (!subs.length) return undefined;
  if (/hero|services|features|about|content/i.test(intent)) return subs[idx % subs.length];
  if (/pricing/i.test(intent)) return subs.find((s) => /\bplan|price|pricing|product|build/i.test(s)) ?? subs[idx % subs.length];
  if (/contact|form|cta/i.test(intent)) return subs.find((s) => /\bhelp|contact|sales|team/i.test(s)) ?? subs[idx % subs.length];
  return subs[idx % subs.length];
}

function sectionHeadingFromBrand(brand: BrandContext | undefined, intent: string, idx = 0): string | undefined {
  const hs = [...(brand?.headlines ?? []), ...(brand?.features ?? [])].filter(usefulCopy);
  const find = (re: RegExp) => hs.find((h) => re.test(h));
  if (/pricing/i.test(intent)) {
    const terms = pricingTerms(brand);
    return find(/\bpricing|free|basic|business|enterprise\b/i) ?? terms[0] ?? "Plans for product operations";
  }
  if (/team|career/i.test(intent)) return find(/\b(trabajar|contáctenos|contacto|equipo|team|career|people|behind)\b/i);
  if (/contact|form/i.test(intent)) return find(/\b(contáctenos|contacto|help|contact|sales|talk)\b/i);
  if (/faq/i.test(intent)) return find(/\bhow|help|question\b/i);
  if (/stats|benefit/i.test(intent)) return find(/\bprogress|scale|direction|future\b/i) ?? hs[idx % Math.max(1, hs.length)];
  if (/features|service/i.test(intent)) {
    return find(/\b(move|automate|review|understand|intake|build|agent|workflow)\b/i) ?? hs[(idx + 2) % Math.max(1, hs.length)];
  }
  if (/grid|split-hero|content/i.test(intent)) return hs[idx % Math.max(1, hs.length)];
  return hs[idx % Math.max(1, hs.length)];
}

function pageHeadingFromBrand(brand: BrandContext | undefined, pageType: string, product: string): string | undefined {
  if (pageType === "pricing") return sectionHeadingFromBrand(brand, "pricing");
  if (pageType === "contact") return sectionHeadingFromBrand(brand, "contact") ?? "Contacto";
  if (pageType === "careers") return sectionHeadingFromBrand(brand, "team") ?? sectionHeadingFromBrand(brand, "contact") ?? `Trabaja con ${product}`;
  if (pageType === "services") {
    const sub = subheadingFromBrand(brand, "services");
    const m = sub?.match(/\b(planning and building products|product development|products?[^.]{0,40})/i)?.[0];
    return m ? `Services for ${m.toLowerCase()}` : sectionHeadingFromBrand(brand, "features");
  }
  return sectionHeadingFromBrand(brand, pageType);
}

function ctaHeadingFromBrand(brand: BrandContext | undefined, pageType: string, product: string): string | undefined {
  if (pageType === "contact") return sectionHeadingFromBrand(brand, "contact") ?? "Contacto";
  if (pageType === "pricing") return sectionHeadingFromBrand(brand, "pricing");
  const h = (brand?.headlines ?? []).find((x) => /\b(contáctenos|contacto|trabajar|available|today|future|help|contact)\b/i.test(x));
  return h ?? sectionHeadingFromBrand(brand, "contact");
}

function conciseBrandSentence(brand: BrandContext | undefined, product: string): string {
  return subheadingFromBrand(brand, "hero") ?? (product && product !== "the product" ? `A closer look at ${product}.` : "");
}

function neutralCta(brand: BrandContext | undefined, cp: ContentPattern | undefined): string {
  return realCtaLabels(brand, cp)[0] ?? brand?.navigationPatterns.find((n) => /\bcontacto|contact\b/i.test(n)) ?? "Contacto";
}

function pricingTerms(brand: BrandContext | undefined): string[] {
  return Array.from(new Set((brand?.copyLibrary ?? []).filter((c) => c.type === "pricing-term" || /pricing/i.test(c.type)).map((c) => c.content).filter(usefulCopy)));
}

const CARD_POOL: Record<string, { title: string; body: string }[]> = {
  benefits: [
    { title: "Clearer priorities", body: "Teams see what matters now and what comes next." },
    { title: "Less coordination drag", body: "Shared context reduces meetings and repeated updates." },
    { title: "More focused execution", body: "Work stays connected to ownership, scope, and progress." },
    { title: "Better product rhythm", body: "Planning and delivery follow a cadence teams can trust." },
  ],
  faq: [
    { title: "How quickly can teams get started?", body: "Most teams can map their current workflow and begin with a focused setup." },
    { title: "Can it support multiple teams?", body: "Yes. The structure scales across projects, cycles, and ownership models." },
    { title: "Does it replace existing tools?", body: "It can connect the core product workflow while keeping important context visible." },
  ],
  services: [
    { title: "Product operations", body: "Plan, track, and coordinate work with clear ownership." },
    { title: "Workflow design", body: "Shape repeatable processes without adding clutter." },
    { title: "Team enablement", body: "Give teams a shared system for moving product work forward." },
    { title: "Reporting", body: "Turn progress, scope, and blockers into readable signals." },
    { title: "Implementation", body: "Map the product process into a fast, structured workspace." },
    { title: "Planning rituals", body: "Keep cycles, roadmaps, and daily work connected." },
    { title: "Migration support", body: "Bring existing work into a cleaner operating system." },
    { title: "Ongoing optimization", body: "Refine the setup as teams and priorities change." },
  ],
  features: [
    { title: "Focused workspaces", body: "Keep projects, issues, and context close together." },
    { title: "Fast navigation", body: "Move through product work without losing flow." },
    { title: "Clear ownership", body: "Give each initiative a visible owner and path." },
    { title: "Connected planning", body: "Link roadmaps, cycles, and execution in one product system." },
    { title: "Issue clarity", body: "Turn work into readable, actionable units." },
    { title: "Cycle rhythm", body: "Give teams a steady cadence for planning and delivery." },
    { title: "Roadmap context", body: "Keep long-term direction visible beside current work." },
    { title: "Team signals", body: "Surface progress and blockers without extra ceremony." },
  ],
  "feature-grid": [
    { title: "Fast by default", body: "Instant interactions keep your team in flow." },
    { title: "Built to scale", body: "From first hire to thousands, it keeps up." },
    { title: "Secure", body: "Encryption, audit logs and granular access." },
    { title: "Connected", body: "Works with the tools you already use." },
  ],
  pricing: [
    { title: "Free", body: "Purpose-built for planning and building products." },
    { title: "Basic", body: "Designed for the AI era." },
    { title: "Business", body: "For teams building products together." },
  ],
  "team-section": [
    { title: "Meet the team", body: "The people behind the product." },
    { title: "Product development", body: "Building tools for the next era." },
    { title: "Backed by the best", body: "A focused team and network around the work." },
  ],
};
const STAT_POOL = [
  { title: "Planning", body: "Purpose-built for planning and building products." },
  { title: "Building", body: "Designed for the next era of product development." },
  { title: "Direction", body: "A focused way to understand progress and priorities." },
  { title: "Progress", body: "Work moves forward across teams and agents." },
];

function usefulCopy(s: string) {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length < 3 || t.length > 90) return false;
  if (/^(product|products|features|company|resources|legal|login|log in|sign up|open app|more)$/i.test(t)) return false;
  return true;
}

function isUsefulCtaLabel(s: string) {
  const key = s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  if (!key || key.length < 3) return false;
  if (/^(linear|product|products|features|company|resources|legal|more|favorites|workspace|projects|initiatives|inbox|reviews|pulse|my issues|issues|documents|timeline)$/i.test(key)) {
    return false;
  }
  return /\b(open|sign|contact|contacto|contáctenos|servicios|services|proyectos|projects|leer|más|mas|talk|demo|sales|try|start|book|download|view|apply|join|send|submit|enviar)\b/i.test(s);
}

function sentenceFromBrand(brand: BrandContext | undefined, i: number, fallback?: string) {
  const sub = (brand?.copyLibrary ?? [])
    .filter((c) => c.type === "subheadline" && usefulCopy(c.content) && !/\b(contact support|technical issues|sales|legal|systems operational)\b/i.test(c.content))
    .map((c) => c.content);
  if (sub[i]) return sub[i];
  return brand ? "" : fallback ?? "";
}

function brandCards(
  brand: BrandContext | undefined,
  intent: string,
  n: number,
  fallbackPool?: { title: string; body: string }[],
): string[] {
  const terms = pricingTerms(brand);
  const intentTitles = /pricing/i.test(intent)
    ? terms.length
      ? terms
      : (brand?.features ?? []).filter((f) => /\b(plan|planning|roadmap|release|cycle|initiative|project|visual|product)\b/i.test(f))
    : [];
  const realTitles = [
    ...intentTitles,
    ...(/pricing/i.test(intent) ? [] : brand?.features ?? []),
    ...(brand?.headlines ?? []).filter((h) => !/\b(pricing|contact|sales|help|login|sign up)\b/i.test(h)),
  ].filter(usefulCopy);
  const unique = Array.from(new Set(realTitles));
  return Array.from({ length: n }, (_, i) => {
    const fallback = fallbackPool?.[i % Math.max(1, fallbackPool.length)];
    const title = unique[i] ?? fallback?.title ?? titleCase(intent);
    const body = sentenceFromBrand(brand, i, fallback?.body);
    return `${title} :: ${body}`;
  });
}

function brandStats(brand: BrandContext | undefined, intent: string, n: number): string[] {
  const realNumbers = (brand?.copyLibrary ?? [])
    .map((c) => c.content)
    .filter((s) => /\d/.test(s) && usefulCopy(s))
    .slice(0, n);
  if (realNumbers.length >= Math.min(2, n)) {
    return Array.from({ length: n }, (_, i) => {
      const title = realNumbers[i] ?? STAT_POOL[i % STAT_POOL.length].title;
      return `${title} :: ${sentenceFromBrand(brand, i, STAT_POOL[i % STAT_POOL.length].body)}`;
    });
  }
  return Array.from({ length: n }, (_, i) => {
    const feature = brand?.features?.[i];
    const s = feature ? { title: feature, body: sentenceFromBrand(brand, i) } : STAT_POOL[i % STAT_POOL.length];
    const title = intent === "benefits" ? BENEFIT_STAT_POOL[i % BENEFIT_STAT_POOL.length].title : s.title;
    const body = intent === "benefits" ? BENEFIT_STAT_POOL[i % BENEFIT_STAT_POOL.length].body : s.body;
    return `${title} :: ${sentenceFromBrand(brand, i, body)}`;
  });
}

const BENEFIT_STAT_POOL = [
  { title: "Less handoff", body: "Shared context keeps teams closer to the work." },
  { title: "More signal", body: "Progress is easier to read across projects and teams." },
  { title: "Clearer focus", body: "Priorities stay visible without extra ceremony." },
  { title: "Better rhythm", body: "Planning and execution follow a cadence teams can keep." },
];

function titleCase(s: string) {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function pickContextualHeadline(brand: BrandContext | undefined, pageType: string, intent: string): string | undefined {
  const hs = brand?.headlines ?? [];
  const find = (re: RegExp) => hs.find((h) => re.test(h));
  if (pageType === "contact" && intent === "hero") return find(/\b(contáctenos|contacto|help|contact)\b/i);
  if (intent === "form") return find(/\b(contáctenos|contacto|contact|sales|talk)\b/i);
  if (intent === "faq") return undefined;
  if (pageType === "pricing" || intent === "pricing") return find(/\bpricing|price|free|basic|business|enterprise\b/i);
  if (pageType === "careers" && intent === "hero") return find(/\b(trabajar|contáctenos|contacto)\b/i) ?? find(/\bcareer|team|people\b/i);
  return undefined;
}

const FillSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

export async function fillSlots(
  recipe: SectionRecipe,
  brand: BrandContext | undefined,
  cp: ContentPattern | undefined,
  req: FillRequest,
  idx: number,
): Promise<SlotValues> {
  const heuristic = heuristicFill(recipe, brand, cp, req, idx);
  if (!aiFeatures.ai) return heuristic;

  const slotDesc = recipe.slots.map((s) => ({ id: s.id, kind: s.kind, count: s.count, maxChars: s.maxChars }));
  const prompt = `Fill the CONTENT SLOTS for one "${recipe.type}" section. Return ONLY a JSON object mapping slot id -> value.
- Group slots (cardGroup/statGroup/logoGroup) return an array. For cardGroup/statGroup each item is "Title :: body".
- "media" slots return "" (the renderer places a real asset).
- Write in the brand voice. Reuse the brand's real vocabulary and CTA style. NEVER use forbidden generic phrases.
- Respect maxChars. Do NOT add or remove slots; fill exactly these:
${JSON.stringify(slotDesc)}

Page: ${req.pageType}${req.title ? ` for ${req.title}` : ""}. Brief: ${req.brief || "(infer)"}.
Brand voice: ${JSON.stringify(brand?.brandVoice ?? {})}
Real headlines: ${JSON.stringify(brand?.headlines.slice(0, 8) ?? [])}
Real CTA labels: ${JSON.stringify(cp?.cta.labels ?? [])}
Real crawled assets (for product vocabulary/context; do not output layout): ${JSON.stringify(brandAssetPayload(brand, 12))}
Original CSS variables / source tokens (for naming/style vocabulary only): ${JSON.stringify(brandVariablePayload(brand, undefined, 24))}
Forbidden phrases: ${JSON.stringify(brand?.forbiddenPhrases ?? [])}`;

  try {
    const filled = await structured(FillSchema, prompt, {
      system: "You write on-brand microcopy. Content only, never layout. JSON only.",
      maxTokens: 1500,
      temperature: 0.5,
    });
    // Keep only known slot ids; backfill any the model dropped.
    const out: SlotValues = {};
    for (const slot of recipe.slots) out[slot.id] = filled[slot.id] ?? heuristic[slot.id];
    return out;
  } catch {
    return heuristic;
  }
}
