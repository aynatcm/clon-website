import type {
  CrawlBundle,
  CrawledPage,
  ColorSignal,
  SectionFingerprint,
  ComponentVariant,
} from "@/lib/crawler/types";
import type { CssAnalysis } from "./css";
import { mergeCssAnalyses } from "./css";

/**
 * Phase 5 — deterministic evidence aggregation (v2). Color is inferred from
 * VISUAL IMPORTANCE (where it appears) instead of raw frequency; WordPress /
 * Gutenberg / rare / neutral colors are excluded from brand inference. Sections
 * and components are aggregated as structural fingerprints with frequency.
 *
 * Every chosen color carries an EVIDENCE trail (the places it was observed).
 */

export interface ColorDecision {
  value: string;
  weight: number;
  evidence: string[]; // human-readable provenance
  confidence: number; // 0..1
}

export interface ColorRoles {
  primary?: ColorDecision;
  secondary?: ColorDecision;
  accent?: ColorDecision;
  cta?: ColorDecision;
  ctaText?: ColorDecision;
  background?: ColorDecision;
  surface?: ColorDecision;
  border?: ColorDecision;
  text?: ColorDecision;
  mode: "light" | "dark";
  ignored: string[]; // wp/gutenberg/neutral colors excluded from brand
}

export interface SectionEvidence {
  type: string;
  frequency: number;
  fingerprint: SectionFingerprint; // representative
  evidence: string[];
}

export interface ComponentEvidence {
  type: string; // button | card | input | nav | badge
  variants: ComponentVariant[];
}

export interface Evidence {
  startUrl: string;
  pageCount: number;
  titles: string[];
  // Importance-driven semantic color roles (the brand color fix).
  colorRoles: ColorRoles;
  // Legacy frequency colors (still useful as a secondary signal).
  colors: Array<{ color: string; count: number; roles: string[] }>;
  fonts: Array<{ family: string; weights: string[]; sizes: string[]; roles: string[]; count: number }>;
  styleByRole: Record<string, Record<string, string | number>>;
  spacing: Array<{ value: string; count: number }>;
  radii: Array<{ value: string; count: number }>;
  shadows: Array<{ value: string; count: number }>;
  containers: number[];
  grids: string[];
  cssVariables: Record<string, string>;
  // Advanced section + component fingerprints.
  sections: SectionEvidence[];
  components: ComponentEvidence[];
  // Legacy block-by-type (kept for back-compat consumers).
  blocksByType: Array<{ type: string; count: number; sample: SectionFingerprint }>;
  responsive: { mobileColumns: number[]; tabletColumns: number[]; desktopColumns: number[] };
  sectionPaddings: string[];
  contentHints: { headings: string[]; ctas: string[] };
  screenshots: Array<{ key: string; kind: string; label: string; pageUrl: string }>;
}

