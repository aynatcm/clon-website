import postcss, { type Declaration, type Rule, type AtRule } from "postcss";
import { formatHex, parse as parseColor } from "culori";

/**
 * PostCSS analysis of raw CSS text (uploaded CSS sources + inline <style>).
 * Mines custom properties, @font-face families, and frequency of colors /
 * radii / shadows / spacing values. Pure + deterministic (no assumptions).
 */

export interface CssAnalysis {
  customProperties: Record<string, string>;
  fontFaces: Array<{ family: string; weight?: string; src?: string }>;
  colors: Record<string, number>; // normalized hex -> count
  radii: Record<string, number>;
  shadows: Record<string, number>;
  spacing: Record<string, number>; // px values from margin/padding/gap
  fontFamilies: Record<string, number>;
}

function normColor(raw: string): string | null {
  const v = raw.trim();
  if (/^(inherit|initial|unset|currentcolor|transparent|none)$/i.test(v)) return null;
  try {
    const c = parseColor(v);
    if (!c) return null;
    return formatHex(c);
  } catch {
    return null;
  }
}

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

const COLOR_TOKEN_RE =
  /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)/g;

export function analyzeCss(css: string): CssAnalysis {
  const out: CssAnalysis = {
    customProperties: {},
    fontFaces: [],
    colors: {},
    radii: {},
    shadows: {},
    spacing: {},
    fontFamilies: {},
  };
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return out;
  }

  root.walkAtRules((at: AtRule) => {
    if (at.name.toLowerCase() === "font-face") {
      let family = "";
      let weight: string | undefined;
      let src: string | undefined;
      at.walkDecls((d) => {
        const p = d.prop.toLowerCase();
        if (p === "font-family") family = d.value.replace(/['"]/g, "").trim();
        if (p === "font-weight") weight = d.value.trim();
        if (p === "src") src = d.value.slice(0, 200);
      });
      if (family) out.fontFaces.push({ family, weight, src });
    }
  });

  root.walkDecls((decl: Declaration) => {
    const prop = decl.prop.toLowerCase();
    const value = decl.value;

    if (prop.startsWith("--")) out.customProperties[decl.prop] = value.trim();

    // colors anywhere in the value
    const matches = value.match(COLOR_TOKEN_RE);
    if (matches) {
      for (const m of matches) {
        const hex = normColor(m);
        if (hex) bump(out.colors, hex);
      }
    }

    if (prop === "border-radius" || prop.endsWith("-radius")) bump(out.radii, value.trim());
    if (prop === "box-shadow") bump(out.shadows, value.trim().slice(0, 80));
    if (/^(margin|padding|gap|row-gap|column-gap)/.test(prop)) {
      for (const tok of value.split(/\s+/)) {
        if (/^\d+(\.\d+)?(px|rem|em)$/.test(tok)) bump(out.spacing, tok);
      }
    }
    if (prop === "font-family") {
      const fam = value.split(",")[0].replace(/['"]/g, "").trim();
      if (fam) bump(out.fontFamilies, fam);
    }
  });

  return out;
}

/** Merge several CSS analyses (e.g. all stylesheets across all pages). */
export function mergeCssAnalyses(parts: CssAnalysis[]): CssAnalysis {
  const acc: CssAnalysis = {
    customProperties: {},
    fontFaces: [],
    colors: {},
    radii: {},
    shadows: {},
    spacing: {},
    fontFamilies: {},
  };
  const mergeCount = (t: Record<string, number>, s: Record<string, number>) => {
    for (const [k, v] of Object.entries(s)) t[k] = (t[k] ?? 0) + v;
  };
  for (const p of parts) {
    Object.assign(acc.customProperties, p.customProperties);
    acc.fontFaces.push(...p.fontFaces);
    mergeCount(acc.colors, p.colors);
    mergeCount(acc.radii, p.radii);
    mergeCount(acc.shadows, p.shadows);
    mergeCount(acc.spacing, p.spacing);
    mergeCount(acc.fontFamilies, p.fontFamilies);
  }
  return acc;
}
