// Ninerr Intelligence: structured product briefs, nine domain archetypes, and
// deterministic multi-direction aesthetic planning.

import { briefProblem } from "@ninerr/document-model";

export const DOMAIN_ARCHETYPES = Object.freeze({
  healthcare: Object.freeze({
    id: "healthcare",
    title: "Healthcare & Clinical Systems",
    summary: "Calm, trustworthy, high-legibility interfaces built for safety, accessibility, and zero visual fatigue.",
    defaultDensity: "spacious",
    defaultTheme: "light",
    typography: Object.freeze({
      headingFamily: "'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif",
      bodyFamily: "'Inter', system-ui, -apple-system, sans-serif",
      monoFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
      baseSizePx: 16,
      scaleRatio: 1.25,
      measureCh: 65,
    }),
    colorGuidance: Object.freeze({
      contrastTarget: "WCAG AAA (7:1) for clinical readings and alerts; AA (4.5:1) minimum everywhere.",
      restraint: "Calm neutral canvas, clinical teal or deep cobalt primary action, reserved semantic crimson strictly for critical clinical warnings.",
    }),
    layoutPrinciples: Object.freeze([
      "Prioritize single-focus triage hierarchy and scannable patient or appointment summaries.",
      "Maintain minimum 44px touch and click targets on every primary control.",
      "Never rely on color alone for vital status; pair icons, text labels, and clear grouping.",
    ]),
    antiPatternsToAvoid: Object.freeze([
      "Decorative pulsing badges or ambient motion that mimic clinical alarms.",
      "Low-contrast pastel status pills on tinted surfaces.",
      "Dense multi-column walls of raw parameters without progressive disclosure.",
    ]),
  }),
  fintech: Object.freeze({
    id: "fintech",
    title: "Fintech & Financial Operations",
    summary: "Authoritative, transparent, high-precision layouts with crisp tabular numerals and unmistakable state hierarchy.",
    defaultDensity: "balanced",
    defaultTheme: "light",
    typography: Object.freeze({
      headingFamily: "'Inter', 'IBM Plex Sans', system-ui, -apple-system, sans-serif",
      bodyFamily: "'Inter', 'IBM Plex Sans', system-ui, -apple-system, sans-serif",
      monoFamily: "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace",
      baseSizePx: 15,
      scaleRatio: 1.25,
      measureCh: 68,
    }),
    colorGuidance: Object.freeze({
      contrastTarget: "WCAG AA+ (5.5:1+) on balances, fees, ledger deltas, and confirmation states.",
      restraint: "Ink-crisp neutral hierarchy, restrained slate or deep navy primary, explicit green and red semantic deltas always paired with + or - signs.",
    }),
    layoutPrinciples: Object.freeze([
      "Enforce font-variant-numeric: tabular-nums on every currency, percentage, rate, and ledger column.",
      "Use crisp 1px structural borders and clean alignment rather than heavy drop shadows.",
      "Keep destructive or money-moving confirmations explicit, calm, and unmistakably distinct from secondary controls.",
    ]),
    antiPatternsToAvoid: Object.freeze([
      "Playful marketing gradients over transactional screens.",
      "Unaligned proportional numerals in financial tables.",
      "Sluggish modal or tab animations on high-frequency operational views.",
    ]),
  }),
  "developer-tools": Object.freeze({
    id: "developer-tools",
    title: "Developer Tools & Infrastructure",
    summary: "Fast, keyboard-first, information-rich interfaces with precision spacing, crisp focus rings, and disciplined dark and light modes.",
    defaultDensity: "compact",
    defaultTheme: "dark",
    typography: Object.freeze({
      headingFamily: "'Inter', 'Geist', system-ui, -apple-system, sans-serif",
      bodyFamily: "'Inter', 'Geist', system-ui, -apple-system, sans-serif",
      monoFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, monospace",
      baseSizePx: 14,
      scaleRatio: 1.2,
      measureCh: 72,
    }),
    colorGuidance: Object.freeze({
      contrastTarget: "WCAG AA+ on code, logs, muted labels, and active keyboard focus indicators.",
      restraint: "Layered neutral surfaces differentiated by 4% to 6% lightness and 1px hairline borders; reserve vibrant accents for active states and syntax.",
    }),
    layoutPrinciples: Object.freeze([
      "Favor compact 4px and 8px structural rhythm with clear visual grouping instead of oversized marketing padding.",
      "Keep primary actions, command triggers, and status diagnostics immediately visible without unnecessary scrolling.",
      "Support rapid keyboard navigation with visible focus-visible outlines and zero animation latency on frequent shortcuts.",
    ]),
    antiPatternsToAvoid: Object.freeze([
      "Gratuitous neon glow, multi-stop rainbow gradients, or generic glassmorphism on utility chrome.",
      "Card-inside-card nesting that wastes viewport height.",
      "Blocking animations on command palettes, tab switches, or inline edits.",
    ]),
  }),
  "enterprise-saas": Object.freeze({
    id: "enterprise-saas",
    title: "Enterprise SaaS & Team Workflows",
    summary: "Scalable, predictable, multi-surface workspaces balancing clarity, workflow depth, and design-system consistency.",
    defaultDensity: "balanced",
    defaultTheme: "light",
    typography: Object.freeze({
      headingFamily: "'Inter', 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
      bodyFamily: "'Inter', system-ui, -apple-system, sans-serif",
      monoFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
      baseSizePx: 15,
      scaleRatio: 1.25,
      measureCh: 68,
    }),
    colorGuidance: Object.freeze({
      contrastTarget: "WCAG AA across light, dark, and high-contrast themes.",
      restraint: "Neutral workspace shell, single intentional brand accent for primary actions, semantic tokens for success, warning, and error states.",
    }),
    layoutPrinciples: Object.freeze([
      "Maintain consistent navigation landmarks (rail, header, contextual action bar, content surface).",
      "Establish unmistakable primary, secondary, and tertiary button hierarchy per view.",
      "Design empty, loading, error, and permission-restricted states as first-class compositions.",
    ]),
    antiPatternsToAvoid: Object.freeze([
      "Uniform grids of identical icon-title-summary cards when a structured table or split master-detail view communicates better.",
      "Badge proliferation where every row carries four competing pill labels.",
      "Inconsistent spacing or hardcoded hex colors outside the token system.",
    ]),
  }),
  ecommerce: Object.freeze({
    id: "ecommerce",
    title: "E-Commerce & Merchandising",
    summary: "Product-forward, tactile shopping experiences with effortless variant selection, visual breathing room, and frictionless checkout clarity.",
    defaultDensity: "spacious",
    defaultTheme: "light",
    typography: Object.freeze({
      headingFamily: "'Instrument Serif', 'Playfair Display', Georgia, serif",
      bodyFamily: "'Inter', 'DM Sans', system-ui, -apple-system, sans-serif",
      monoFamily: "'JetBrains Mono', ui-monospace, monospace",
      baseSizePx: 16,
      scaleRatio: 1.333,
      measureCh: 62,
    }),
    colorGuidance: Object.freeze({
      contrastTarget: "WCAG AA on pricing, shipping terms, stock status, and primary checkout actions.",
      restraint: "Warm or crisp gallery-neutral surfaces so product photography carries visual richness; one decisive high-contrast purchase CTA.",
    }),
    layoutPrinciples: Object.freeze([
      "Let product imagery dominate the viewport with consistent aspect ratios (4 : 5 or 1 : 1) and clean framing.",
      "Keep price, variant selector, stock availability, and primary add-to-cart action grouped above the fold.",
      "Surface delivery, return, and trust signals succinctly without noisy promotional banners.",
    ]),
    antiPatternsToAvoid: Object.freeze([
      "Competing promotional badges, countdown timers, and multi-colored discount tags on every product tile.",
      "Tiny variant swatches or low-contrast out-of-stock indicators.",
      "Disorienting hover zoom shifts that cause layout reflow.",
    ]),
  }),
  "creative-portfolio": Object.freeze({
    id: "creative-portfolio",
    title: "Creative Portfolio & Studio Showcase",
    summary: "Distinctive editorial voice, confident display typography, asymmetric spatial rhythm, and restrained signature choreography.",
    defaultDensity: "spacious",
    defaultTheme: "light",
    typography: Object.freeze({
      headingFamily: "'Space Grotesk', 'Syne', system-ui, sans-serif",
      bodyFamily: "'Inter', 'DM Sans', system-ui, sans-serif",
      monoFamily: "'JetBrains Mono', ui-monospace, monospace",
      baseSizePx: 16,
      scaleRatio: 1.414,
      measureCh: 60,
    }),
    colorGuidance: Object.freeze({
      contrastTarget: "WCAG AA on body copy, project captions, and navigation links.",
      restraint: "High-conviction monochrome or warm-stone foundation paired with a single unforgettable signature accent.",
    }),
    layoutPrinciples: Object.freeze([
      "Use generous negative space and asymmetric editorial grids to create focal tension.",
      "Pair oversized display headlines (tight -0.03em tracking) with crisp small metadata labels.",
      "Keep scroll and reveal motion smooth, GPU-composited, and cleanly disabled under reduced motion.",
    ]),
    antiPatternsToAvoid: Object.freeze([
      "Generic three-column feature grids that look like every starter template.",
      "Cluttered floating cards competing with featured work.",
      "Scroll-jacking or non-composited animations that drop frames.",
    ]),
  }),
  editorial: Object.freeze({
    id: "editorial",
    title: "Editorial, Documentation & Publishing",
    summary: "Reading-first typographic craft with optimal measure, serene pacing, clear document hierarchy, and effortless scanning.",
    defaultDensity: "spacious",
    defaultTheme: "light",
    typography: Object.freeze({
      headingFamily: "'Newsreader', 'Source Serif 4', Georgia, serif",
      bodyFamily: "'Source Serif 4', 'Inter', Georgia, serif",
      monoFamily: "'JetBrains Mono', ui-monospace, monospace",
      baseSizePx: 18,
      scaleRatio: 1.333,
      measureCh: 66,
    }),
    colorGuidance: Object.freeze({
      contrastTarget: "WCAG AAA (7:1+) on primary reading surfaces with warm off-white or deep charcoal backgrounds to minimize glare.",
      restraint: "Ink-on-vellum tonal restraint; links and callouts distinguished by crisp underline and subtle surface tint.",
    }),
    layoutPrinciples: Object.freeze([
      "Constrain long-form reading columns strictly between 58ch and 72ch with 1.6 to 1.75 body line height.",
      "Use clean typographic hierarchy, rules, and margins rather than enclosing every section in card borders.",
      "Keep table-of-contents, footnotes, and code blocks aligned cleanly on a predictable baseline.",
    ]),
    antiPatternsToAvoid: Object.freeze([
      "Full-bleed 1200px wide paragraphs that force eye-tracking fatigue.",
      "Heavy card shadows around articles or documentation sections.",
      "Distracting hero gradients or decorative widgets above the headline.",
    ]),
  }),
  "consumer-mobile": Object.freeze({
    id: "consumer-mobile",
    title: "Consumer & Mobile-First Applications",
    summary: "Fluid, tactile, thumb-friendly interfaces with immediate feedback, clear single-task flows, and effortless responsiveness.",
    defaultDensity: "balanced",
    defaultTheme: "system",
    typography: Object.freeze({
      headingFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      bodyFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      monoFamily: "'SF Mono', 'JetBrains Mono', ui-monospace, monospace",
      baseSizePx: 16,
      scaleRatio: 1.25,
      measureCh: 56,
    }),
    colorGuidance: Object.freeze({
      contrastTarget: "WCAG AA in outdoor lighting and dark-mode evening contexts.",
      restraint: "Clean layered surfaces, clear active-tab indicators, and warm high-contrast interactive controls.",
    }),
    layoutPrinciples: Object.freeze([
      "Place primary navigation and core actions within natural bottom thumb reach on narrow viewports.",
      "Ensure every interactive control meets at least 44px by 44px touch-target sizing with 8px separation.",
      "Use tactile press micro-feedback (scale 0.97, 120ms ease-out) and clean sheet transitions.",
    ]),
    antiPatternsToAvoid: Object.freeze([
      "Desktop multi-column tables crammed into 375px viewports with horizontal overflow.",
      "Hover-only affordances with no touch or keyboard equivalent.",
      "Deeply nested boxes that shrink mobile content width.",
    ]),
  }),
  "admin-data": Object.freeze({
    id: "admin-data",
    title: "Admin Consoles & Data-Intensive Workspaces",
    summary: "High-signal analytical dashboards and operational consoles built for fast comparison, filtering, and zero-ambiguity actions.",
    defaultDensity: "compact",
    defaultTheme: "light",
    typography: Object.freeze({
      headingFamily: "'Inter', system-ui, -apple-system, sans-serif",
      bodyFamily: "'Inter', system-ui, -apple-system, sans-serif",
      monoFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
      baseSizePx: 14,
      scaleRatio: 1.2,
      measureCh: 70,
    }),
    colorGuidance: Object.freeze({
      contrastTarget: "WCAG AA on dense table rows, axis ticks, filter chips, and status indicators.",
      restraint: "Quiet neutral frame so charts, anomalies, and active filters carry immediate visual salience.",
    }),
    layoutPrinciples: Object.freeze([
      "Group KPI metrics, filter controls, and primary data tables in a scannable top-to-bottom diagnostic flow.",
      "Use tabular numerals, right-aligned quantitative columns, sticky headers, and subtle row dividers.",
      "Pair chart series colors with clear legends, direct labels, or patterns for color-vision accessibility.",
    ]),
    antiPatternsToAvoid: Object.freeze([
      "Oversized decorative KPI cards with thick gradients that push actual data below the fold.",
      "Unconstrained shadow stacks on every dashboard panel.",
      "Color-only severity dots without text or icon reinforcement.",
    ]),
  }),
});

