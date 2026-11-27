// Official Ninerr Agent Skills (19 domain-specific design intelligence skills).
// Every MCP tool referenced in `recommendedTools` is validated by automated tests
// against Ninerr's live MCP catalog and lifecycle tools so skills never drift or cite
// non-existent tools.

const SKILLS = [
  {
    id: "product-design",
    title: "Product Design",
    summary: "Frame user goals, information architecture, state coverage, and design direction before writing pixels or markup.",
    whenToUse: "Starting any new feature, screen, or product from a prompt or problem statement.",
    recommendedTools: ["design_intelligence", "set_design_brief", "create_layers", "inspect_document"],
    principles: [
      "Define the product domain, target user, density posture, and core task before generating components.",
      "Compare at least two distinct aesthetic directions rather than defaulting to generic template defaults.",
      "Design empty, loading, validation-error, and success states alongside the happy path.",
    ],
    antiPatterns: [
      "Jumping straight into decorative hero blocks without clarifying hierarchy or primary user task.",
      "Copying competitor layout chrome that does not match the user workflow.",
    ],
    checklist: [
      "Product brief stored on the design-system node via set_design_brief.",
      "Primary user action is unmistakable within 3 seconds of viewing the layout.",
      "Secondary metadata never competes visually with primary actions or key metrics.",
    ],
  },
  {
    id: "frontend-design",
    title: "Frontend Design",
    summary: "Author semantic, token-driven HTML, CSS, and TSX interfaces with crisp layout rhythm and zero visual bloat.",
    whenToUse: "Building production web interfaces, marketing sites, or web application views.",
    recommendedTools: ["design_intelligence", "create_layers", "list_tokens", "export_design"],
    principles: [
      "Author semantic HTML landmarks (header, nav, main, section, article, footer) and real buttons or links.",
      "Bind colors, spacing, typography, radii, and motion to design-system var(--token) custom properties.",
      "Use intentional contrast, typographic hierarchy, and whitespace instead of nested boxes.",
    ],
    antiPatterns: [
      "Div-soup clickable containers lacking keyboard focus or semantic roles.",
      "Hardcoding arbitrary hex values and 13px or 19px off-grid padding values.",
    ],
    checklist: [
      "All surfaces and foregrounds reference design-system tokens.",
      "Exported TSX or HTML is clean, readable, and deterministic.",
      "No horizontal overflow or cramped line-heights.",
    ],
  },
  {
    id: "landing-pages",
    title: "Landing Pages",
    summary: "Craft high-conviction product narratives with distinctive hero framing, scannable proof, and focused conversion cadence.",
    whenToUse: "Designing product launch pages, marketing homepages, or announcement microsites.",
    recommendedTools: ["design_intelligence", "set_design_brief", "create_layers", "apply_motion", "export_design"],
    principles: [
      "Open with a sharp value proposition, single primary CTA, and real product artifact or visual proof above the fold.",
      "Alternate visual cadence across sections instead of repeating identical three-column icon-card rows.",
      "Use generous vertical rhythm (--space-section) and disciplined type scale contrast (h1 >= 2.5x body).",
    ],
    antiPatterns: [
      "Generic purple-gradient hero with floating glass badges and meaningless stock metrics.",
      "Stacking four competing CTAs or five badge pills in the hero header.",
    ],
    checklist: [
      "Hero headline, subcopy, and primary CTA fit cleanly above the fold on desktop and mobile.",
      "Each section has a distinct visual structure serving a single persuasive job.",
      "Motion reveals stay subtle, GPU-composited, and obey prefers-reduced-motion.",
    ],
  },
  {
    id: "application-interfaces",
    title: "Application Interfaces",
    summary: "Structure durable software workspaces with clear navigation landmarks, predictable controls, and low cognitive load.",
    whenToUse: "Designing SaaS applications, editors, workspaces, settings panels, and CRUD tools.",
    recommendedTools: ["set_design_brief", "create_layers", "create_component", "create_instance", "inspect_document"],
    principles: [
      "Separate persistent shell chrome from contextual workspace content with quiet 1px borders and subtle tonal steps.",
      "Reserve the primary filled button style for at most one decisive action per view or dialog.",
      "Keep frequent workflow interactions immediate with zero theatrical entrance lag.",
    ],
    antiPatterns: [
      "Card-inside-card nesting that steals workspace viewport area.",
      "Oversized marketing typography inside operational toolbars.",
    ],
    checklist: [
      "Navigation, active state, and contextual actions are immediately discoverable.",
      "Reusable UI patterns are promoted to component definitions.",
      "Destructive actions are visually separated and require explicit confirmation.",
    ],
  },
  {
    id: "dashboards",
    title: "Dashboards",
    summary: "Design high-signal analytical and operational dashboards where data anomalies and key trends stand out immediately.",
    whenToUse: "Building analytics consoles, monitoring screens, executive summaries, or financial overviews.",
    recommendedTools: ["design_intelligence", "set_design_brief", "create_layers", "list_tokens"],
    principles: [
      "Apply font-variant-numeric: tabular-nums on all KPI numbers, deltas, and quantitative table columns.",
      "Lead with 3 to 5 decision-driving KPIs, followed by primary trend visualization and filterable detail rows.",
      "Keep chrome quiet so data series, thresholds, and active filters carry visual salience.",
    ],
    antiPatterns: [
      "Rainbow gradient KPI cards with heavy drop shadows obscuring the actual metrics.",
      "Color-only status dots without text labels, icons, or directional indicators.",
    ],
    checklist: [
      "All numeric columns align cleanly with tabular numerals.",
      "Status indicators remain intelligible without color vision.",
      "Compact 4px and 8px spacing keeps high-signal data above the fold.",
    ],
  },
  {
    id: "mobile-responsive",
    title: "Mobile & Responsive Design",
    summary: "Ensure fluid, touch-friendly ergonomics from 320px compact phones through ultrawide desktop displays.",
    whenToUse: "Designing mobile apps, responsive web layouts, or adapting desktop views to small viewports.",
    recommendedTools: ["design_intelligence", "create_layers", "edit_layer", "export_design"],
    principles: [
      "Size interactive mobile touch targets to at least 44px by 44px with clear spacing between adjacent controls.",
      "Collapse multi-column grids gracefully into prioritized single-column flows with zero horizontal scroll.",
      "Gate hover effects behind @media (hover: hover) and (pointer: fine) so touch devices never get stuck hover states.",
    ],
    antiPatterns: [
      "Fixed pixel widths on containers that overflow 375px viewports.",
      "Hover-only tooltips hiding critical information on touch screens.",
    ],
    checklist: [
      "Zero clipped headings or horizontal overflow at 320px and 375px widths.",
      "Primary actions stay easy to reach without awkward top-corner stretching.",
      "Typography scales comfortably without microscopic captions under 12px.",
    ],
  },
  {
    id: "design-systems",
    title: "Design Systems",
    summary: "Build scalable token hierarchies, multi-mode themes, and composable component libraries with zero token drift.",
    whenToUse: "Establishing or auditing a shared token architecture, theme modes, or component library.",
    recommendedTools: ["list_tokens", "create_token", "edit_token", "add_token_mode", "rename_token", "inspect_token_drift", "create_component"],
    principles: [
      "Separate primitive values, semantic surface-text-accent roles, and component-specific overrides.",
      "Support light, dark, and high-contrast modes through semantic aliases rather than duplicated stylesheets.",
      "Audit and eliminate literal color and spacing drift so theme switches stay atomic and predictable.",
    ],
    antiPatterns: [
      "Naming semantic tokens by raw hue (--blue-text) instead of role (--accent-primary).",
      "Allowing components to hardcode hex literals that break in dark mode.",
    ],
    checklist: [
      "All semantic tokens resolve cleanly across every collection mode.",
      "No circular aliases or unused orphan tokens.",
      "Token drift against connected stylesheets is verified with inspect_token_drift.",
    ],
  },
  {
    id: "typography",
    title: "Typography",
    summary: "Achieve crisp readability and expressive hierarchy through intentional font pairing, modular scale, measure, and tracking.",
    whenToUse: "Selecting font stacks, tuning heading scales, improving long-form readability, or fixing visual flatness.",
    recommendedTools: ["design_intelligence", "create_token", "edit_layer"],
    principles: [
      "Limit each product to 1 to 3 coordinated font families (heading, body, mono) with reliable fallbacks.",
      "Pair tight display line-height (1.05 to 1.2) and slight negative tracking with comfortable body leading (1.5 to 1.7).",
      "Keep long-form paragraph measure between 58ch and 72ch so lines scan effortlessly.",
    ],
    antiPatterns: [
      "Flat heading sizes where h1, h2, and body barely differ in scale or weight.",
      "Full-width 1200px prose blocks with cramped 1.15 line-height.",
    ],
    checklist: [
      "Clear h1 -> h2 -> h3 -> body -> caption scale progression.",
      "Tabular numerals applied to dashboards, pricing, and tables.",
      "Body text stays readable (>= 14px for compact apps, >= 16px for editorial and marketing).",
    ],
  },
  {
    id: "color",
    title: "Color Systems",
    summary: "Construct restrained, accessible tonal palettes with calibrated surface steps and verified WCAG contrast.",
    whenToUse: "Creating brand palettes, building dark mode, or resolving contrast and visual-noise issues.",
    recommendedTools: ["design_intelligence", "create_token", "add_token_mode", "set_layer_mode"],
    principles: [
      "Anchor 85% to 90% of the viewport in calibrated neutrals so brand and semantic colors communicate meaning.",
      "Verify >= 4.5:1 contrast for normal text and >= 3:1 for large headings and interactive boundaries across every mode.",
      "Build dark modes by tuning surface elevation lightness steps and softening stark contrast, not mechanically inverting hex codes.",
    ],
    antiPatterns: [
      "Four competing vibrant accent hues fighting across the same screen.",
      "Pure #000000 backgrounds paired with neon saturated text causing halation.",
    ],
    checklist: [
      "Every foreground-background pair passes WCAG AA in light and dark modes.",
      "Semantic success, warning, and danger tokens stay distinct and accessible.",
      "Accents highlight priority actions rather than decorating static chrome.",
    ],
  },
  {
    id: "motion",
    title: "Motion Engineering",
    summary: "Apply purposeful, tactile, GPU-composited motion with interaction-frequency restraint and full reduced-motion safety.",
    whenToUse: "Adding transitions, entrances, modals, drawers, toasts, or reviewing animation performance.",
    recommendedTools: ["design_intelligence", "apply_motion", "edit_layer"],
    principles: [
      "Animate compositor-only properties (transform, opacity, clip-path); never animate width, height, margin, padding, or transition: all.",
      "Keep interactive UI transitions crisp (100ms to 300ms) with responsive ease-out curves (cubic-bezier(0.23, 1, 0.32, 1)).",
      "Skip or minimize animations on high-frequency 100-per-day and keyboard actions, and always include @media (prefers-reduced-motion: reduce).",
    ],
    antiPatterns: [
      "Slow 600ms bounces on modals, dropdowns, or frequent tab switches.",
      "Ambient infinite floating animations on static cards.",
    ],
    checklist: [
      "Motion tokens (--duration-*, --ease-*) are defined in the design system.",
      "Zero layout-thrashing animated properties.",
      "Every animated node includes a prefers-reduced-motion fallback.",
    ],
  },
  {
    id: "accessibility",
    title: "Accessibility",
    summary: "Guarantee WCAG 2.1 AA compliance across semantics, keyboard focus, contrast, landmarks, and assistive labels.",
    whenToUse: "Auditing or authoring any user-facing interface before shipping.",
    recommendedTools: ["design_intelligence", "inspect_document", "layer_tree", "edit_layer"],
    principles: [
      "Provide explicit accessible names for every image, icon button, link, and form control.",
      "Maintain logical heading order (h1 -> h2 -> h3 without skipping levels) and visible focus-visible rings.",
      "Meet WCAG AA contrast (4.5:1 normal, 3:1 large) and minimum target sizes (>= 24px desktop, >= 44px mobile).",
    ],
    antiPatterns: [
      "Removing outline: none without providing an equally visible focus-visible alternative.",
      "Using placeholder text as the sole label for form inputs.",
    ],
    checklist: [
      "Every form input has a visible or programmatically associated label.",
      "All images have meaningful alt text or alt='' if strictly decorative.",
      "Contrast, target sizes, and reduced-motion rules pass deterministic checks.",
    ],
  },
  {
    id: "component-selection",
    title: "Component Selection",
    summary: "Choose clean, accessible, license-verified components that fit the project stack and token architecture.",
    whenToUse: "Selecting reusable primitives, patterns, or external registry components for an interface.",
    recommendedTools: ["search_components", "get_component", "import_component", "list_components", "create_instance"],
    principles: [
      "Prefer accessible headless primitives and token-bound components over brittle ad-hoc markup.",
      "Keep one coherent primitive family per component set instead of mixing conflicting UI kits.",
      "Inspect provenance, license, and dependency footprint before adopting any external component.",
    ],
    antiPatterns: [
      "Importing heavyweight monolithic widget bundles for a single button or dialog.",
      "Flattening reusable interactive components into unlinked one-off layers.",
    ],
    checklist: [
      "Selected components align with the active design system tokens.",
      "License and dependency footprint verified via get_component.",
      "Instances expose clean override props for content and variants.",
    ],
  },
  {
    id: "design-criticism",
    title: "Design Criticism",
    summary: "Deliver rigorous, evidence-backed design critiques separating objective defects from brief-aware heuristics and optional taste.",
    whenToUse: "Reviewing any draft design, generated page, or redesign proposal.",
    recommendedTools: ["design_intelligence", "inspect_document", "layer_tree", "inspect_layer", "list_tokens"],
    principles: [
      "Resolve deterministic defects (contrast failures, tiny targets, broken motion rules, accessibility errors) first.",
      "Evaluate aesthetic choices strictly against the active product brief rather than dogmatic universal rules.",
      "Provide concrete, minimal, actionable changes referencing exact node IDs and token names.",
    ],
    antiPatterns: [
      "Vague feedback like 'make it pop' without specific hierarchy, spacing, or contrast evidence.",
      "Conflating subjective style preferences with objective accessibility defects.",
    ],
    checklist: [
      "Findings separated into deterministic defects, heuristic observations, and subjective suggestions.",
      "Every finding links to a concrete node or token and states a clear fix.",
      "High-severity defects are repaired before polishing subjective details.",
    ],
  },
  {
    id: "existing-app-redesign",
    title: "Existing Application Redesign",
    summary: "Elevate the visual craft and UX of an existing codebase while strictly preserving business logic, routing, and state.",
    whenToUse: "Modernizing or polishing an existing production web or desktop app without regressions.",
    recommendedTools: ["design_intelligence", "set_design_brief", "import_source", "inspect_token_drift", "export_design"],
    principles: [
      "Inventory existing routes, state hooks, event handlers, and test selectors before touching a single style.",
      "Start with token and theme normalization (Tier 1 CSS variables), then refine layout spacing and visual hierarchy.",
      "Never alter business logic, API payloads, form field names, or keyboard shortcuts during a visual redesign.",
    ],
    antiPatterns: [
      "Rewriting working components from scratch and accidentally dropping validation or error handling.",
      "Renaming existing CSS custom properties consumed elsewhere in the application.",
    ],
    checklist: [
      "Original functional contracts and event handlers remain 100% intact.",
      "Visual improvements use coherent design-system tokens.",
      "Changes are reversible through history or clean targeted diffs.",
    ],
  },
  {
    id: "design-to-code",
    title: "Design to Code",
    summary: "Export clean, maintainable HTML, JSX, TSX, Tailwind, CSS variables, and W3C DTCG tokens directly from the canonical document.",
    whenToUse: "Turning an approved Ninerr design into production source files or token packages.",
    recommendedTools: ["inspect_document", "list_tokens", "export_design"],
    principles: [
      "Verify token bindings and semantic tags before exporting so emitted code is clean and idiomatic.",
      "Export design tokens alongside component code (tokens-css or tokens-json) so styling stays parameterized.",
      "Use dryRun previews first and never overwrite human-edited files silently.",
    ],
    antiPatterns: [
      "Exporting unsemantic deeply nested divs with hardcoded pixel positions.",
      "Dropping mode selectors or reduced-motion rules during code handoff.",
    ],
    checklist: [
      "Semantic tags and accessible attributes preserved in output.",
      "Token stylesheet or DTCG JSON exported alongside component markup.",
      "Exported code passes syntax and accessibility verification.",
    ],
  },
  {
    id: "code-to-design",
    title: "Code to Design",
    summary: "Bring existing HTML, JSX, CSS variables, and DTCG token files into Ninerr for structured critique, editing, and evolution.",
    whenToUse: "Onboarding an existing interface or token file into a Ninerr design project.",
    recommendedTools: ["import_source", "inspect_document", "layer_tree", "list_tokens", "inspect_token_drift"],
    principles: [
      "Import tokens first (tokens-css or tokens-json) so imported markup immediately resolves semantic variables.",
      "Preserve structural hierarchy and provenance when importing HTML or JSX fragments.",
      "Run design_intelligence taste critique immediately after import to surface high-leverage visual improvements.",
    ],
    antiPatterns: [
      "Importing raw markup without loading its design-system tokens first.",
      "Treating imported snapshots as immutable images instead of editable semantic layers.",
    ],
    checklist: [
      "Tokens imported cleanly with zero cycle or syntax errors.",
      "Imported layers inspected via layer_tree and verified for semantic clarity.",
      "Baseline critique recorded before beginning iterative improvements.",
    ],
  },
  {
    id: "visual-verification",
    title: "Visual Verification",
    summary: "Verify layout hierarchy, token application, dark-mode fidelity, and responsive behavior rather than trusting markup in isolation.",
    whenToUse: "Validating any substantial layout creation, theme migration, or redesign before concluding work.",
    recommendedTools: ["export_design", "design_intelligence", "set_layer_mode", "inspect_document"],
    principles: [
      "Verify both light and dark modes (and high-contrast where configured) before calling a design complete.",
      "Check both compact mobile and desktop layouts for clipping, overflow, and hierarchy balance.",
      "Re-run critique after every significant edit to confirm improvements introduce zero regressions.",
    ],
    antiPatterns: [
      "Assuming a CSS declaration looks balanced without verifying contrast, hierarchy, and spacing scale.",
      "Declaring victory after checking only a single 1440px desktop light-mode snapshot.",
    ],
    checklist: [
      "HTML preview exported cleanly with compiled token styles.",
      "Both light and dark modes verified against contrast targets.",
      "Zero unresolved deterministic defects remain.",
    ],
  },
  {
    id: "brand-adaptation",
    title: "Brand Adaptation",
    summary: "Translate an organization's tone, palette, typography, and personality faithfully across modes without losing usability.",
    whenToUse: "Tailoring a design system or component set to match a specific brand identity.",
    recommendedTools: ["set_design_brief", "design_intelligence", "edit_token", "add_token_mode", "set_layer_mode"],
    principles: [
      "Capture brand tone, constraints, and audience in the design brief before tuning tokens.",
      "Calibrate brand accent shades for AA/AAA legibility on both light and dark surfaces rather than pasting raw print hex values.",
      "Express brand personality primarily through typography, surface warmth, radius geometry, and editorial voice.",
    ],
    antiPatterns: [
      "Flooding every background panel with saturated brand primary color.",
      "Sacrificing readable body contrast to preserve an uncalibrated bright brand yellow or cyan.",
    ],
    checklist: [
      "Brand tone and constraints documented in the project brief.",
      "Primary brand accent passes WCAG AA with its paired --accent-contrast token.",
      "Typography and corner radii reinforce the brand posture consistently.",
    ],
  },
  {
    id: "ux",
    title: "UX & Interaction Clarity",
    summary: "Reduce user friction through clear information scent, progressive disclosure, forgiving flows, and explicit feedback.",
    whenToUse: "Designing multi-step workflows, onboarding, forms, navigation, or diagnosing usability friction.",
    recommendedTools: ["set_design_brief", "design_intelligence", "create_layers", "list_history", "undo"],
    principles: [
      "Keep forms concise with clear visible labels, sensible defaults, inline validation, and specific recovery guidance.",
      "Use progressive disclosure so novices see the essentials while power users reach advanced controls cleanly.",
      "Provide immediate, unambiguous state feedback for loading, saved, error, and empty conditions.",
    ],
    antiPatterns: [
      "Hiding critical instructions inside placeholder text that disappears on focus.",
      "Forcing users through unnecessary modal confirmation chains for safe reversible actions.",
    ],
    checklist: [
      "Every screen has one clear primary user task and obvious escape or back path.",
      "Error and empty states guide users directly to the next useful action.",
      "Terminology is plain, consistent, and free of internal jargon.",
    ],
  },
];

