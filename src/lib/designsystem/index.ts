import type { DesignDna } from "@/lib/dna/schema";
import { DesignSystemSchema, type DesignSystem } from "./schema";

/**
 * Phase 6 — derive a Design System (tokens + libraries + rules) and a
 * self-contained CSS stylesheet from the Design DNA. Deterministic: the system
 * is a faithful projection of the DNA so generated pages stay continuous.
 */

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)));
}

export function buildDesignSystem(dna: DesignDna): { system: DesignSystem; css: string } {
  // --- color tokens (semantic) ---
  const colors: Record<string, string> = {};
  const pick = (name: string, vals: string[]) => {
    vals.forEach((v, i) => {
      colors[i === 0 ? name : `${name}-${i + 1}`] = v;
    });
  };
  pick("primary", dna.colors.primary);
  pick("secondary", dna.colors.secondary);
  pick("accent", dna.colors.accent);
  pick("cta", dna.colors.cta);
  pick("surface", dedupe(dna.colors.surfaces));
  pick("bg", dedupe(dna.colors.backgrounds));
  pick("border", dedupe(dna.colors.borders));
  pick("neutral", dedupe(dna.colors.neutrals));
  // Ensure foreground/background exist.
  const isDark = dna.colors.mode === "dark";
  colors["background"] = dna.colors.backgrounds[0] ?? (isDark ? "#0a0a0a" : "#ffffff");
  colors["foreground"] = dna.colors.neutrals.find((c) => (isDark ? true : true)) ?? (isDark ? "#fafafa" : "#0a0a0a");
  colors["text"] = (dna.colors.tokens.find((t) => t.role === "text")?.value) ?? colors["foreground"];

  // --- typography tokens ---
  const fonts: Record<string, string> = {};
  for (const f of dna.typography.fonts) {
    const stack = f.fallback ? `${f.family}, ${f.fallback}` : ensureStack(f.family);
    fonts[f.role] = stack;
  }
  if (!fonts["body"]) fonts["body"] = ensureStack(dna.typography.fonts[0]?.family ?? "system-ui");
  if (!fonts["heading"]) fonts["heading"] = fonts["body"];

  const fontSizes: Record<string, string> = {};
  const fontWeights: Record<string, string> = {};
  for (const t of dna.typography.scale) {
    fontSizes[t.role] = t.fontSize;
    fontWeights[t.role] = t.fontWeight;
  }
  if (!fontSizes["body"]) fontSizes["body"] = dna.typography.baseSize;

  // --- spacing / radii / shadows / containers ---
  const spacing: Record<string, string> = {};
  dna.spacing.scale.forEach((v, i) => (spacing[`${i + 1}`] = v));

  const radii: Record<string, string> = {};
  const compRadii = dedupe(dna.components.map((c) => c.radius ?? "").filter(Boolean));
  compRadii.slice(0, 4).forEach((v, i) => (radii[i === 0 ? "base" : `r-${i + 1}`] = v));
  if (!radii["base"]) {
    radii["base"] =
      dna.visualRules.cornerStyle === "pill"
        ? "9999px"
        : dna.visualRules.cornerStyle === "rounded"
          ? "16px"
          : dna.visualRules.cornerStyle === "sharp"
            ? "0px"
            : "8px";
  }

  const shadows: Record<string, string> = {};
  const compShadows = dedupe(dna.components.map((c) => c.shadow ?? "").filter(Boolean));
  compShadows.slice(0, 3).forEach((v, i) => (shadows[i === 0 ? "base" : `s-${i + 1}`] = v));
  if (!shadows["base"] && dna.visualRules.shadowStyle !== "none") {
    shadows["base"] = "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)";
  }

  const containers: Record<string, string> = {};
  dna.layout.containers.slice(0, 4).forEach((v, i) => (containers[i === 0 ? "max" : `c-${i + 1}`] = v));
  if (!containers["max"]) containers["max"] = dna.layout.maxContentWidth ?? "1200px";

  // --- component library (carry measured fingerprints) ---
  const components: DesignSystem["components"] = dna.components.map((c) => {
    const variants = (c.variants ?? []).map((v) => ({
      radius: v.radius,
      padding: v.padding,
      height: v.height,
      fontWeight: v.fontWeight,
      fontSize: v.fontSize,
      background: v.background,
      color: v.color,
      border: v.border && v.border !== "none" ? v.border : undefined,
      shadow: v.shadow && v.shadow !== "none" ? v.shadow : undefined,
      usageCount: v.usageCount ?? 0,
    }));
    // Buttons: pick the variant that looks like a REAL button (solid-ish, sized,
    // rounded) over a ghost nav text-link, even if the link is more frequent.
    let dominant =
      variants[0] ?? { radius: c.radius, padding: c.spacing, background: c.background, shadow: c.shadow, border: c.border, usageCount: 0 };
    if (c.type === "button" && variants.length) {
      const score = (v: (typeof variants)[number]) => {
        const h = parseFloat(v.height ?? "0") || 0;
        const r = parseFloat(v.radius ?? "0") || 0;
        const solid = v.background && v.background !== "rgba(0, 0, 0, 0)" && !/, 0\)/.test(v.background) ? 1 : 0;
        return (
          (v.usageCount ?? 0) * 0.5 +
          (h >= 32 && h <= 72 ? 30 : 0) +
          (r >= 4 ? 20 : 0) +
          solid * 25 +
          (parseInt(v.fontWeight ?? "400") >= 500 ? 10 : 0)
        );
      };
      dominant = [...variants].sort((a, b) => score(b) - score(a))[0];
    }
    return {
      name: titleCase(c.type),
      type: c.type,
      className: `dna-${c.type}`,
      description: c.structure,
      rules: dedupe([
        dominant.radius ? `radius: ${dominant.radius}` : "",
        dominant.shadow ? `shadow: ${dominant.shadow}` : "",
        dominant.background ? `background: ${dominant.background}` : "",
        dominant.padding ? `padding: ${dominant.padding}` : "",
        dominant.fontWeight ? `weight: ${dominant.fontWeight}` : "",
      ]),
      fingerprint: dominant,
      variants,
    };
  });

  // --- layout library (carry structural fingerprints, the source of truth) ---
  const layouts: DesignSystem["layouts"] = dna.sections.map((s) => {
    const fp = s.fingerprint ?? {};
    const columns = Math.max(1, fp.columns ?? 1);
    const hasMedia = (fp.imageCount ?? 0) > 0;
    const hasForm = !!fp.hasForm;
    const { variant, itemCount } = resolveLayoutVariant(s.type, columns, hasMedia, hasForm, fp.buttonCount ?? 0);
    return {
      name: titleCase(s.type),
      type: s.type,
      structure: s.structure,
      contentSlots: s.contentSlots,
      variant,
      columns,
      hasMedia,
      hasForm,
      itemCount,
      frequency: s.frequency,
    };
  });

  // --- rules ---
  const rules: DesignSystem["rules"] = {
    design: [
      dna.designPhilosophy.summary,
      `Personality: ${dna.designPhilosophy.keywords.join(", ")}`,
      "Prioritize visual continuity over creativity; this is design-language extension.",
    ],
    visual: [
      `Whitespace: ${dna.visualRules.whitespace}`,
      `Rhythm: ${dna.visualRules.visualRhythm}`,
      `Hierarchy: ${dna.visualRules.hierarchy}`,
      `Composition: ${dna.visualRules.composition}`,
      `Imagery: ${dna.visualRules.imagery}`,
      `Decoration: ${dna.visualRules.decorativeElements}`,
      `Corners: ${dna.visualRules.cornerStyle}; Shadows: ${dna.visualRules.shadowStyle}`,
    ],
    spacing: [
      `Base unit: ${dna.spacing.unit}px`,
      `Scale: ${dna.spacing.scale.join(", ")}`,
      `Density: ${dna.spacing.density}`,
      dna.spacing.sectionSpacing.length ? `Section spacing: ${dna.spacing.sectionSpacing.join(", ")}` : "",
    ].filter(Boolean),
    typography: [
      `Fonts: ${dna.typography.fonts.map((f) => `${f.family} (${f.role})`).join(", ")}`,
      `Base size: ${dna.typography.baseSize}`,
      `Paragraph width: ${dna.typography.paragraphMaxWidth ?? "65ch"}`,
      `Alignment: ${dna.typography.defaultAlignment}`,
      ...dna.typography.scale.map((t) => `${t.role}: ${t.fontSize}/${t.fontWeight}`),
    ],
    component: components.map((c) => `${c.name}: ${c.description}`.slice(0, 200)),
    layout: [
      `Max width: ${containers["max"]}`,
      `Columns: ${dna.layout.columns}`,
      `Breakpoints: ${dna.layout.responsive.breakpoints.join(", ")}`,
      dna.layout.gridSystems.length ? `Grids: ${dna.layout.gridSystems.slice(0, 3).join(" | ")}` : "",
    ].filter(Boolean),
  };

  const system = DesignSystemSchema.parse({
    tokens: { colors, fonts, fontSizes, fontWeights, spacing, radii, shadows, containers },
    components,
    layouts,
    rules,
  });

  const css = renderCss(system, dna);
  return { system, css };
}