export const ARCHETYPE_IDS = Object.freeze(Object.keys(DOMAIN_ARCHETYPES));

/** Resolve the closest domain archetype record (falls back to enterprise-saas for custom domains). */
export function getDomainArchetype(domain) {
  if (typeof domain === "string" && Object.hasOwn(DOMAIN_ARCHETYPES, domain)) {
    return DOMAIN_ARCHETYPES[domain];
  }
  return DOMAIN_ARCHETYPES["enterprise-saas"];
}

/** Validate and normalize a product design brief. */
export function normalizeDesignBrief(input) {
  const problem = briefProblem(input);
  if (problem !== null) throw new Error(`invalid design brief: ${problem}`);
  const archetype = getDomainArchetype(input.domain);
  return Object.freeze({
    productName: input.productName.trim(),
    domain: input.domain,
    archetypeId: archetype.id,
    audience: input.audience ?? "Product users and operators",
    brandTone: Object.freeze([...(input.brandTone ?? ["clear", "confident", "modern"])]),
    density: input.density ?? archetype.defaultDensity,
    themePreference: input.themePreference ?? archetype.defaultTheme,
    aestheticDirection: input.aestheticDirection,
    constraints: Object.freeze([...(input.constraints ?? [])]),
    allowExpressiveMotion: input.allowExpressiveMotion === true,
    allowEditorialGradients: input.allowEditorialGradients === true,
    notes: input.notes,
  });
}