export const OFFICIAL_SKILLS = Object.freeze(
  SKILLS.map((skill) => Object.freeze({
    ...skill,
    recommendedTools: Object.freeze([...skill.recommendedTools]),
    principles: Object.freeze([...skill.principles]),
    antiPatterns: Object.freeze([...skill.antiPatterns]),
    checklist: Object.freeze([...skill.checklist]),
  })),
);

const SKILL_MAP = new Map(OFFICIAL_SKILLS.map((skill) => [skill.id, skill]));
export const SKILL_IDS = Object.freeze(OFFICIAL_SKILLS.map((skill) => skill.id));

/** Return summaries of all 19 official Ninerr design skills, optionally filtered by keyword. */
export function listSkills(query = "") {
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  const matched = needle === ""
    ? OFFICIAL_SKILLS
    : OFFICIAL_SKILLS.filter((skill) => (
      skill.id.includes(needle)
      || skill.title.toLowerCase().includes(needle)
      || skill.summary.toLowerCase().includes(needle)
      || skill.whenToUse.toLowerCase().includes(needle)
    ));
  return matched.map((skill) => ({
    id: skill.id,
    title: skill.title,
    summary: skill.summary,
    whenToUse: skill.whenToUse,
    recommendedTools: skill.recommendedTools,
  }));
}