/** Map a detected section type + fingerprint to a renderable structural variant. */
export function resolveLayoutVariant(
  type: string,
  columns: number,
  hasMedia: boolean,
  hasForm: boolean,
  buttonCount: number,
): { variant: DesignSystem["layouts"][number]["variant"]; itemCount: number } {
  const GRID_TYPES = [
    "feature-grid",
    "service-grid",
    "team-section",
    "stats",
    "pricing",
    "testimonials",
    "portfolio",
    "case-studies",
    "feature-comparison",
    "process-section",
    "trust-section",
  ];
  // Type-driven first so a nested newsletter/search input can't turn a hero or
  // grid into a "form". Form variant only for genuine contact/form sections.
  if (type === "footer") return { variant: "stacked", itemCount: 0 };
  if (type === "logo-cloud") return { variant: "logos", itemCount: Math.max(4, columns) };
  if (type === "hero" || type === "split-hero") {
    return columns >= 2 || hasMedia ? { variant: "split", itemCount: 0 } : { variant: "centered", itemCount: 0 };
  }
  if (type === "contact-section") return { variant: "form", itemCount: 0 };
  if (GRID_TYPES.includes(type) || columns >= 2) return { variant: "grid", itemCount: Math.min(6, Math.max(3, columns)) };
  if (type === "cta" || type === "footer-cta") return { variant: "centered", itemCount: 0 };
  if (hasForm) return { variant: "form", itemCount: 0 };
  if (hasMedia) return { variant: "media", itemCount: 0 };
  return { variant: "stacked", itemCount: 0 };
}