function spacingTokensFor(density) {
  if (density === "compact") {
    return {
      "--space-1": "4px",
      "--space-2": "8px",
      "--space-3": "12px",
      "--space-4": "16px",
      "--space-6": "24px",
      "--space-8": "32px",
      "--space-section": "40px",
    };
  }
  if (density === "spacious") {
    return {
      "--space-1": "4px",
      "--space-2": "8px",
      "--space-3": "16px",
      "--space-4": "24px",
      "--space-6": "40px",
      "--space-8": "64px",
      "--space-section": "96px",
    };
  }
  return {
    "--space-1": "4px",
    "--space-2": "8px",
    "--space-3": "12px",
    "--space-4": "20px",
    "--space-6": "32px",
    "--space-8": "48px",
    "--space-section": "72px",
  };
}

function makeDirection({
  id,
  name,
  posture,
  rationale,
  palette,
  typography,
  density,
  radius,
  shadow,
  layoutStrategy,
  antiPatternsToAvoid,
}) {
  const spacing = spacingTokensFor(density);
  const tokens = [
    { name: "--bg-canvas", type: "color", light: palette.light.bgCanvas, dark: palette.dark.bgCanvas, description: "Primary page canvas background" },
    { name: "--bg-surface", type: "color", light: palette.light.bgSurface, dark: palette.dark.bgSurface, description: "Elevated card and panel surface" },
    { name: "--bg-subtle", type: "color", light: palette.light.bgSubtle, dark: palette.dark.bgSubtle, description: "Subtle secondary surface tint" },
    { name: "--text-primary", type: "color", light: palette.light.textPrimary, dark: palette.dark.textPrimary, description: "Primary readable foreground text" },
    { name: "--text-muted", type: "color", light: palette.light.textMuted, dark: palette.dark.textMuted, description: "Secondary metadata and helper text" },
    { name: "--border-subtle", type: "color", light: palette.light.borderSubtle, dark: palette.dark.borderSubtle, description: "Default structural hairline border" },
    { name: "--accent-primary", type: "color", light: palette.light.accentPrimary, dark: palette.dark.accentPrimary, description: "Primary brand interactive accent" },
    { name: "--accent-contrast", type: "color", light: palette.light.accentContrast, dark: palette.dark.accentContrast, description: "Foreground text on primary accent" },
    { name: "--status-success", type: "color", light: palette.light.success, dark: palette.dark.success, description: "Positive confirmation semantic color" },
    { name: "--status-warning", type: "color", light: palette.light.warning, dark: palette.dark.warning, description: "Caution semantic color" },
    { name: "--status-danger", type: "color", light: palette.light.danger, dark: palette.dark.danger, description: "Destructive or critical error color" },
    { name: "--font-heading", type: "fontFamily", light: typography.headingFamily, dark: typography.headingFamily, description: "Display and section heading font stack" },
    { name: "--font-body", type: "fontFamily", light: typography.bodyFamily, dark: typography.bodyFamily, description: "Primary UI and reading font stack" },
    { name: "--font-mono", type: "fontFamily", light: typography.monoFamily, dark: typography.monoFamily, description: "Monospace numeric and code font stack" },
    { name: "--text-sm", type: "fontSize", light: `${Math.max(12, typography.baseSizePx - 2)}px`, dark: `${Math.max(12, typography.baseSizePx - 2)}px`, description: "Compact caption and label size" },
    { name: "--text-base", type: "fontSize", light: `${typography.baseSizePx}px`, dark: `${typography.baseSizePx}px`, description: "Body text size" },
    { name: "--text-lg", type: "fontSize", light: `${Math.round(typography.baseSizePx * typography.scaleRatio)}px`, dark: `${Math.round(typography.baseSizePx * typography.scaleRatio)}px`, description: "Lead or card title size" },
    { name: "--text-xl", type: "fontSize", light: `${Math.round(typography.baseSizePx * typography.scaleRatio * typography.scaleRatio)}px`, dark: `${Math.round(typography.baseSizePx * typography.scaleRatio * typography.scaleRatio)}px`, description: "Section heading size" },
    { name: "--text-display", type: "fontSize", light: `${Math.round(typography.baseSizePx * typography.scaleRatio ** 3)}px`, dark: `${Math.round(typography.baseSizePx * typography.scaleRatio ** 3)}px`, description: "Primary hero or page title size" },
    ...Object.entries(spacing).map(([tokenName, val]) => ({
      name: tokenName,
      type: "spacing",
      light: val,
      dark: val,
      description: `Spacing scale step ${tokenName}`,
    })),
    { name: "--radius-sm", type: "radius", light: radius.sm, dark: radius.sm, description: "Small control and input corner radius" },
    { name: "--radius-md", type: "radius", light: radius.md, dark: radius.md, description: "Default card and container corner radius" },
    { name: "--radius-lg", type: "radius", light: radius.lg, dark: radius.lg, description: "Featured surface or dialog corner radius" },
    { name: "--shadow-sm", type: "shadow", light: shadow.lightSm, dark: shadow.darkSm, description: "Subtle resting surface elevation" },
    { name: "--shadow-md", type: "shadow", light: shadow.lightMd, dark: shadow.darkMd, description: "Interactive popover and dialog elevation" },
    { name: "--duration-fast", type: "duration", light: "150ms", dark: "150ms", description: "Micro-interaction hover and press duration" },
    { name: "--duration-normal", type: "duration", light: "220ms", dark: "220ms", description: "Default enter and state transition duration" },
    { name: "--ease-out", type: "easing", light: "cubic-bezier(0.23, 1, 0.32, 1)", dark: "cubic-bezier(0.23, 1, 0.32, 1)", description: "Primary responsive ease-out curve" },
  ];

  return Object.freeze({
    id,
    name,
    posture,
    rationale,
    density,
    typography,
    layoutStrategy,
    antiPatternsToAvoid,
    tokens: Object.freeze(tokens.map((entry) => Object.freeze(entry))),
  });
}

