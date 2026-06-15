import type { Evidence, ColorDecision as EvColorDecision } from "@/lib/extraction/evidence";
import {
  DesignDnaSchema,
  type DesignDna,
  type VisualBrandAnalysis,
  type BrandPersonality,
} from "./schema";
import { heuristicVisualAnalysis } from "./visual";

/**
 * Builds a complete, valid Design DNA from observed Evidence + a Visual Brand
 * Analysis. Colors come from VISUAL IMPORTANCE (evidence.colorRoles), every
 * color decision carries evidence, components carry variant fingerprints, and a
 * confidence report explains grounded-vs-inferred. Visual analysis outranks CSS.
 */

const px = (v: string) => {
  const m = v.match(/(-?\d+(\.\d+)?)px/);
  return m ? parseFloat(m[1]) : NaN;
};

function saturation(hex: string): number {
  const m = hex.replace("#", "");
  if (m.length < 6) return 0;
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

const scaleToNum: Record<string, number> = {
  "very-low": 0.1,
  low: 0.3,
  medium: 0.5,
  high: 0.7,
  "very-high": 0.9,
};

export function buildDeterministicDna(ev: Evidence, visual?: VisualBrandAnalysis): DesignDna {
  const va = visual ?? heuristicVisualAnalysis(ev);
  const cr = ev.colorRoles;

  // --- colors from importance + evidence ---
  const val = (d?: EvColorDecision) => d?.value;
  const primary = val(cr.primary);
  const secondary = val(cr.secondary);
  const accent = val(cr.accent);
  const cta = val(cr.cta) ?? primary;
  const background = val(cr.background) ?? (cr.mode === "dark" ? "#0a0a0a" : "#ffffff");
  const surface = val(cr.surface) ?? background;
  const border = val(cr.border);
  const text = val(cr.text) ?? (cr.mode === "dark" ? "#fafafa" : "#0a0a0a");

  const decisions = {
    primary: cr.primary,
    secondary: cr.secondary,
    accent: cr.accent,
    cta: cr.cta,
    ctaText: cr.ctaText,
    background: cr.background,
    surface: cr.surface,
    border: cr.border,
    text: cr.text,
  };

  // tokens: semantic decisions first, then distinct dominant colors
  const tokenSet = new Map<string, { value: string; role: string; usage: string }>();
  const addTok = (name: string, v?: string, usage = "") => {
    if (v && !tokenSet.has(name)) tokenSet.set(name, { value: v, role: name, usage });
  };
  addTok("primary", primary, cr.primary?.evidence.join(", "));
  addTok("secondary", secondary, cr.secondary?.evidence.join(", "));
  addTok("accent", accent, cr.accent?.evidence.join(", "));
  addTok("cta", cta, cr.cta?.evidence.join(", "));
  addTok("background", background, "page background");
  addTok("surface", surface, "cards / surfaces");
  addTok("border", border, "borders");
  addTok("text", text, "body text");
  const colorTokens = Array.from(tokenSet.entries()).map(([name, t]) => ({ name, value: t.value, role: t.role, usage: t.usage }));

  const dominant = ev.colors.slice(0, 6).map((c) => c.color);
  const neutrals = [background, surface, border, text].filter(Boolean) as string[];

  // --- typography ---
  const headingFont = ev.fonts.find((f) => f.roles.includes("heading")) ?? ev.fonts[0];
  const bodyFont = ev.fonts.find((f) => f.roles.includes("body")) ?? ev.fonts[0];
  const monoFont = ev.fonts.find((f) => /mono|code/i.test(f.family));
  const fontEntries: DesignDna["typography"]["fonts"] = [];
  if (headingFont) fontEntries.push({ family: headingFont.family, role: "heading", weights: headingFont.weights, source: "custom" });
  if (bodyFont && bodyFont.family !== headingFont?.family)
    fontEntries.push({ family: bodyFont.family, role: "body", weights: bodyFont.weights, source: "custom" });
  if (monoFont) fontEntries.push({ family: monoFont.family, role: "mono", weights: monoFont.weights });
  if (!fontEntries.length) fontEntries.push({ family: "system-ui", role: "body", weights: ["400", "600"] });

  const roleStyle = (sel: string) => ev.styleByRole[sel] ?? {};
  const mkType = (role: string, sel: string): DesignDna["typography"]["scale"][number] => {
    const s = roleStyle(sel);
    return {
      role,
      fontFamily: String(s.fontFamily ?? bodyFont?.family ?? "system-ui"),
      fontSize: String(s.fontSize ?? "16px"),
      fontWeight: String(s.fontWeight ?? "400"),
      lineHeight: s.lineHeight ? String(s.lineHeight) : undefined,
      letterSpacing: s.letterSpacing ? String(s.letterSpacing) : undefined,
    };
  };
  const scale = [mkType("h1", "h1"), mkType("h2", "h2"), mkType("h3", "h3"), mkType("body", "p"), mkType("button", "button")];
  const bodySel = roleStyle("p");
  const alignment = ((): "left" | "center" | "right" | "justify" => {
    const a = String(bodySel.textAlign ?? "left");
    if (a === "center" || a === "right" || a === "justify") return a;
    if (a === "end") return "right";
    return "left";
  })();

  // --- spacing ---
  const spacingPx = ev.spacing.map((s) => px(s.value)).filter((n) => !isNaN(n) && n > 0);
  const unit = spacingPx.length ? Math.max(2, Math.min(...spacingPx.filter((n) => n >= 2))) : 4;
  const scaleSpacing = Array.from(new Set(ev.spacing.map((s) => s.value))).slice(0, 10);
  // density: prefer VISUAL judgment over CSS
  const density = scaleToNum[va.layoutDensity] > 0.6 ? "high" : scaleToNum[va.layoutDensity] < 0.35 ? "low" : "medium";

  // --- layout ---
  const containers = ev.containers.map((c) => `${c}px`);
  const maxContent = ev.containers.length ? `${ev.containers[0]}px` : "1200px";
  const desktopCols = Math.max(...(ev.responsive.desktopColumns.length ? ev.responsive.desktopColumns : [12]));

  // --- components from variant fingerprints ---
  const components: DesignDna["components"] = ev.components.map((c) => {
    const top = c.variants[0];
    return {
      type: c.type,
      variants: c.variants.map((v, i) => ({
        name: `${c.type}-${i + 1}`,
        description: `radius ${v.radius ?? "?"}, ${v.height ? `height ${v.height}, ` : ""}weight ${v.fontWeight ?? "?"}`,
        usageCount: v.usageCount,
        radius: v.radius,
        height: v.height,
        fontWeight: v.fontWeight,
        fontSize: v.fontSize,
        padding: v.padding,
        background: v.background,
        color: v.color,
        border: v.border,
        shadow: v.boxShadow,
      })),
      structure: `${c.variants.length} variant(s); most used: radius ${top?.radius ?? "?"}, weight ${top?.fontWeight ?? "?"}, used ${top?.usageCount ?? 0}×`,
      radius: top?.radius,
      shadow: top?.boxShadow && top.boxShadow !== "none" ? top.boxShadow : undefined,
      border: top?.border && top.border !== "none" ? top.border : undefined,
      background: top?.background,
      spacing: top?.padding,
    };
  });

  // --- sections from fingerprints ---
  const sections: DesignDna["sections"] = ev.sections.map((s) => {
    const f = s.fingerprint;
    return {
      type: s.type,
      frequency: s.frequency,
      structure: `${f.tag} · ${f.columns} col · ${f.headingCount} headings · ${f.imageCount} images · ${f.buttonCount} buttons`,
      layout: f.columns >= 2 ? `grid-${f.columns}` : "stacked",
      contentSlots: [],
      fingerprint: {
        columns: f.columns,
        headingCount: f.headingCount,
        paragraphCount: f.paragraphCount,
        imageCount: f.imageCount,
        buttonCount: f.buttonCount,
        listItemCount: f.listItemCount,
        hasForm: f.hasForm,
        hasTable: f.hasTable,
        hasCurrency: f.hasCurrency,
        hasBigNumbers: f.hasBigNumbers,
        hasCheckmarks: f.hasCheckmarks,
      },
      evidence: s.evidence,
    };
  });

  // --- brand personality (from visual analysis, problem 5) ---
  const brandPersonality: BrandPersonality = va.brandPersonality;

  // --- philosophy: visual-led ---
  const minimalToExpressive = va.minimalVsExpressive;
  const corporateToStartup = va.corporateVsStartup;
  const denseToSpacious = 1 - scaleToNum[va.layoutDensity];
  const massToPremium = scaleToNum[va.premiumLevel];

  // --- confidence report (problem 8) ---
  const grounded: string[] = [];
  const inferred: string[] = [];
  if (cr.primary) grounded.push(`primary ${cr.primary.value} from ${cr.primary.evidence.join(" + ") || "attention elements"}`);
  if (cr.cta) grounded.push(`cta ${cr.cta.value} from ${cr.cta.evidence.join(" + ") || "CTA elements"}`);
  if (ev.fonts.length) grounded.push(`fonts: ${ev.fonts.slice(0, 2).map((f) => f.family).join(", ")}`);
  if (ev.containers.length) grounded.push(`containers ${containers.slice(0, 3).join(", ")}`);
  if (components.length) grounded.push(`${components.length} component types with ${components.reduce((n, c) => n + c.variants.length, 0)} variants`);
  if (sections.length) grounded.push(`${sections.length} section types: ${sections.slice(0, 6).map((s) => s.type).join(", ")}`);
  if (cr.ignored.length) grounded.push(`excluded ${cr.ignored.length} WP/neutral colors from brand`);
  inferred.push(`brand personality (${va.source})`);
  inferred.push("philosophy axes calibrated from visual analysis");
  if (!cr.secondary) inferred.push("no clear secondary color — left empty");

  const visualConfidence = va.source === "vision" ? 0.85 : 0.4;
  let structuralConfidence = 0.3;
  if (ev.colorRoles.primary) structuralConfidence += 0.15;
  if (ev.fonts.length) structuralConfidence += 0.12;
  if (ev.containers.length) structuralConfidence += 0.1;
  if (sections.length >= 4) structuralConfidence += 0.18;
  if (components.some((c) => c.variants.length)) structuralConfidence += 0.15;
  structuralConfidence = Math.min(1, structuralConfidence);
  const overallConfidence = Math.round((visualConfidence * 0.45 + structuralConfidence * 0.55) * 100) / 100;

  const dna: DesignDna = {
    designPhilosophy: {
      minimalToExpressive,
      massToPremium,
      corporateToStartup,
      formalToFriendly: scaleToNum[va.playfulness],
      denseToSpacious,
      traditionalToModern: Object.keys(ev.cssVariables).length > 30 ? 0.8 : 0.6,
      summary: `${cr.mode === "dark" ? "Dark" : "Light"} ${va.brandPersonality.visualStyle} interface; ${va.layoutDensity} density, ${va.whitespaceUsage} whitespace; ${va.premiumLevel} premium.`,
      keywords: [cr.mode, va.brandPersonality.visualStyle, `${va.layoutDensity}-density`, `${va.premiumLevel}-premium`].filter(Boolean),
    },
    brandPersonality,
    visualAnalysis: va,
    colors: {
      tokens: colorTokens,
      decisions,
      ignored: cr.ignored,
      primary: primary ? [primary] : [],
      secondary: secondary ? [secondary] : [],
      accent: accent ? [accent] : [],
      surfaces: surface ? [surface] : [],
      backgrounds: background ? [background] : [],
      borders: border ? [border] : [],
      neutrals,
      dominant,
      cta: cta ? [cta] : [],
      hero: [primary, accent].filter(Boolean) as string[],
      mode: cr.mode,
    },
    typography: {
      fonts: fontEntries,
      scale,
      baseSize: String(bodySel.fontSize ?? "16px"),
      paragraphMaxWidth: "65ch",
      defaultAlignment: alignment,
    },
    spacing: {
      unit,
      scale: scaleSpacing.length ? scaleSpacing : ["4px", "8px", "16px", "24px", "32px", "48px", "64px"],
      sectionSpacing: ev.sectionPaddings.slice(0, 6).map((p) => p.split("/")[0]),
      density,
      gap: ev.spacing.slice(0, 4).map((s) => s.value),
    },
    layout: {
      containers: containers.length ? containers : ["1200px"],
      maxContentWidth: maxContent,
      gridSystems: ev.grids.slice(0, 6),
      columns: isFinite(desktopCols) ? desktopCols : 12,
      responsive: {
        breakpoints: ["640px", "768px", "1024px", "1280px"],
        mobileColumns: 1,
        tabletColumns: 2,
        notes: `columns mobile:${ev.responsive.mobileColumns.join(",")} tablet:${ev.responsive.tabletColumns.join(",")} desktop:${ev.responsive.desktopColumns.join(",")}`,
      },
    },
    components,
    sections,
    visualRules: {
      whitespace: va.whitespaceUsage,
      visualRhythm: va.visualRhythm,
      hierarchy: va.visualHierarchy,
      contentDensity: va.layoutDensity,
      alignment: va.alignmentStyle,
      composition: "Centered max-width container with full-bleed section backgrounds.",
      imagery: "Product UI and supporting graphics within sections.",
      decorativeElements: minimalToExpressive > 0.5 ? "Color accents and gradients." : "Minimal decoration; relies on type and spacing.",
      motion: "Subtle entrance and hover transitions.",
      cornerStyle: radiusStyle(ev),
      shadowStyle: ev.shadows.length ? "subtle" : "none",
    },
    confidenceReport: {
      groundedData: grounded,
      inferredData: inferred,
      visualConfidence,
      structuralConfidence,
      overallConfidence,
      explanations: [
        `Brand colors inferred by visual importance (CTA/nav/hero/links), not frequency. ${cr.ignored.length} editor/neutral colors excluded.`,
        `Visual analysis source: ${va.source} (vision outranks CSS).`,
        `${sections.length} distinct section types detected with structural fingerprints.`,
      ],
    },
    screenshots: ev.screenshots.map((s) => ({ key: s.key, kind: s.kind, label: s.label })),
    provenance: {
      sources: va.source === "vision" ? ["playwright", "vision"] : ["playwright"],
      confidence: overallConfidence,
      notes: visual ? "Synthesized with visual analysis." : "Deterministic extraction (heuristic visual).",
    },
  };

  return DesignDnaSchema.parse(dna);
}

function radiusStyle(ev: Evidence): DesignDna["visualRules"]["cornerStyle"] {
  const vals = ev.radii.map((r) => px(r.value)).filter((n) => !isNaN(n));
  // also consider button/card variant radii
  for (const c of ev.components) for (const v of c.variants) {
    const n = px(v.radius ?? "");
    if (!isNaN(n)) vals.push(n);
  }
  if (!vals.length) return "subtle";
  const max = Math.max(...vals);
  if (max >= 999) return "pill";
  if (max >= 16) return "rounded";
  if (max <= 2) return "sharp";
  return "subtle";
}

// kept exported for callers that referenced saturation previously
export { saturation };