/** Retrieve one official Ninerr skill by id, or null if not found. */
export function getSkill(id) {
  if (typeof id !== "string") return null;
  return SKILL_MAP.get(id.trim().toLowerCase()) ?? null;
}

/** Render an official Ninerr skill as a portable SKILL.md document for coding agents. */
export function renderSkillMarkdown(skillOrId) {
  const skill = typeof skillOrId === "string" ? getSkill(skillOrId) : skillOrId;
  if (!skill) throw new Error(`unknown Ninerr skill: ${String(skillOrId)}`);
  return [
    "---",
    `name: ninerr-${skill.id}`,
    `description: ${skill.summary}`,
    "---",
    "",
    `# Ninerr Skill: ${skill.title}`,
    "",
    `## When to use`,
    skill.whenToUse,
    "",
    `## Recommended Ninerr MCP tools`,
    ...skill.recommendedTools.map((tool) => `- \`${tool}\``),
    "",
    `## Core principles`,
    ...skill.principles.map((item) => `- ${item}`),
    "",
    `## Anti-patterns to avoid`,
    ...skill.antiPatterns.map((item) => `- ${item}`),
    "",
    `## Verification checklist`,
    ...skill.checklist.map((item) => `- [ ] ${item}`),
    "",
  ].join("\n");
}