const DIRECTION_PALETTES = Object.freeze({
  precisionNeutral: Object.freeze({
    light: {
      bgCanvas: "#f8fafc",
      bgSurface: "#ffffff",
      bgSubtle: "#f1f5f9",
      textPrimary: "#0f172a",
      textMuted: "#475569",
      borderSubtle: "#e2e8f0",
      accentPrimary: "#0f766e",
      accentContrast: "#ffffff",
      success: "#15803d",
      warning: "#b45309",
      danger: "#b91c1c",
    },
    dark: {
      bgCanvas: "#0b0f14",
      bgSurface: "#121821",
      bgSubtle: "#18212e",
      textPrimary: "#f1f5f9",
      textMuted: "#94a3b8",
      borderSubtle: "#243041",
      accentPrimary: "#2dd4bf",
      accentContrast: "#042f2e",
      success: "#4ade80",
      warning: "#fbbf24",
      danger: "#f87171",
    },
  }),
  warmEditorial: Object.freeze({
    light: {
      bgCanvas: "#faf8f5",
      bgSurface: "#ffffff",
      bgSubtle: "#f3efe8",
      textPrimary: "#1c1917",
      textMuted: "#57534e",
      borderSubtle: "#e7e0d6",
      accentPrimary: "#1d4ed8",
      accentContrast: "#ffffff",
      success: "#166534",
      warning: "#a16207",
      danger: "#991b1b",
    },
    dark: {
      bgCanvas: "#141210",
      bgSurface: "#1d1a17",
      bgSubtle: "#26221e",
      textPrimary: "#f5f2ec",
      textMuted: "#a8a29e",
      borderSubtle: "#332e29",
      accentPrimary: "#60a5fa",
      accentContrast: "#0f172a",
      success: "#4ade80",
      warning: "#facc15",
      danger: "#f87171",
    },
  }),
  crispMonochrome: Object.freeze({
    light: {
      bgCanvas: "#ffffff",
      bgSurface: "#fafafa",
      bgSubtle: "#f4f4f5",
      textPrimary: "#09090b",
      textMuted: "#52525b",
      borderSubtle: "#e4e4e7",
      accentPrimary: "#18181b",
      accentContrast: "#ffffff",
      success: "#15803d",
      warning: "#b45309",
      danger: "#dc2626",
    },
    dark: {
      bgCanvas: "#09090b",
      bgSurface: "#111114",
      bgSubtle: "#1a1a1f",
      textPrimary: "#fafafa",
      textMuted: "#a1a1aa",
      borderSubtle: "#27272a",
      accentPrimary: "#f4f4f5",
      accentContrast: "#09090b",
      success: "#4ade80",
      warning: "#fbbf24",
      danger: "#f87171",
    },
  }),
});