// --- color math (Node side) ---
function rgb(hex: string): [number, number, number] | null {
  const m = hex.replace("#", "");
  if (m.length < 6) return null;
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
function saturation(hex: string): number {
  const c = rgb(hex);
  if (!c) return 0;
  const max = Math.max(...c);
  const min = Math.min(...c);
  return max === 0 ? 0 : (max - min) / max;
}
function luminance(hex: string): number {
  const c = rgb(hex);
  if (!c) return 0.5;
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}
function hue(hex: string): number {
  const c = rgb(hex);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
function hueDistinct(a: string, b: string): boolean {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d) > 35;
}

const ROLE_LABEL: Record<string, string> = {
  "cta-bg": "CTA button background",
  cta: "CTA button text",
  nav: "navigation",
  hero: "hero section",
  heading: "headings",
  link: "links",
  interactive: "interactive elements",
  button: "buttons",
  icon: "icons",
  border: "borders",
  surface: "surfaces / cards",
  background: "page background",
  text: "body text",
  decorative: "decorative elements",
};

/** Infer semantic brand colors from importance-weighted signals + evidence. */
function inferColorRoles(signals: ColorSignal[], wpColors: string[]): ColorRoles {
  const wp = new Set(wpColors);
  const clean = signals.filter((s) => !s.wp && !wp.has(s.color) && s.color);

  // total weight per color (across roles), plus per-role weight + role set
  const byColor = new Map<string, { weight: number; roles: Map<string, number>; area: number }>();
  for (const s of clean) {
    const e = byColor.get(s.color) ?? { weight: 0, roles: new Map(), area: 0 };
    e.weight += s.weight;
    e.area += s.area;
    e.roles.set(s.role, (e.roles.get(s.role) ?? 0) + s.weight);
    byColor.set(s.color, e);
  }

  const evidenceFor = (color: string): string[] => {
    const e = byColor.get(color);
    if (!e) return [];
    return Array.from(e.roles.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([r]) => ROLE_LABEL[r] ?? r)
      .slice(0, 5);
  };

  const mk = (color: string): ColorDecision => {
    const e = byColor.get(color);
    const w = e?.weight ?? 0;
    const ev = evidenceFor(color);
    // Confidence reflects breadth of evidence (how many attention roles agree),
    // not raw painted area — a brand color seen on the CTA + nav is high-confidence
    // even though structural greys cover more pixels.
    const confidence = Math.min(1, 0.4 + ev.length * 0.15);
    return { value: color, weight: Math.round(w * 100) / 100, evidence: ev, confidence };
  };

  // brand candidates = SATURATED, non-extreme colors seen in attention roles.
  // Near-black / near-white are never brand colors (they're structural).
  const ATTENTION = new Set(["cta-bg", "cta", "nav", "hero", "heading", "link", "interactive", "button"]);
  const isBrandable = (c: string) => {
    const l = luminance(c);
    return saturation(c) >= 0.28 && l > 0.06 && l < 0.95;
  };
  const brandCandidates = Array.from(byColor.entries())
    .filter(([c, v]) => isBrandable(c) && Array.from(v.roles.keys()).some((r) => ATTENTION.has(r)))
    .map(([c, v]) => ({ color: c, weight: v.weight }))
    .sort((a, b) => b.weight - a.weight);

  // CTA background: strongest cta-bg color (saturated preferred), else top brand
  const ctaBg = Array.from(byColor.entries())
    .filter(([c, v]) => v.roles.has("cta-bg") && saturation(c) >= 0.12)
    .sort((a, b) => (b[1].roles.get("cta-bg") ?? 0) - (a[1].roles.get("cta-bg") ?? 0))
    .map(([c]) => c)[0];

  // Prefer a vivid CTA background; if the CTA bg is dull, prefer the strongest
  // brandable attention color instead (avoids picking a dark/near-grey button).
  const primaryColor = ctaBg && isBrandable(ctaBg) ? ctaBg : brandCandidates[0]?.color ?? ctaBg;
  const secondaryColor = brandCandidates.find((b) => b.color !== primaryColor && hueDistinct(b.color, primaryColor ?? b.color))?.color;
  const accentColor = brandCandidates.find(
    (b) => b.color !== primaryColor && b.color !== secondaryColor && saturation(b.color) >= 0.45,
  )?.color;

  // CTA text color = text role observed on CTAs
  const ctaText = clean.filter((s) => s.role === "cta").sort((a, b) => b.weight - a.weight)[0]?.color;

  // structural: background (largest-area, low-sat), surface, border, text
  const byRoleArea = (role: string) =>
    clean
      .filter((s) => s.role === role)
      .reduce((m, s) => m.set(s.color, (m.get(s.color) ?? 0) + s.area), new Map<string, number>());
  const topByArea = (m: Map<string, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

  const background = topByArea(byRoleArea("background")) ?? topByArea(byRoleArea("surface"));
  const surface = topByArea(byRoleArea("surface"));
  const border = topByArea(byRoleArea("border"));
  const text = topByArea(byRoleArea("text"));

  const mode: "light" | "dark" = background ? (luminance(background) < 0.4 ? "dark" : "light") : "light";

  const ignored = Array.from(new Set([...wpColors, ...signals.filter((s) => s.wp).map((s) => s.color)])).slice(0, 20);

  return {
    primary: primaryColor ? mk(primaryColor) : undefined,
    secondary: secondaryColor ? mk(secondaryColor) : undefined,
    accent: accentColor ? mk(accentColor) : undefined,
    cta: (ctaBg ?? primaryColor) ? mk(ctaBg ?? primaryColor!) : undefined,
    ctaText: ctaText ? mk(ctaText) : undefined,
    background: background ? mk(background) : undefined,
    surface: surface ? mk(surface) : undefined,
    border: border ? mk(border) : undefined,
    text: text ? mk(text) : undefined,
    mode,
    ignored,
  };
}

function topN<T extends { count: number }>(arr: T[], n: number): T[] {
  return [...arr].sort((a, b) => b.count - a.count).slice(0, n);
}

export function buildEvidence(bundle: CrawlBundle, cssParts: CssAnalysis[]): Evidence {
  const css = mergeCssAnalyses(cssParts);

  // --- color: importance-weighted roles ---
  const allSignals: ColorSignal[] = [];
  const wpColors = new Set<string>();
  for (const p of bundle.pages) {
    allSignals.push(...(p.extract.colorSignals ?? []));
    (p.extract.wpColors ?? []).forEach((c) => wpColors.add(c));
  }
  const colorRoles = inferColorRoles(allSignals, Array.from(wpColors));

  // --- legacy frequency colors (secondary signal) ---
  const colorMap = new Map<string, { count: number; roles: Set<string> }>();
  for (const p of bundle.pages) {
    for (const c of p.extract.colors) {
      const e = colorMap.get(c.color) ?? { count: 0, roles: new Set<string>() };
      e.count += c.count;
      c.roles.forEach((r) => e.roles.add(r));
      colorMap.set(c.color, e);
    }
  }
  const colors = topN(
    Array.from(colorMap.entries()).map(([color, v]) => ({ color, count: v.count, roles: Array.from(v.roles) })),
    30,
  );

  // --- fonts ---
  const fontMap = new Map<string, { weights: Set<string>; sizes: Set<string>; roles: Set<string>; count: number }>();
  for (const p of bundle.pages) {
    for (const f of p.extract.fonts) {
      const e = fontMap.get(f.family) ?? { weights: new Set<string>(), sizes: new Set<string>(), roles: new Set<string>(), count: 0 };
      f.weights.forEach((w) => e.weights.add(w));
      f.sampleSizes.forEach((s) => e.sizes.add(s));
      f.roles.forEach((r) => e.roles.add(r));
      e.count += f.count;
      fontMap.set(f.family, e);
    }
  }
  const fonts = topN(
    Array.from(fontMap.entries()).map(([family, v]) => ({
      family,
      weights: Array.from(v.weights),
      sizes: Array.from(v.sizes),
      roles: Array.from(v.roles),
      count: v.count,
    })),
    8,
  );

  // --- style samples per selector ---
  const styleByRole: Record<string, Record<string, string | number>> = {};
  for (const p of bundle.pages) {
    for (const s of p.extract.styleSamples) {
      if (!styleByRole[s.selector]) {
        const { selector, count, ...rest } = s;
        void selector;
        void count;
        styleByRole[s.selector] = rest as Record<string, string | number>;
      }
    }
  }

  // --- spacing / radii / shadows ---
  const spacing = topN(Object.entries(css.spacing).map(([value, count]) => ({ value, count })), 16);
  const radii = topN(Object.entries(css.radii).map(([value, count]) => ({ value, count })), 12);
  const shadows = topN(Object.entries(css.shadows).map(([value, count]) => ({ value, count })), 12);

  // --- layout ---
  const containerSet = new Set<number>();
  const gridSet = new Set<string>();
  const sectionPad = new Set<string>();
  for (const p of bundle.pages) {
    p.extract.layout.containerWidths.forEach((w) => containerSet.add(w));
    p.extract.layout.gridTemplates.forEach((g) => gridSet.add(g));
    p.extract.layout.sectionPaddings.forEach((s) => sectionPad.add(s));
  }

  // --- sections: aggregate fingerprints by type ---
  const secMap = new Map<string, { count: number; sample: SectionFingerprint; evidence: Set<string> }>();
  for (const p of bundle.pages) {
    for (const f of p.extract.sectionFingerprints ?? []) {
      const e = secMap.get(f.type);
      const ev = `${f.tag}.${f.classes.split(/\s+/)[0] || ""} (${f.columns}col, ${f.headingCount}h/${f.imageCount}img)`;
      if (e) {
        e.count++;
        e.evidence.add(ev);
      } else {
        secMap.set(f.type, { count: 1, sample: f, evidence: new Set([ev]) });
      }
    }
  }
  const sections: SectionEvidence[] = Array.from(secMap.entries())
    .map(([type, v]) => ({ type, frequency: v.count, fingerprint: v.sample, evidence: Array.from(v.evidence).slice(0, 4) }))
    .sort((a, b) => b.frequency - a.frequency);

  // --- components: merge variants by signature across pages ---
  const compTypes: Array<keyof CrawledPage["extract"]["components"]> = ["button", "card", "input", "nav", "badge"];
  const components: ComponentEvidence[] = [];
  for (const type of compTypes) {
    const vmap = new Map<string, ComponentVariant>();
    for (const p of bundle.pages) {
      for (const v of p.extract.components?.[type] ?? []) {
        const ex = vmap.get(v.signature);
        if (ex) ex.usageCount += v.usageCount;
        else vmap.set(v.signature, { ...v });
      }
    }
    const variants = Array.from(vmap.values()).sort((a, b) => b.usageCount - a.usageCount).slice(0, 8);
    if (variants.length) components.push({ type, variants });
  }

  // legacy block-by-type from sections
  const blocksByType = sections.map((s) => ({ type: s.type, count: s.frequency, sample: s.fingerprint }));

  const collectCols = (vp: "mobile" | "tablet" | "desktop") => {
    const cols = new Set<number>();
    for (const p of bundle.pages) p.extract.responsive[vp]?.columns.forEach((c) => cols.add(c));
    return Array.from(cols).sort((a, b) => a - b);
  };

  const headings = new Set<string>();
  const ctas = new Set<string>();
  for (const p of bundle.pages) {
    for (const f of p.extract.sectionFingerprints ?? []) {
      if ((f.type === "cta" || f.type === "hero" || f.type === "footer-cta") && f.textSample) headings.add(f.textSample.slice(0, 80));
    }
  }

  const cssVariables: Record<string, string> = { ...css.customProperties };
  for (const p of bundle.pages) Object.assign(cssVariables, p.extract.cssVariables);

  const screenshots = bundle.pages.flatMap((p: CrawledPage) =>
    p.screenshots.map((s) => ({ key: s.storageKey, kind: s.kind, label: s.label, pageUrl: s.pageUrl })),
  );

  return {
    startUrl: bundle.startUrl,
    pageCount: bundle.pages.length,
    titles: bundle.pages.map((p) => p.extract.title || "").filter(Boolean),
    colorRoles,
    colors,
    fonts,
    styleByRole,
    spacing,
    radii,
    shadows,
    containers: Array.from(containerSet).sort((a, b) => b - a).slice(0, 12),
    grids: Array.from(gridSet).slice(0, 16),
    cssVariables,
    sections,
    components,
    blocksByType,
    responsive: { mobileColumns: collectCols("mobile"), tabletColumns: collectCols("tablet"), desktopColumns: collectCols("desktop") },
    sectionPaddings: Array.from(sectionPad).slice(0, 16),
    contentHints: { headings: Array.from(headings).slice(0, 20), ctas: Array.from(ctas).slice(0, 20) },
    screenshots,
  };
}