function ensureStack(family: string): string {
  if (family.includes(",")) return family;
  if (/mono|code/i.test(family)) return `"${family}", ui-monospace, SFMono-Regular, Menlo, monospace`;
  return `"${family}", -apple-system, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
}

function titleCase(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Self-contained CSS: variables + reset + base + component classes. */
function renderCss(system: DesignSystem, dna: DesignDna): string {
  const t = system.tokens;
  const v: string[] = [];
  for (const [k, val] of Object.entries(t.colors)) v.push(`  --color-${k}: ${val};`);
  for (const [k, val] of Object.entries(t.fonts)) v.push(`  --font-${k}: ${val};`);
  for (const [k, val] of Object.entries(t.fontSizes)) v.push(`  --fs-${k}: ${val};`);
  for (const [k, val] of Object.entries(t.fontWeights)) v.push(`  --fw-${k}: ${val};`);
  for (const [k, val] of Object.entries(t.spacing)) v.push(`  --space-${k}: ${val};`);
  for (const [k, val] of Object.entries(t.radii)) v.push(`  --radius-${k}: ${val};`);
  for (const [k, val] of Object.entries(t.shadows)) v.push(`  --shadow-${k}: ${val};`);
  for (const [k, val] of Object.entries(t.containers)) v.push(`  --container-${k}: ${val};`);

  const bg = t.colors["background"];
  const fg = t.colors["text"] ?? t.colors["foreground"];
  const heading = t.fonts["heading"];
  const body = t.fonts["body"];
  const radius = t.radii["base"];
  const shadow = t.shadows["base"] ?? "none";
  const ctaColor = t.colors["cta"] ?? t.colors["primary"] ?? t.colors["accent"];
  const decorColor = t.colors["secondary"] ?? t.colors["accent"] ?? t.colors["border"] ?? t.colors["primary"] ?? ctaColor;
  const maxW = t.containers["max"];

  // --- apply MEASURED component fingerprints (requirement 7) ---
  const comp = (type: string) => system.components.find((c) => c.type === type)?.fingerprint;
  const btn = comp("button");
  const card = comp("card");
  const inputFp = comp("input");

  // CTA button keeps brand color but inherits measured geometry.
  const btnRadius = btn?.radius && btn.radius !== "0px" ? btn.radius : radius;
  const btnPad = btn?.padding && /\d/.test(btn.padding) ? btn.padding : "0.75rem 1.5rem";
  const btnWeight = btn?.fontWeight ?? t.fontWeights["button"] ?? "600";
  const btnShadow = btn?.shadow ?? "none";

  const cardRadius = card?.radius && card.radius !== "0px" ? card.radius : radius === "9999px" ? "16px" : radius;
  const cardPad = hasMeaningfulPadding(card?.padding) ? card!.padding! : "clamp(1.25rem, 3vw, 2rem)";
  const cardBorder = card?.border ?? `1px solid ${t.colors["border"] ?? "rgba(0,0,0,0.08)"}`;
  const cardShadow = card?.shadow ?? shadow;
  const surfaceToken = t.colors["surface"] ?? bg;
  const safeSurface = dna.colors.mode === "dark" && colorLuminance(surfaceToken) > 0.42 ? "color-mix(in srgb, var(--color-text,#fff) 7%, var(--color-background,#08090a))" : surfaceToken;
  const cardBg = card?.background && card.background !== "rgba(0, 0, 0, 0)" ? card.background : safeSurface;

  const inputRadius = inputFp?.radius && inputFp.radius !== "0px" ? inputFp.radius : radius;
  const inputBorder = inputFp?.border ?? `1px solid ${t.colors["border"] ?? "#ccc"}`;

  return `:root {
${v.join("\n")}
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
body {
  margin: 0;
  background: ${bg};
  color: ${fg};
  font-family: ${body};
  font-size: ${t.fontSizes["body"] ?? "16px"};
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4 { font-family: ${heading}; line-height: 1.1; margin: 0 0 0.5em; }
h1 { font-size: ${t.fontSizes["h1"] ?? "clamp(2.5rem,5vw,4rem)"}; font-weight: ${t.fontWeights["h1"] ?? "700"}; }
h2 { font-size: ${t.fontSizes["h2"] ?? "clamp(2rem,4vw,3rem)"}; font-weight: ${t.fontWeights["h2"] ?? "650"}; }
h3 { font-size: ${t.fontSizes["h3"] ?? "1.5rem"}; font-weight: ${t.fontWeights["h3"] ?? "600"}; }
p { margin: 0 0 1em; max-width: ${dna.typography.paragraphMaxWidth ?? "65ch"}; }
a { color: inherit; text-decoration: none; }
img { max-width: 100%; display: block; }
.dna-container { width: 100%; max-width: ${maxW}; margin-inline: auto; padding-inline: clamp(1rem, 5vw, 2rem); }
.dna-section { padding-block: clamp(3rem, 8vw, ${dna.spacing.density === "high" ? "8rem" : "6rem"}); }
/* Buttons inherit measured radius/padding/weight/shadow (component fingerprint). */
.dna-button, .dna-cta {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  padding: ${btnPad}; border: 0; cursor: pointer;
  border-radius: ${btnRadius};
  background: ${ctaColor}; color: ${pickContrast(ctaColor)};
  font-family: ${body}; font-weight: ${btnWeight}; font-size: 1rem;
  box-shadow: ${btnShadow};
  transition: transform .15s ease, opacity .15s ease, box-shadow .15s ease;
}
.dna-button:hover, .dna-cta:hover { opacity: .92; transform: translateY(-1px); }
.dna-button--secondary {
  background: transparent; color: ${fg};
  border: 1px solid ${t.colors["border"] ?? "currentColor"};
  box-shadow: none;
}
/* Cards inherit measured spacing/radius/border/shadow (component fingerprint). */
.dna-card {
  background: ${cardBg};
  border: ${cardBorder};
  border-radius: ${cardRadius};
  box-shadow: ${cardShadow};
  padding: ${cardPad};
}
.dna-input {
  width: 100%; padding: 0.75rem 1rem; font: inherit;
  background: ${inputFp?.background && inputFp.background !== "rgba(0, 0, 0, 0)" ? inputFp.background : "transparent"};
  color: ${fg};
  border: ${inputBorder};
  border-radius: ${inputRadius};
}
.dna-eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: .8rem; font-weight: 600; opacity: .7; }
/* Layout structural patterns (preserved from detected layouts). */
.dna-grid { display: grid; gap: clamp(1rem, 3vw, 2rem); }
.dna-grid--2 { grid-template-columns: repeat(2, minmax(0,1fr)); }
.dna-grid--3 { grid-template-columns: repeat(3, minmax(0,1fr)); }
.dna-grid--4 { grid-template-columns: repeat(4, minmax(0,1fr)); }
.dna-grid--5 { grid-template-columns: repeat(5, minmax(0,1fr)); }
.dna-grid--6 { grid-template-columns: repeat(6, minmax(0,1fr)); }
/* Split layout: content area + visual area (preserves 2-column structure). */
.dna-split { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(2rem, 5vw, 4rem); align-items: center; }
.dna-split__content { min-width: 0; }
.dna-media-stack { display: grid; gap: clamp(1.5rem, 4vw, 3rem); }
.dna-media-stack__content { max-width: 760px; }
.dna-media-stack .dna-media { min-height: clamp(360px, 48vw, 680px); }
.dna-media {
  border-radius: ${cardRadius}; box-shadow: ${cardShadow};
  background: ${cardBg};
  min-height: 320px; width: 100%; overflow: hidden;
  border: 1px solid var(--color-border, rgba(127,127,127,.2));
  background-image: linear-gradient(135deg, ${decorColor}1a, transparent 70%);
  display: flex;
}
.dna-media--asset { padding: clamp(.75rem, 2vw, 1.25rem); align-items: center; justify-content: center; }
.dna-media__img { width: 100%; height: 100%; object-fit: cover; object-position: top center; display: block; border-radius: inherit; }
/* Inline visual artifact (dashboard / chart / code / UI panel) — fills media. */
.dna-mock { display: flex; flex-direction: column; width: 100%; font-family: ${body}; }
.dna-mock__bar { display: flex; align-items: center; gap: .5rem; padding: .6rem .8rem; border-bottom: 1px solid var(--color-border, rgba(127,127,127,.2)); }
.dna-mock__bar small { font-size: .72rem; opacity: .6; }
.dna-mock__dots { display: inline-flex; gap: 5px; }
.dna-mock__dots i { width: 9px; height: 9px; border-radius: 50%; background: var(--color-border, #999); opacity: .7; }
.dna-mock__dots i:first-child { background: ${decorColor}; opacity: .9; }
.dna-mock__body { display: flex; flex: 1; }
.dna-mock__side { width: 22%; padding: .8rem .6rem; display: flex; flex-direction: column; gap: .5rem; border-right: 1px solid var(--color-border, rgba(127,127,127,.2)); }
.dna-mock__side span { height: 8px; border-radius: 4px; background: var(--color-border, #999); opacity: .5; }
.dna-mock__side span:first-child { background: ${decorColor}; opacity: .85; width: 70%; }
.dna-mock__main { flex: 1; padding: .9rem; display: flex; flex-direction: column; gap: .9rem; }
.dna-mock__stats { display: grid; grid-template-columns: repeat(3,1fr); gap: .6rem; }
.dna-mock__stats div { height: 38px; border-radius: 8px; background: ${decorColor}1f; border: 1px solid ${decorColor}40; }
.dna-mock__chart { display: flex; align-items: flex-end; gap: 8px; height: 120px; }
.dna-mock__chart span { flex: 1; border-radius: 4px 4px 0 0; background: ${decorColor}; opacity: .85; }
.dna-mock__chart span:nth-child(even) { opacity: .5; }
.dna-mock__chartarea { flex: 1; padding: .5rem; }
.dna-mock__chartarea svg { width: 100%; height: 100%; }
.dna-mock__line { fill: none; stroke: ${decorColor}; stroke-width: 2.5; }
.dna-mock__area { fill: ${decorColor}26; stroke: none; }
.dna-mock__code { margin: 0; padding: .9rem 1rem; font-family: ${t.fonts["mono"] ?? "ui-monospace, monospace"}; font-size: .8rem; line-height: 1.7; display: flex; flex-direction: column; }
.dna-mock__codeline { white-space: pre; }
.dna-mock__code .t-kw { color: ${decorColor}; font-style: normal; }
.dna-mock__code .t-fn { color: ${t.colors["accent"] ?? decorColor}; font-style: normal; }
.dna-mock__code .t-op { opacity: .6; font-style: normal; }
.dna-mock__code .t-tx { font-style: normal; opacity: .85; }
.dna-mock__list { padding: .8rem; display: flex; flex-direction: column; gap: .7rem; }
.dna-mock__row { display: flex; align-items: center; gap: .7rem; }
.dna-mock__avatar { width: 28px; height: 28px; border-radius: 50%; background: ${decorColor}; opacity: .8; flex: none; }
.dna-mock__line2 { flex: 1; height: 8px; border-radius: 4px; background: var(--color-border, #999); opacity: .5; }
.dna-mock__pill { width: 46px; height: 18px; border-radius: 999px; background: ${decorColor}33; border: 1px solid ${decorColor}55; flex: none; }
.dna-logos { display: flex; flex-wrap: wrap; gap: clamp(1.5rem, 4vw, 3rem); align-items: center; justify-content: center; opacity: .8; }
.dna-logos__item { height: 32px; display: flex; align-items: center; font-weight: 600; opacity: .7; }
@media (max-width: 900px) {
  .dna-split { grid-template-columns: 1fr; }
  .dna-grid--3, .dna-grid--4, .dna-grid--5, .dna-grid--6 { grid-template-columns: repeat(2, minmax(0,1fr)); }
}
@media (max-width: 600px) {
  .dna-grid--2, .dna-grid--3, .dna-grid--4, .dna-grid--5, .dna-grid--6 { grid-template-columns: 1fr; }
}
`;
}

/** Choose readable text color over a background hex. */
function pickContrast(hex?: string): string {
  if (!hex || !hex.startsWith("#") || hex.length < 7) return "#ffffff";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? "#0a0a0a" : "#ffffff";
}

function colorLuminance(color?: string): number {
  if (!color) return 0;
  const hex = color.trim();
  if (hex.startsWith("#") && hex.length >= 7) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  const m = hex.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (m) {
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  return 0;
}

function hasMeaningfulPadding(padding?: string): boolean {
  if (!padding || !/\d/.test(padding)) return false;
  const values = padding.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
  return values.some((v) => v >= 8);
}
