/**
 * Phase 3 — Playwright crawler types.
 *
 * The crawler is the PRIMARY analysis source. It produces a CrawlBundle that
 * the extraction engine (Phase 5) merges with Firecrawl + uploaded fallbacks.
 */

export type Viewport = "desktop" | "tablet" | "mobile";

export interface ViewportSpec {
  name: Viewport;
  width: number;
  height: number;
  isMobile: boolean;
}

export const VIEWPORTS: ViewportSpec[] = [
  { name: "desktop", width: 1440, height: 900, isMobile: false },
  { name: "tablet", width: 834, height: 1112, isMobile: true },
  { name: "mobile", width: 390, height: 844, isMobile: true },
];

/** Common page slugs the crawler tries to discover from the homepage. */
export const TARGET_PAGE_HINTS = [
  "product",
  "products",
  "features",
  "solutions",
  "platform",
  "use-cases",
  "customers",
  "case-studies",
  "pricing",
  "docs",
  "documentation",
  "changelog",
  "blog",
  "about",
  "careers",
  "jobs",
  "contact",
] as const;

/** A computed-style sample for one representative selector. */
export interface StyleSample {
  selector: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: string;
  borderRadius?: string;
  boxShadow?: string;
  padding?: string;
  margin?: string;
  gap?: string;
  textAlign?: string;
  count: number; // how many elements matched this selector
}

export interface ColorUsage {
  color: string; // normalized hex/rgb
  count: number;
  roles: string[]; // e.g. ["background", "text", "border", "cta"]
}

export interface FontUsage {
  family: string;
  weights: string[];
  sampleSizes: string[];
  roles: string[]; // heading | body | mono | button
  count: number;
}

export interface LayoutMetrics {
  documentWidth: number;
  documentHeight: number;
  containerWidths: number[]; // observed max-content container widths
  gridTemplates: string[]; // grid-template-columns values seen
  sectionCount: number;
  sectionPaddings: string[]; // vertical paddings of top-level sections
}

/** A detected component or section block (heuristic structural extract). */
export interface DetectedBlock {
  type: string; // hero | feature-grid | logos | stats | cta | testimonials | footer | nav | card | button | form ...
  tag: string;
  classes: string;
  role?: string;
  text?: string; // truncated representative text
  childCount: number;
  rect?: { x: number; y: number; width: number; height: number };
  styles?: Partial<StyleSample>;
}

/**
 * A color observed on a specific element, scored by VISUAL IMPORTANCE (not
 * frequency). `role` records WHERE it was seen so brand color can be inferred
 * from attention, and `wp` flags WordPress/Gutenberg editor colors to ignore.
 */
export interface ColorSignal {
  color: string;
  // brand-candidate: nav | hero | cta | cta-bg | link | interactive | button | heading
  // structural:      background | surface | border | text | icon | decorative
  role: string;
  weight: number; // attention weight (role base * area factor * viewport factor)
  area: number; // element area in px²
  wp: boolean; // true => WordPress/Gutenberg preset color, ignore for brand
}

/** Structural fingerprint of one page section for advanced classification. */
export interface SectionFingerprint {
  type: string; // one of the advanced section taxonomy
  tag: string;
  classes: string;
  role?: string;
  rect: { x: number; y: number; width: number; height: number };
  columns: number; // grid track count or flex-row child count
  childCount: number;
  headingCount: number;
  paragraphCount: number;
  imageCount: number;
  buttonCount: number;
  linkCount: number;
  listItemCount: number;
  detailsCount: number; // <details>/accordion items (FAQ signal)
  hasForm: boolean;
  hasTable: boolean;
  hasCurrency: boolean;
  hasBigNumbers: boolean; // large stat numerals
  hasCheckmarks: boolean; // ✓/check icons (comparison/pricing)
  textSample: string;
  background?: string;
  // Recipe structural facts (Phase 7.5).
  mediaSide: "left" | "right" | "top" | "bottom" | "none";
  hasEyebrow: boolean; // short kicker above the heading
  ctaCount: number;
  cardCount: number; // repeated child blocks in a grid
  cardHasIcon: boolean;
  cardHasCta: boolean;
  paddingTop: string;
  paddingBottom: string;
  gap: string;
}

/** A grouped style signature for a component (one row of `variants`). */
export interface ComponentVariant {
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

export interface ComponentFingerprintSet {
  button: ComponentVariant[];
  card: ComponentVariant[];
  input: ComponentVariant[];
  nav: ComponentVariant[];
  badge: ComponentVariant[];
}

/** A visual asset discovered during crawl (Brand Context, Phase 6.5). */
export interface AssetRef {
  url: string;
  type: "img" | "picture" | "svg" | "video-poster" | "background" | "logo" | "icon";
  alt: string;
  width: number;
  height: number;
  // Inferred semantic role.
  role:
    | "hero-image"
    | "product-shot"
    | "dashboard"
    | "illustration"
    | "logo"
    | "testimonial-avatar"
    | "feature-image"
    | "team-photo"
    | "background-graphic"
    | "icon";
}

/** A piece of copy harvested from the page (Brand Context content library). */
export interface ContentItem {
  type:
    | "headline"
    | "subheadline"
    | "feature-name"
    | "benefit"
    | "product-name"
    | "pricing-term"
    | "nav-label"
    | "cta-label"
    | "tagline";
  content: string;
}

/** Everything extracted from a single page at desktop viewport. */
export interface PageExtract {
  url: string;
  title?: string;
  cssVariables: Record<string, string>;
  fonts: FontUsage[];
  colors: ColorUsage[];
  styleSamples: StyleSample[];
  layout: LayoutMetrics;
  blocks: DetectedBlock[];
  // Importance-weighted color signals (brand inference) + WP colors to ignore.
  colorSignals: ColorSignal[];
  wpColors: string[];
  // Advanced section taxonomy with structural fingerprints.
  sectionFingerprints: SectionFingerprint[];
  // Component variant fingerprints (buttons/cards/inputs/nav/badges).
  components: ComponentFingerprintSet;
  // Brand context raw signal (Phase 6.5): visual assets + content library.
  assets: AssetRef[];
  content: ContentItem[];
  // Per-viewport layout signal for responsive behavior.
  responsive: Record<Viewport, { documentWidth: number; columns: number[] }>;
  // External stylesheet hrefs + any inline <style> text (for PostCSS, Phase 5).
  stylesheetHrefs: string[];
  inlineStyles: string[];
  rawHtml?: string;
}

export interface CrawlScreenshot {
  storageKey: string;
  kind:
    | "DESKTOP"
    | "TABLET"
    | "MOBILE"
    | "NAVIGATION"
    | "FOOTER"
    | "SECTION"
    | "COMPONENT";
  width: number;
  height: number;
  label: string;
  pageUrl: string;
}

export interface CrawledPage {
  url: string;
  extract: PageExtract;
  screenshots: CrawlScreenshot[];
}

export interface CrawlBundle {
  startUrl: string;
  pages: CrawledPage[];
  discoveredUrls: string[];
  errors: string[];
}

export interface CrawlOptions {
  maxPages?: number;
  timeoutMs?: number;
  /** Persist a screenshot and return its storage key. */
  saveScreenshot: (
    buf: Buffer,
    meta: { kind: CrawlScreenshot["kind"]; label: string; pageUrl: string },
  ) => Promise<string>;
  log?: (msg: string) => void;
}