/**
 * Produce three genuinely distinct, domain-grounded aesthetic directions with complete
 * light and dark token sets, typography scale, spacing rhythm, and layout posture.
 */
export function planDesignDirections(briefInput) {
  const brief = normalizeDesignBrief(briefInput);
  const archetype = getDomainArchetype(brief.domain);

  const directionA = makeDirection({
    id: `${archetype.id}-precision`,
    name: `Precision ${archetype.title.split("&")[0].trim()}`,
    posture: "Calm, high-clarity structural precision with hairline borders and WCAG AA+ semantic contrast.",
    rationale: `Matches ${brief.productName}'s ${brief.domain} domain with restrained neutral elevation, crisp teal accent hierarchy, and zero visual bloat.`,
    palette: DIRECTION_PALETTES.precisionNeutral,
    typography: archetype.typography,
    density: brief.density,
    radius: { sm: "6px", md: "10px", lg: "16px" },
    shadow: {
      lightSm: "0 1px 2px rgba(15, 23, 42, 0.06)",
      lightMd: "0 8px 24px rgba(15, 23, 42, 0.08)",
      darkSm: "0 1px 2px rgba(0, 0, 0, 0.35)",
      darkMd: "0 10px 28px rgba(0, 0, 0, 0.45)",
    },
    layoutStrategy: archetype.layoutPrinciples,
    antiPatternsToAvoid: archetype.antiPatternsToAvoid,
  });

  const directionB = makeDirection({
    id: `${archetype.id}-editorial`,
    name: "Warm Editorial Craft",
    posture: "Tactile stone surfaces, authoritative serif-sans pairing, and generous typographic breathing room.",
    rationale: `Elevates ${brief.productName} above generic template aesthetics by leaning into warm neutral contrast, confident scale contrast, and deliberate whitespace.`,
    palette: DIRECTION_PALETTES.warmEditorial,
    typography: Object.freeze({
      headingFamily: "'Newsreader', 'Instrument Serif', Georgia, serif",
      bodyFamily: archetype.typography.bodyFamily,
      monoFamily: archetype.typography.monoFamily,
      baseSizePx: Math.max(15, archetype.typography.baseSizePx),
      scaleRatio: Math.max(1.25, archetype.typography.scaleRatio),
      measureCh: Math.min(66, archetype.typography.measureCh),
    }),
    density: brief.density === "compact" ? "balanced" : "spacious",
    radius: { sm: "4px", md: "8px", lg: "12px" },
    shadow: {
      lightSm: "0 1px 2px rgba(28, 25, 23, 0.05)",
      lightMd: "0 6px 20px rgba(28, 25, 23, 0.07)",
      darkSm: "0 1px 2px rgba(0, 0, 0, 0.4)",
      darkMd: "0 8px 24px rgba(0, 0, 0, 0.5)",
    },
    layoutStrategy: Object.freeze([
      ...archetype.layoutPrinciples,
      "Replace unnecessary bordered boxes with subtle surface steps, typographic scale, and horizontal hairlines.",
    ]),
    antiPatternsToAvoid: archetype.antiPatternsToAvoid,
  });

  const directionC = makeDirection({
    id: `${archetype.id}-architectural`,
    name: "Architectural Monochrome",
    posture: "High-conviction monochrome ink and crisp geometric edges where content and data hold 100% of the visual focus.",
    rationale: `Ideal for ${brief.productName} when users spend hours inside the interface and need maximum signal-to-noise ratio with effortless dark and light symmetry.`,
    palette: DIRECTION_PALETTES.crispMonochrome,
    typography: Object.freeze({
      headingFamily: "'Space Grotesk', 'Inter', system-ui, sans-serif",
      bodyFamily: "'Inter', system-ui, -apple-system, sans-serif",
      monoFamily: archetype.typography.monoFamily,
      baseSizePx: archetype.typography.baseSizePx,
      scaleRatio: archetype.typography.scaleRatio,
      measureCh: archetype.typography.measureCh,
    }),
    density: brief.density === "spacious" ? "balanced" : "compact",
    radius: { sm: "4px", md: "6px", lg: "10px" },
    shadow: {
      lightSm: "0 1px 1px rgba(9, 9, 11, 0.04)",
      lightMd: "0 4px 16px rgba(9, 9, 11, 0.08)",
      darkSm: "0 1px 2px rgba(0, 0, 0, 0.5)",
      darkMd: "0 8px 24px rgba(0, 0, 0, 0.6)",
    },
    layoutStrategy: Object.freeze([
      ...archetype.layoutPrinciples,
      "Use strict 4px baseline alignment, crisp 1px borders, and high-contrast monochrome primaries reserved for the single key action per region.",
    ]),
    antiPatternsToAvoid: archetype.antiPatternsToAvoid,
  });

  return Object.freeze({
    brief,
    archetype,
    recommendedDirectionId: brief.themePreference === "dark" && brief.domain === "developer-tools"
      ? directionC.id
      : (brief.domain === "editorial" || brief.domain === "ecommerce" || brief.domain === "creative-portfolio")
        ? directionB.id
        : directionA.id,
    directions: Object.freeze([directionA, directionB, directionC]),
  });
}
