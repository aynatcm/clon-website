/**
 * Self-contained DOM extraction, executed inside the page via page.evaluate().
 * MUST NOT reference any Node/module scope — it is serialized and run in the
 * browser. Returns the raw signal the Node side assembles into a PageExtract.
 *
 * v2 — color by VISUAL IMPORTANCE (not frequency), advanced section
 * fingerprints, and component variant fingerprints.
 */

export interface InPageResult {
  title: string;
  cssVariables: Record<string, string>;
  styleSamples: Array<{
    selector: string;
    count: number;
    [k: string]: string | number;
  }>;
  // Legacy frequency colors (kept for back-compat; brand now uses colorSignals).
  colorCounts: Array<{ color: string; count: number; roles: string[] }>;
  // Importance-weighted color signals.
  colorSignals: Array<{ color: string; role: string; weight: number; area: number; wp: boolean }>;
  wpColors: string[];
  fontCounts: Array<{
    family: string;
    weights: string[];
    sampleSizes: string[];
    roles: string[];
    count: number;
  }>;
  layout: {
    documentWidth: number;
    documentHeight: number;
    containerWidths: number[];
    gridTemplates: string[];
    sectionCount: number;
    sectionPaddings: string[];
  };
  blocks: Array<{
    type: string;
    tag: string;
    classes: string;
    role?: string;
    text?: string;
    childCount: number;
    rect?: { x: number; y: number; width: number; height: number };
    styles?: Record<string, string>;
  }>;
  sectionFingerprints: Array<{
    type: string;
    tag: string;
    classes: string;
    role?: string;
    rect: { x: number; y: number; width: number; height: number };
    columns: number;
    childCount: number;
    headingCount: number;
    paragraphCount: number;
    imageCount: number;
    buttonCount: number;
    linkCount: number;
    listItemCount: number;
    detailsCount: number;
    hasForm: boolean;
    hasTable: boolean;
    hasCurrency: boolean;
    hasBigNumbers: boolean;
    hasCheckmarks: boolean;
    textSample: string;
    background?: string;
  }>;
  components: {
    button: ComponentVariantRaw[];
    card: ComponentVariantRaw[];
    input: ComponentVariantRaw[];
    nav: ComponentVariantRaw[];
    badge: ComponentVariantRaw[];
  };
  stylesheetHrefs: string[];
  inlineStyles: string[];
}

interface ComponentVariantRaw {
  signature: string;
  usageCount: number;
  radius?: string;
  height?: string;
  fontWeight?: string;
  fontSize?: string;
  padding?: string;
  background?: string;
  color?: string;
  border?: string;
  boxShadow?: string;
}

