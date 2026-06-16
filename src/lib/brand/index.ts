import type { Evidence } from "@/lib/extraction/evidence";
import type { DesignDna } from "@/lib/dna/schema";
import { structured, type ImageInput, aiFeatures } from "@/lib/ai/claude";
import { getObjectBuffer } from "@/lib/storage/r2";
import {
  BrandContextSchema,
  BrandVoiceSchema,
  ScreenshotAnalysisSchema,
  FORBIDDEN_GENERIC_PHRASES,
  type BrandContext,
  type BrandVoice,
  type ScreenshotAnalysis,
} from "./schema";

/** Phase 6.5 — build the Brand Context Package. */

const TECH_WORDS = /\b(api|sdk|deploy|infrastructure|latency|schema|query|integration|workflow|webhook|runtime|endpoint|cli|repo|commit|pipeline|kubernetes|graphql|oauth)\b/i;
const scaleFromRatio = (r: number) =>
  r < 0.05 ? "very-low" : r < 0.15 ? "low" : r < 0.3 ? "medium" : r < 0.5 ? "high" : "very-high";

function words(s: string) {
  return s.split(/\s+/).filter(Boolean);
}

export function heuristicBrandVoice(ev: Evidence, dna: DesignDna): BrandVoice {
  const copy = ev.content.map((c) => c.content);
  const headlines = ev.content.filter((c) => c.type === "headline" || c.type === "tagline").map((c) => c.content);
  const allText = copy.join(" ");
  const avgWords = headlines.length ? headlines.reduce((s, h) => s + words(h).length, 0) / headlines.length : 6;
  const sentenceLength = avgWords < 6 ? "short" : avgWords < 11 ? "medium" : "long";

  const techHits = copy.filter((c) => TECH_WORDS.test(c)).length;
  const technicalDepth = scaleFromRatio(copy.length ? techHits / copy.length : 0);
  const exclamations = (allText.match(/!/g) || []).length;
  const emotionalIntensity = scaleFromRatio(allText.length ? exclamations / Math.max(1, headlines.length) : 0);

  // vocabulary: most frequent non-stopword tokens across copy
  const stop = new Set(["the", "and", "for", "your", "with", "you", "our", "are", "that", "this", "from", "all", "can", "to", "of", "a", "in", "on", "is", "it"]);
  const freq = new Map<string, number>();
  for (const c of copy) for (const w of words(c.toLowerCase().replace(/[^a-z0-9 ]/g, ""))) {
    if (w.length < 3 || stop.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const vocabulary = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);

  const p = dna.brandPersonality;
  const toneBits = [
    sentenceLength === "short" ? "concise" : sentenceLength === "long" ? "expansive" : "balanced",
    technicalDepth === "high" || technicalDepth === "very-high" ? "technical" : "accessible",
    p.playfulness === "high" || p.playfulness === "very-high" ? "playful" : p.energy === "low" ? "calm" : "confident",
    p.density === "low" || p.density === "very-low" ? "minimal" : "rich",
  ];

  const trust: string[] = [];
  if (ev.sections.some((s) => s.type === "logo-cloud")) trust.push("logo cloud");
  if (ev.sections.some((s) => s.type === "testimonials")) trust.push("testimonials");
  if (ev.sections.some((s) => s.type === "stats")) trust.push("metrics");
  if (ev.sections.some((s) => s.type === "trust-section")) trust.push("security/compliance badges");

  const ctaSamples = ev.content.filter((c) => c.type === "cta-label").map((c) => c.content.toLowerCase());
  const conversionStyle = ctaSamples.some((c) => /build|try|start free|create|deploy/.test(c))
    ? "product-led"
    : ctaSamples.some((c) => /demo|sales|contact|talk/.test(c))
      ? "sales-assisted"
      : "low-pressure";

  return BrandVoiceSchema.parse({
    tone: toneBits.join(", "),
    readingLevel: technicalDepth === "high" ? "professional/technical" : "general professional",
    sentenceLength,
    emotionalIntensity,
    technicalDepth,
    conversionStyle,
    trustSignals: trust,
    vocabulary,
    source: "heuristic",
  });
}

export function heuristicScreenshotAnalysis(ev: Evidence, dna: DesignDna): ScreenshotAnalysis {
  const roles = new Set(ev.assets.map((a) => a.role));
  const productShots = roles.has("dashboard") || roles.has("product-shot");
  return ScreenshotAnalysisSchema.parse({
    visualStyle: `${dna.colors.mode} ${dna.brandPersonality.visualStyle}, ${dna.visualRules.cornerStyle} corners`,
    imageryStyle: productShots ? "real product UI screenshots" : roles.has("illustration") ? "custom illustrations" : "minimal imagery",
    compositionStyle: dna.visualRules.composition,
    productPresentationStyle: productShots ? "framed dashboard / app screenshots in hero and feature sections" : "icon-led feature presentation",
    screenshotPurpose: "demonstrate the product and build credibility",
    visualHierarchy: dna.visualRules.hierarchy,
    decorativePatterns: dna.visualRules.decorativeElements,
    source: "heuristic",
  });
}

async function loadImages(ev: Evidence, max = 5): Promise<ImageInput[]> {
  const priority = ["DESKTOP", "SECTION", "MOBILE", "NAVIGATION"];
  const picked: typeof ev.screenshots = [];
  for (const kind of priority) {
    const s = ev.screenshots.find((x) => x.kind === kind && !picked.includes(x));
    if (s) picked.push(s);
    if (picked.length >= max) break;
  }
  for (const s of ev.screenshots) {
    if (picked.length >= max) break;
    if (!picked.includes(s)) picked.push(s);
  }
  const out: ImageInput[] = [];
  for (const s of picked) {
    try {
      const buf = await getObjectBuffer(s.key);
      if (buf.length > 4_500_000) continue;
      out.push({ base64: buf.toString("base64"), mediaType: "image/png" });
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function buildBrandContext(ev: Evidence, dna: DesignDna): Promise<BrandContext> {
  const byType = (t: string) => ev.content.filter((c) => c.type === t).map((c) => cleanBrandText(c.content));
  const hostBrand = (() => {
    try {
      const host = new URL(ev.startUrl).hostname.replace(/^www\./, "").split(".")[0];
      return host ? host.charAt(0).toUpperCase() + host.slice(1) : "";
    } catch {
      return "";
    }
  })();
  const titleBrand =
    ev.titles
      .map((t) => t.split(/[|–—-]/)[0]?.replace(/\s+/g, " ").trim())
      .find((t) => t && t.length >= 2 && t.length <= 32) ?? "";
  const headlines = Array.from(new Set([...byType("tagline"), ...byType("headline")])).slice(0, 24);
  const ctas = Array.from(new Set(byType("cta-label").filter(isUsefulCtaLabel))).slice(0, 16);
  const navLabels = Array.from(new Set(byType("nav-label"))).slice(0, 16);
  const navSet = new Set([...navLabels, ...ctas].map((s) => normalizeCopyKey(s)));
  const commonNav = new Set(
    [
      "product",
      "products",
      "features",
      "company",
      "resources",
      "legal",
      "pricing",
      "contact",
      "docs",
      "documentation",
      "developers",
      "login",
      "log in",
      "sign up",
      "open app",
      "community",
      "status",
      "inbox",
      "reviews",
      "pulse",
      "workspace",
      "initiatives",
      "projects",
      "documents",
      "timeline",
      "issues",
    ].map(normalizeCopyKey),
  );
  const featureNames = byType("feature-name").filter((s) => {
    const key = normalizeCopyKey(s);
    if (!key || navSet.has(key) || commonNav.has(key)) return false;
    if (/\b(general communication|systems operational|support|legal|community|free|basic|business|enterprise)\b/i.test(s)) return false;
    if (looksLikeLogoOrProperName(s)) return false;
    if (s.split(/\s+/).length <= 1 && /^[A-Z][a-z]+$/.test(s)) return false;
    return true;
  });
  const featureLikeHeadlines = headlines.filter((h, i) => {
    if (i === 0) return false;
    if (/\b(pricing|contact|sales|help|support|changelog|career|login|sign up|team behind|backed by|systems operational)\b/i.test(h)) return false;
    return h.split(/\s+/).length >= 3;
  });
  const features = Array.from(new Set([...featureNames, ...featureLikeHeadlines])).slice(0, 24);
  const products = Array.from(
    new Set(
      [hostBrand, titleBrand, ...byType("product-name"), ...ev.assets.filter((a) => a.role === "logo").map((a) => a.alt)]
        .map((s) => s.replace(/\b(logo|logotype|wordmark|icon|brand)\b/gi, "").replace(/\s+/g, " ").trim())
        .filter((s) => s.length >= 2),
    ),
  ).slice(0, 8);

  // patterns
  const assetRoles = Array.from(new Set(ev.assets.map((a) => a.role)));
  const imageryPatterns = assetRoles.filter((r) => /image|shot|dashboard|illustration|photo|background/.test(r));
  const iconographyPatterns = ev.assets.some((a) => a.role === "icon")
    ? [`${ev.assets.filter((a) => a.role === "icon").length} inline icons; ${dna.visualRules.cornerStyle}-corner UI`]
    : ["minimal iconography"];
  const visualMotifs = [
    `${dna.visualRules.cornerStyle} corners`,
    `${dna.visualRules.shadowStyle} shadows`,
    dna.visualRules.decorativeElements,
  ].filter(Boolean);
  const ctaButton = dna.components.find((c) => c.type === "button")?.variants[0];
  const ctaPatterns = [
    ctaButton?.radius && parseFloat(ctaButton.radius) >= 100 ? "pill-cta" : ctaButton?.radius ? `radius-${ctaButton.radius}-cta` : "standard-cta",
    ...ctas.slice(0, 6),
  ];
  const sectionPatterns = ev.sections.map((s) => `${s.type}×${s.frequency}`);
  const contentPatterns = [
    `headlines ~${headlines.length ? Math.round(headlines.reduce((s, h) => s + h.split(/\s+/).length, 0) / headlines.length) : 6} words`,
    ev.sections.some((s) => s.type === "stats") ? "metric-driven proof" : "narrative proof",
  ];
  const ignoredVariable = /toast|tooltip|popover|radix|swiper|cookie|captcha|recaptcha|intercom|zendesk/i;
  const variablePriority = (name: string, value: string) => {
    const k = name.toLowerCase();
    const v = value.toLowerCase();
    if (/brand|primary|accent|cta|hero/.test(k)) return 100;
    if (/color|bg|background|surface|foreground|text|border/.test(k) || /^#|rgb|hsl|oklch/.test(v)) return 90;
    if (/font|type|heading|body/.test(k)) return 80;
    if (/radius|shadow/.test(k)) return 70;
    if (/space|spacing|gap|padding|margin/.test(k)) return 60;
    if (/container|grid|width|column/.test(k)) return 50;
    if (/^\d+(\.\d+)?(px|rem|em|vw|vh|%)\b/.test(v)) return 35;
    return 10;
  };
  const rawVariables = Object.entries(ev.cssVariables)
    .filter(([name, value]) => {
      const key = name.toLowerCase();
      const val = String(value).trim();
      if (ignoredVariable.test(key)) return false;
      if (!val || val === "initial" || val === "inherit" || val === "unset") return false;
      return (
        /color|bg|background|surface|border|shadow|radius|space|spacing|gap|font|type|size|width|container|grid/i.test(key) ||
        /^#|rgb|hsl|oklch|clamp\(|calc\(|-?\d+(\.\d+)?(px|rem|em|vw|vh|%)\b/i.test(val)
      );
    })
    .sort((a, b) => variablePriority(b[0], String(b[1])) - variablePriority(a[0], String(a[1])))
    .slice(0, 80)
    .map(([name, value]) => ({ name, value: String(value) }));

  const [brandVoice, screenshotAnalysis] = await Promise.all([
    analyzeBrandVoice(ev, dna),
    analyzeScreenshots(ev, dna),
  ]);

  return BrandContextSchema.parse({
    assets: ev.assets,
    screenshots: ev.screenshots.map((s) => ({ key: s.key, kind: s.kind, label: s.label })),
    cssVariables: ev.cssVariables,
    rawVariables,
    copyLibrary: ev.content.map((c) => ({ ...c, content: cleanBrandText(c.content) })),
    headlines,
    features,
    testimonials: ev.content.filter((c) => /["“”]/.test(c.content)).map((c) => c.content).slice(0, 8),
    products,
    imageryPatterns,
    iconographyPatterns,
    visualMotifs,
    navigationPatterns: navLabels,
    ctaPatterns,
    contentPatterns,
    sectionPatterns,
    screenshotAnalysis,
    brandVoice,
    forbiddenPhrases: FORBIDDEN_GENERIC_PHRASES,
  });
}

function normalizeCopyKey(s: string) {
  return cleanBrandText(s).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function cleanBrandText(s: string) {
  const targeted: Array<[RegExp, string]> = [
    [/\bnavigatefrom\b/gi, "navigate from"],
    [/\bideato\b/gi, "idea to"],
    [/\bfromintent\b/gi, "from intent"],
    [/\bproductoperations\b/gi, "product operations"],
    [/\bproductdevelopment\b/gi, "product development"],
    [/\bproductplanning\b/gi, "product planning"],
    [/\bplanningandbuilding\b/gi, "planning and building"],
    [/\bbuildingproducts\b/gi, "building products"],
    [/\bwayto\b/gi, "way to"],
    [/\bforwardacross\b/gi, "forward across"],
    [/\bworkacross\b/gi, "work across"],
    [/\bunderstandcustomer\b/gi, "understand customer"],
    [/\bcustomerrequests\b/gi, "customer requests"],
    [/\bcustomerissues\b/gi, "customer issues"],
    [/\bacrossagents\b/gi, "across agents"],
    [/\bwithagents\b/gi, "with agents"],
    [/\bagentsand\b/gi, "agents and"],
    [/\bautocreate\b/gi, "auto-create"],
    [/\bautoassign\b/gi, "auto-assign"],
  ];
  let out = String(s ?? "");
  for (const [pattern, replacement] of targeted) out = out.replace(pattern, replacement);
  return out.replace(/\.{3,}/g, "").replace(/\s+/g, " ").trim();
}

function looksLikeLogoOrProperName(s: string) {
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  const hasDomainVerb = /\b(create|review|plan|move|make|define|understand|automate|build|launch|triage|sync|manage)\b/i.test(s);
  if (hasDomainVerb) return false;
  return words.every((w) => /^[A-Z0-9][A-Za-z0-9]+$/.test(w) || /^[A-Z0-9]{2,}$/.test(w));
}

function isUsefulCtaLabel(s: string) {
  const key = normalizeCopyKey(s);
  if (!key || key.length < 3) return false;
  if (
    /^(product|products|features|company|resources|legal|more|favorites|workspace|projects|initiatives|inbox|reviews|pulse|my issues|linear)$/i.test(
      s,
    )
  ) {
    return false;
  }
  return /\b(open|sign|contact|talk|demo|sales|try|start|book|download|view|learn|apply|join|send|submit)\b/i.test(s);
}

async function analyzeBrandVoice(ev: Evidence, dna: DesignDna): Promise<BrandVoice> {
  const heuristic = heuristicBrandVoice(ev, dna);
  if (!aiFeatures.ai || ev.content.length < 4) return heuristic;
  const sample = ev.content.slice(0, 80).map((c) => `[${c.type}] ${c.content}`).join("\n");
  try {
    const v = await structured(
      BrandVoiceSchema,
      `Analyze the BRAND VOICE from this real copy harvested from the product's site. Return the schema JSON.
Determine tone, readingLevel, sentenceLength, emotionalIntensity, technicalDepth, conversionStyle, trustSignals, and the recurring brand vocabulary.
=== COPY ===
${sample}`,
      { system: "You are a brand-voice analyst. Be precise and decisive. JSON only.", maxTokens: 1500, temperature: 0.2 },
    );
    return { ...v, source: "ai" };
  } catch {
    return heuristic;
  }
}

async function analyzeScreenshots(ev: Evidence, dna: DesignDna): Promise<ScreenshotAnalysis> {
  const heuristic = heuristicScreenshotAnalysis(ev, dna);
  if (!aiFeatures.ai) return heuristic;
  const images = await loadImages(ev);
  if (!images.length) return heuristic;
  try {
    const a = await structured(
      ScreenshotAnalysisSchema,
      `Analyze these product screenshots. Determine: visualStyle, imageryStyle, compositionStyle, productPresentationStyle (how products/screenshots are framed/shown), screenshotPurpose, visualHierarchy, decorativePatterns. JSON only.`,
      { system: "You are a visual brand analyst. JSON only.", images, maxTokens: 1500, temperature: 0.2 },
    );
    return { ...a, source: "vision" };
  } catch {
    return heuristic;
  }
}