export function extractInPage(): InPageResult {
  const VW = window.innerWidth || 1440;
  const VH = window.innerHeight || 900;

  const norm = (c: string): string => {
    if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") return "";
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return c.startsWith("#") ? c.toLowerCase() : "";
    const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
    const [r, g, b, a] = parts;
    if (a !== undefined && a < 0.05) return "";
    const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  };

  const isNeutralish = (hex: string): boolean => {
    // near white / near black / pure grey → structural, not brand
    const m = hex.replace("#", "");
    if (m.length < 6) return false;
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    return sat < 0.12; // low saturation = neutral
  };

  // --- CSS variables on :root + detect WP/Gutenberg preset palette ---
  const cssVariables: Record<string, string> = {};
  const wpColorSet = new Set<string>();
  try {
    const rootStyle = getComputedStyle(document.documentElement);
    for (let i = 0; i < rootStyle.length; i++) {
      const prop = rootStyle[i];
      if (prop.startsWith("--")) {
        const val = rootStyle.getPropertyValue(prop).trim();
        cssVariables[prop] = val;
        // WordPress preset color tokens => editor colors, not brand intent.
        if (/--wp--preset--color|--wp--style|gutenberg/i.test(prop)) {
          const hex = norm(val);
          if (hex) wpColorSet.add(hex);
        }
      }
    }
  } catch {
    /* ignore */
  }

  // Mark colors used only via has-*-color / wp-block classes as WP-origin.
  const elementIsWp = (el: Element): boolean => {
    const cls = el.getAttribute("class") || "";
    return /\bwp-block|\bhas-[\w-]+-(color|background-color)\b|\beditor-/.test(cls);
  };

  // --- importance-weighted color signals ---
  const ROLE_WEIGHT: Record<string, number> = {
    "cta-bg": 10,
    cta: 9,
    nav: 7,
    hero: 7,
    button: 6,
    link: 5,
    interactive: 5,
    heading: 4,
    icon: 2,
    border: 1.5,
    surface: 1,
    background: 0.6,
    text: 0.8,
    decorative: 0.3,
  };
  const signalMap = new Map<string, { role: string; weight: number; area: number; wp: boolean }>();
  const pushSignal = (raw: string, role: string, area: number, wp: boolean) => {
    const c = norm(raw);
    if (!c) return;
    const base = ROLE_WEIGHT[role] ?? 1;
    // viewport boost: above-the-fold elements matter more
    const w = base * (1 + Math.min(1, Math.sqrt(Math.max(area, 1)) / 400));
    const prev = signalMap.get(c + "|" + role);
    if (prev) {
      prev.weight += w;
      prev.area += area;
      prev.wp = prev.wp && wp;
    } else {
      signalMap.set(c + "|" + role, { role, weight: w, area, wp });
    }
  };

  const rectArea = (el: Element): { area: number; top: number } => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return { area: Math.max(0, r.width) * Math.max(0, r.height), top: r.top + window.scrollY };
  };

  const isCtaLike = (el: Element, cs: CSSStyleDeclaration): boolean => {
    const tag = el.tagName.toLowerCase();
    const cls = (el.getAttribute("class") || "").toLowerCase();
    const role = el.getAttribute("role") || "";
    const looksButton =
      tag === "button" ||
      role === "button" ||
      /\bbtn\b|button|cta/.test(cls) ||
      (tag === "a" && cs.display !== "inline" && parseFloat(cs.paddingTop) > 4);
    return looksButton;
  };

  // Nav scope
  const navEls = Array.from(document.querySelectorAll('nav, header [class*="nav"], header'));
  // Hero scope = first large block in the first viewport
  const heroCandidates = Array.from(document.querySelectorAll("section, main > div, header + *")).filter((el) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return r.top + window.scrollY < VH * 1.1 && r.height > 240 && r.width > VW * 0.5;
  });
  const heroEl = heroCandidates[0] || null;

  // CTA / buttons / links (highest attention)
  const interactiveEls = Array.from(
    document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"], .btn, .button, [class*="cta"]'),
  ).slice(0, 400);
  for (const el of interactiveEls) {
    const cs = getComputedStyle(el);
    const { area } = rectArea(el);
    if (area < 60) continue;
    const wp = elementIsWp(el);
    const inNav = navEls.some((n) => n.contains(el));
    const inHero = heroEl ? heroEl.contains(el) : false;
    const cta = isCtaLike(el, cs);
    if (cta) {
      pushSignal(cs.backgroundColor, "cta-bg", area, wp);
      pushSignal(cs.color, "cta", area, wp);
      pushSignal(cs.borderTopColor, "border", area, wp);
    } else if (el.tagName.toLowerCase() === "a") {
      pushSignal(cs.color, inNav ? "nav" : inHero ? "hero" : "link", area, wp);
    }
    if (inNav) pushSignal(cs.color, "nav", area, wp);
  }

  // Headings (brand accent often in headings)
  for (const el of Array.from(document.querySelectorAll("h1, h2, h3")).slice(0, 120)) {
    const cs = getComputedStyle(el);
    const { area } = rectArea(el);
    pushSignal(cs.color, "heading", area, elementIsWp(el));
  }

  // Hero background
  if (heroEl) {
    const cs = getComputedStyle(heroEl);
    const { area } = rectArea(heroEl);
    pushSignal(cs.backgroundColor, "hero", area, elementIsWp(heroEl));
    const bgImg = cs.backgroundImage || "";
    const grad = bgImg.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)/g);
    if (grad) for (const g of grad) pushSignal(g, "hero", area, false);
  }

  // Structural surfaces / backgrounds / borders / text (low weight)
  for (const el of Array.from(document.querySelectorAll("section, div, footer, article, aside")).slice(0, 500)) {
    const cs = getComputedStyle(el);
    const { area } = rectArea(el);
    if (area < 4000) continue;
    const wp = elementIsWp(el);
    pushSignal(cs.backgroundColor, area > VW * VH * 0.4 ? "background" : "surface", area, wp);
    pushSignal(cs.borderTopColor, "border", area, wp);
    pushSignal(cs.color, "text", area, wp);
  }

  const colorSignals = Array.from(signalMap.values())
    .map((v, i) => ({ color: Array.from(signalMap.keys())[i].split("|")[0], ...v }))
    .filter((s) => s.color)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 60);

  // --- representative selectors (legacy style samples + frequency colors) ---
  const selectors = [
    "body",
    "h1",
    "h2",
    "h3",
    "p",
    "a",
    "button",
    'a[class*="btn"],a[class*="button"],.btn,.button',
    "nav",
    "header",
    "footer",
    "input,textarea,select",
    'section,[class*="section"]',
    'article,[class*="card"]',
    "ul,ol",
  ];
  const styleSamples: InPageResult["styleSamples"] = [];
  const colorMap = new Map<string, { count: number; roles: Set<string> }>();
  const fontMap = new Map<
    string,
    { weights: Set<string>; sizes: Set<string>; roles: Set<string>; count: number }
  >();
  const bump = (color: string, role: string) => {
    const c = norm(color);
    if (!c) return;
    const e = colorMap.get(c) ?? { count: 0, roles: new Set<string>() };
    e.count++;
    e.roles.add(role);
    colorMap.set(c, e);
  };
  const roleFor = (sel: string): string => {
    if (/h1|h2|h3/.test(sel)) return "heading";
    if (/button|btn/.test(sel)) return "button";
    if (sel === "body" || sel === "p") return "body";
    if (sel.includes("input")) return "input";
    return "ui";
  };
  for (const selector of selectors) {
    let els: Element[] = [];
    try {
      els = Array.from(document.querySelectorAll(selector));
    } catch {
      continue;
    }
    if (!els.length) continue;
    const sample = els[0];
    const cs = getComputedStyle(sample);
    styleSamples.push({
      selector,
      count: els.length,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      borderColor: cs.borderColor,
      borderWidth: cs.borderTopWidth,
      borderRadius: cs.borderTopLeftRadius,
      boxShadow: cs.boxShadow,
      padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      margin: `${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft}`,
      gap: cs.gap,
      textAlign: cs.textAlign,
    });
    const role = roleFor(selector);
    for (const el of els.slice(0, 40)) {
      const c = getComputedStyle(el);
      bump(c.color, "text");
      bump(c.backgroundColor, role === "button" ? "cta" : "background");
      bump(c.borderColor, "border");
      const fam = c.fontFamily.split(",")[0].replace(/['"]/g, "").trim();
      if (fam) {
        const f = fontMap.get(fam) ?? {
          weights: new Set<string>(),
          sizes: new Set<string>(),
          roles: new Set<string>(),
          count: 0,
        };
        f.weights.add(c.fontWeight);
        f.sizes.add(c.fontSize);
        f.roles.add(role);
        f.count++;
        fontMap.set(fam, f);
      }
    }
  }

  // --- layout metrics ---
  const containerWidths = new Set<number>();
  const gridTemplates = new Set<string>();
  const allLayout = Array.from(document.querySelectorAll("div,section,main,header,footer,nav"));
  for (const el of allLayout.slice(0, 600)) {
    const cs = getComputedStyle(el);
    const w = (el as HTMLElement).getBoundingClientRect().width;
    if (cs.maxWidth !== "none" && w > 320 && w < VW) containerWidths.add(Math.round(w));
    if (cs.display === "grid" && cs.gridTemplateColumns !== "none") gridTemplates.add(cs.gridTemplateColumns);
  }
  const sectionsForPad = Array.from(document.querySelectorAll('section,[class*="section"],main > div'));
  const sectionPaddings = new Set<string>();
  for (const s of sectionsForPad.slice(0, 50)) {
    const cs = getComputedStyle(s);
    sectionPaddings.add(`${cs.paddingTop}/${cs.paddingBottom}`);
  }

  // === ADVANCED SECTION FINGERPRINTS ===
  const colCount = (el: Element): number => {
    const cs = getComputedStyle(el);
    if (cs.display === "grid" && cs.gridTemplateColumns !== "none") {
      return cs.gridTemplateColumns.split(/\s+/).filter((x) => x && x !== "0px").length;
    }
    // flex row → count direct children sharing a row
    if (cs.display === "flex" && cs.flexDirection.startsWith("row")) {
      return Math.min(el.childElementCount, 6);
    }
    // largest grid among descendants (nested containers are common)
    let best = 1;
    for (const d of Array.from(el.querySelectorAll("*")).slice(0, 200)) {
      const ds = getComputedStyle(d);
      if (ds.display === "grid" && ds.gridTemplateColumns !== "none") {
        const tracks = ds.gridTemplateColumns.split(/\s+/).filter((x) => x && x !== "0px").length;
        if (tracks > best) best = tracks;
      } else if (ds.display === "flex" && ds.flexDirection.startsWith("row") && (d as HTMLElement).childElementCount >= 3) {
        best = Math.max(best, Math.min((d as HTMLElement).childElementCount, 6));
      }
    }
    return best;
  };

  const classifySection = (
    el: Element,
    fp: {
      rect: { x: number; y: number; width: number; height: number };
      columns: number;
      headingCount: number;
      paragraphCount: number;
      imageCount: number;
      buttonCount: number;
      linkCount: number;
      listItemCount: number;
      detailsCount: number;
      hasForm: boolean;
      hasTable: boolean;
      hasCurrency: boolean;
      hasBigNumbers: boolean;
      hasCheckmarks: boolean;
      text: string;
    },
    isLast: boolean,
    isFirst: boolean,
  ): string => {
    const tag = el.tagName.toLowerCase();
    const hay = `${(el.getAttribute("class") || "")} ${el.getAttribute("id") || ""}`.toLowerCase();
    const t = fp.text.toLowerCase();

    if (tag === "footer" || /(^|\s)footer/.test(hay)) return "footer";
    if (tag === "nav" || /navbar|navigation|menu/.test(hay)) return "nav";

    // keyword-driven (strong intent)
    if (/faq|frequently asked|preguntas/.test(hay) || fp.detailsCount >= 2) return "faq";
    if (/pricing|\/mo\b|\/month|per month|\bplan\b|tier/.test(hay) || (fp.hasCurrency && fp.headingCount >= 2)) return "pricing";
    if (/feature.?compar|compare|comparison/.test(hay) || (fp.hasTable && fp.hasCheckmarks)) return "feature-comparison";
    if (/testimonial|review|quote|loved by|what .* say/.test(hay)) return "testimonials";
    if (/case.?stud/.test(hay)) return "case-studies";
    if (/portfolio|our work|projects|gallery/.test(hay) && fp.imageCount >= 3) return "portfolio";
    if (/timeline|roadmap|milestone|our journey/.test(hay)) return "timeline";
    if (/process|how it works|step|workflow/.test(hay)) return "process-section";
    if (/team|our people|meet the|leadership|founders/.test(hay)) return "team-section";
    if (/service/.test(hay) && fp.columns >= 2) return "service-grid";
    if (/logo|trusted by|as seen|brands|clients/.test(hay) || (fp.imageCount >= 4 && fp.paragraphCount === 0 && fp.headingCount <= 1)) return "logo-cloud";
    if (/trust|secure|guarantee|certified|compliance|gdpr|soc ?2/.test(hay)) return "trust-section";
    if (/contact|get in touch|reach us/.test(hay) || (fp.hasForm && /email|message|name/.test(t))) return "contact-section";
    if (/stat|metric|by the numbers|results/.test(hay) || (fp.hasBigNumbers && fp.columns >= 2 && fp.paragraphCount <= fp.columns)) return "stats";
    if (/feature/.test(hay) && fp.columns >= 2) return "feature-grid";

    // structural inference
    const inFirstView = fp.rect.y < VH * 1.1;
    if (isFirst || inFirstView) {
      if (fp.headingCount >= 1 && fp.imageCount >= 1 && fp.columns >= 2 && fp.rect.height > 280) return "split-hero";
      if (fp.headingCount >= 1 && fp.rect.height > 280) return "hero";
    }
    if (fp.hasForm) return "contact-section";
    if (fp.columns >= 3 && fp.headingCount >= 2) return "feature-grid";
    if (fp.imageCount >= 4 && fp.paragraphCount <= 1) return "logo-cloud";
    if (fp.hasBigNumbers && fp.columns >= 2) return "stats";

    // CTA: short, few children, has button, centered-ish
    const short = fp.rect.height < 520;
    if (short && fp.buttonCount >= 1 && fp.headingCount >= 1 && fp.paragraphCount <= 2 && fp.columns <= 1) {
      return isLast ? "footer-cta" : "cta";
    }
    return "content-block";
  };

  const sectionCandidates = Array.from(
    document.querySelectorAll("body > section, main > section, main > div, body > div > section, section, footer, header"),
  );
  const seenSec = new Set<Element>();
  const fingerprints: InPageResult["sectionFingerprints"] = [];
  // keep only sizable, non-nested top-level-ish sections
  const sized = sectionCandidates
    .filter((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.height > 120 && r.width > VW * 0.4;
    })
    .slice(0, 60);
  for (let i = 0; i < sized.length; i++) {
    const el = sized[i];
    // skip if an ancestor is already recorded (avoid double counting nested)
    let nested = false;
    for (const s of seenSec) if (s.contains(el)) { nested = true; break; }
    if (nested) continue;
    seenSec.add(el);
    const r = (el as HTMLElement).getBoundingClientRect();
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    const cs = getComputedStyle(el);
    const fpData = {
      rect: { x: Math.round(r.x), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) },
      columns: colCount(el),
      headingCount: el.querySelectorAll("h1,h2,h3,h4").length,
      paragraphCount: el.querySelectorAll("p").length,
      imageCount: el.querySelectorAll("img,svg,picture").length,
      buttonCount: el.querySelectorAll('button,a[class*="btn"],a[class*="button"],.btn,.button,[role="button"]').length,
      linkCount: el.querySelectorAll("a").length,
      listItemCount: el.querySelectorAll("li").length,
      detailsCount: el.querySelectorAll('details,[class*="accordion"],[class*="faq"]').length,
      hasForm: !!el.querySelector("form,input,textarea"),
      hasTable: !!el.querySelector("table"),
      hasCurrency: /[$€£¥]\s?\d|\d+\s?(usd|eur|gbp)/i.test(text),
      hasBigNumbers: /(^|\s)(\d{2,}[kKmM%+]|\d+,\d{3})/.test(text) || el.querySelectorAll('[class*="stat"],[class*="count"],[class*="number"]').length > 0,
      hasCheckmarks: /[✓✔]/.test(text) || el.querySelectorAll('[class*="check"],[class*="tick"]').length > 0,
      text: text.slice(0, 200),
    };
    const type = classifySection(el, fpData, i === sized.length - 1, i === 0);
    fingerprints.push({
      type,
      tag: el.tagName.toLowerCase(),
      classes: (el.getAttribute("class") || "").slice(0, 160),
      role: el.getAttribute("role") || undefined,
      rect: fpData.rect,
      columns: fpData.columns,
      childCount: el.childElementCount,
      headingCount: fpData.headingCount,
      paragraphCount: fpData.paragraphCount,
      imageCount: fpData.imageCount,
      buttonCount: fpData.buttonCount,
      linkCount: fpData.linkCount,
      listItemCount: fpData.listItemCount,
      detailsCount: fpData.detailsCount,
      hasForm: fpData.hasForm,
      hasTable: fpData.hasTable,
      hasCurrency: fpData.hasCurrency,
      hasBigNumbers: fpData.hasBigNumbers,
      hasCheckmarks: fpData.hasCheckmarks,
      textSample: fpData.text.slice(0, 160),
      background: norm(cs.backgroundColor) || undefined,
    });
  }

  // === COMPONENT VARIANT FINGERPRINTS ===
  const groupVariants = (
    els: Element[],
    sig: (cs: CSSStyleDeclaration, el: Element) => ComponentVariantRaw,
  ): ComponentVariantRaw[] => {
    const map = new Map<string, ComponentVariantRaw>();
    for (const el of els.slice(0, 300)) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const cs = getComputedStyle(el);
      const v = sig(cs, el);
      const ex = map.get(v.signature);
      if (ex) ex.usageCount++;
      else map.set(v.signature, v);
    }
    return Array.from(map.values()).sort((a, b) => b.usageCount - a.usageCount).slice(0, 8);
  };

  const round = (px: string) => `${Math.round(parseFloat(px) || 0)}px`;

  const buttonEls = Array.from(
    document.querySelectorAll('button, a[class*="btn"], a[class*="button"], .btn, .button, [role="button"], input[type="submit"]'),
  );
  const button = groupVariants(buttonEls, (cs, el) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return {
      signature: `${round(cs.borderTopLeftRadius)}|${Math.round(r.height)}|${cs.fontWeight}|${norm(cs.backgroundColor)}`,
      usageCount: 1,
      radius: cs.borderTopLeftRadius,
      height: `${Math.round(r.height)}px`,
      fontWeight: cs.fontWeight,
      fontSize: cs.fontSize,
      padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      background: cs.backgroundColor,
      color: cs.color,
      border: cs.borderTopWidth !== "0px" ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : "none",
      boxShadow: cs.boxShadow !== "none" ? cs.boxShadow.slice(0, 60) : "none",
    };
  });

  const cardEls = Array.from(
    document.querySelectorAll('[class*="card"], article, [class*="tile"], [class*="box"]'),
  ).filter((el) => {
    const cs = getComputedStyle(el);
    return cs.borderTopLeftRadius !== "0px" || cs.boxShadow !== "none" || cs.borderTopWidth !== "0px";
  });
  const card = groupVariants(cardEls, (cs) => ({
    signature: `${round(cs.borderTopLeftRadius)}|${cs.boxShadow !== "none" ? "shadow" : "flat"}|${norm(cs.backgroundColor)}|${cs.borderTopWidth}`,
    usageCount: 1,
    radius: cs.borderTopLeftRadius,
    padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
    background: cs.backgroundColor,
    border: cs.borderTopWidth !== "0px" ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : "none",
    boxShadow: cs.boxShadow !== "none" ? cs.boxShadow.slice(0, 80) : "none",
  }));

  const inputEls = Array.from(document.querySelectorAll("input,textarea,select")).filter((el) => {
    const tp = (el as HTMLInputElement).type;
    return tp !== "submit" && tp !== "button" && tp !== "hidden";
  });
  const input = groupVariants(inputEls, (cs, el) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return {
      signature: `${round(cs.borderTopLeftRadius)}|${Math.round(r.height)}|${cs.borderTopWidth}|${norm(cs.backgroundColor)}`,
      usageCount: 1,
      radius: cs.borderTopLeftRadius,
      height: `${Math.round(r.height)}px`,
      padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      background: cs.backgroundColor,
      border: cs.borderTopWidth !== "0px" ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : "none",
    };
  });

  const navComp = groupVariants(Array.from(document.querySelectorAll("nav, header")), (cs, el) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return {
      signature: `${Math.round(r.height)}|${norm(cs.backgroundColor)}|${cs.position}`,
      usageCount: 1,
      height: `${Math.round(r.height)}px`,
      background: cs.backgroundColor,
      padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      boxShadow: cs.boxShadow !== "none" ? cs.boxShadow.slice(0, 60) : "none",
    };
  });

  const badgeEls = Array.from(document.querySelectorAll('[class*="badge"], [class*="tag"], [class*="pill"], [class*="chip"]'));
  const badge = groupVariants(badgeEls, (cs) => ({
    signature: `${round(cs.borderTopLeftRadius)}|${norm(cs.backgroundColor)}|${norm(cs.color)}`,
    usageCount: 1,
    radius: cs.borderTopLeftRadius,
    background: cs.backgroundColor,
    color: cs.color,
    fontSize: cs.fontSize,
    padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
  }));

  // --- legacy blocks (kept for back-compat) ---
  const blocks: InPageResult["blocks"] = fingerprints.slice(0, 40).map((f) => ({
    type: f.type,
    tag: f.tag,
    classes: f.classes,
    role: f.role,
    text: f.textSample,
    childCount: f.childCount,
    rect: f.rect,
    styles: { backgroundColor: f.background || "" },
  }));

  // --- stylesheets + inline styles ---
  const stylesheetHrefs = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map((l) => (l as HTMLLinkElement).href)
    .filter(Boolean);
  const inlineStyles = Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent || "")
    .filter((t) => t.trim().length > 0)
    .slice(0, 12);

  return {
    title: document.title,
    cssVariables,
    styleSamples,
    colorCounts: Array.from(colorMap.entries())
      .map(([color, v]) => ({ color, count: v.count, roles: Array.from(v.roles) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 40),
    colorSignals,
    wpColors: Array.from(wpColorSet),
    fontCounts: Array.from(fontMap.entries())
      .map(([family, v]) => ({
        family,
        weights: Array.from(v.weights),
        sampleSizes: Array.from(v.sizes),
        roles: Array.from(v.roles),
        count: v.count,
      }))
      .sort((a, b) => b.count - a.count),
    layout: {
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      containerWidths: Array.from(containerWidths).sort((a, b) => b - a).slice(0, 12),
      gridTemplates: Array.from(gridTemplates).slice(0, 20),
      sectionCount: fingerprints.length,
      sectionPaddings: Array.from(sectionPaddings).slice(0, 20),
    },
    blocks,
    sectionFingerprints: fingerprints,
    components: { button, card, input, nav: navComp, badge },
    stylesheetHrefs,
    inlineStyles,
  };
}
