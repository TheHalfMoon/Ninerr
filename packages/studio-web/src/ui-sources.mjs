// Curated, read-only discovery of component libraries requested for Ninerr.
// This is metadata, never component source. No network access, package installation,
// generated script execution, or permission to redistribute is implied.
const SOURCES = [
  {
    id: "shadcn", name: "shadcn/ui", group: "Foundation",
    purpose: "Copy-owned, customizable components and registry format.",
    website: "https://ui.shadcn.com", source: "https://github.com/shadcn-ui/ui",
    usage: "In a React project, initialize shadcn with one primitive base, then add selected components.",
    install: "npx shadcn@latest init",
    rights: "MIT for upstream code; check every third-party registry item.",
    gate: "manual-install",
  },
  {
    id: "base-ui", name: "Base UI", group: "Foundation",
    purpose: "Accessible, unstyled React primitives. Preferred base for new shadcn projects.",
    website: "https://base-ui.com", source: "https://github.com/mui/base-ui",
    usage: "Use as the default underlying primitive set for new React output, never alongside Radix for the same component.",
    install: "npm install @base-ui/react",
    rights: "Review the selected version and its license before vendoring.",
    gate: "manual-install",
  },
  {
    id: "radix-ui", name: "Radix UI", group: "Foundation",
    purpose: "Accessible React primitives and an alternative shadcn base.",
    website: "https://www.radix-ui.com/primitives", source: "https://github.com/radix-ui/primitives",
    usage: "Preserve for imported or existing Radix projects; avoid automatically migrating them to Base UI.",
    install: "npx shadcn@latest init -b radix",
    rights: "Review the selected version and its license before vendoring.",
    gate: "manual-install",
  },
  {
    id: "sonner", name: "Sonner", group: "Specialist",
    purpose: "Accessible notification toasts and stacked feedback.",
    website: "https://sonner.emilkowal.ski", source: "https://github.com/emilkowalski/sonner",
    usage: "Toast feedback for exported React interfaces.",
    install: "npm install sonner",
    rights: "MIT upstream; retain applicable notices.",
    gate: "manual-install",
  },
  {
    id: "vaul", name: "Vaul", group: "Specialist",
    purpose: "Gesture-driven drawers and mobile sheets.",
    website: "https://vaul.emilkowal.ski", source: "https://github.com/emilkowalski/vaul",
    usage: "Use for project components that require Vaul-style drag physics, not every drawer.",
    install: "npm install vaul",
    rights: "Review upstream version and applicable notices.",
    gate: "manual-install",
  },
  {
    id: "cmdk", name: "cmdk", group: "Specialist",
    purpose: "Keyboard-friendly searchable command palettes.",
    website: "https://github.com/dip/cmdk", source: "https://github.com/dip/cmdk",
    usage: "Command menu for exported React apps; shadcn Command may already use cmdk.",
    install: "npm install cmdk",
    rights: "Review upstream version and applicable notices.",
    gate: "manual-install",
  },
  {
    id: "numberflow", name: "NumberFlow", group: "Specialist",
    purpose: "Accessible, localized animated numerical values.",
    website: "https://number-flow.barvian.me", source: "https://github.com/barvian/number-flow",
    usage: "Counters, values, dashboards and metrics that visibly update.",
    install: "npm install @number-flow/react",
    rights: "Review upstream version and applicable notices.",
    gate: "manual-install",
  },
  {
    id: "beautiful-ui", name: "Beautiful UI (Turbo)", group: "Gallery",
    purpose: "Agent-oriented AI interfaces: approvals, tool calls, reasoning and diff tables.",
    website: "https://www.beautifului.dev", source: "https://www.beautifului.dev",
    usage: "Copy selected components with a source-specific check; not the unrelated beautiful-ui.dev Notchset registry.",
    install: "Open https://www.beautifului.dev and copy a selected component from its source page.",
    rights: "The publisher states MIT; retain the copyright and license notice.",
    gate: "manual-source-review",
  },
  {
    id: "rareui", name: "RareUI (Swappy)", group: "Gallery",
    purpose: "Expressive buttons, text effects and motion components.",
    website: "https://rareui.in", source: "https://github.com/Codewithswappy/RareUI",
    usage: "Use individual animated elements with reduced-motion support. Not the separate rareui.com library.",
    install: "npx rareui add liquid-metal",
    rights: "RareUI at rareui.in states MIT; the separate rareui.com project has additional restrictions.",
    gate: "manual-source-review",
  },
  {
    id: "magic-ui", name: "Magic UI", group: "Gallery",
    purpose: "Motion-rich copy-owned sections and interaction patterns.",
    website: "https://magicui.design", source: "https://github.com/magicuidesign/magicui",
    usage: "Install selected free registry components; treat Pro as separate licensing.",
    install: "npx shadcn@latest add @magicui/marquee",
    rights: "Review per-item license; do not ingest paid or Pro source automatically.",
    gate: "manual-source-review",
  },
  {
    id: "aceternity", name: "Aceternity UI", group: "Gallery",
    purpose: "High-impact landing-page effects, bento layouts and interactive cards.",
    website: "https://ui.aceternity.com", source: "https://ui.aceternity.com/installation",
    usage: "Use explicitly selected components from the official shadcn-compatible registry.",
    install: "npx shadcn@latest add @aceternity/bento-grid",
    rights: "Check each item and Pro restrictions before reuse.",
    gate: "manual-source-review",
  },
  {
    id: "21st", name: "21st.dev", group: "Marketplace",
    purpose: "Discover community-built React components, templates, themes and interactions.",
    website: "https://21st.dev", source: "https://github.com/21st-dev",
    usage: "Review the individual author, code, license and dependencies before importing an item.",
    install: "Browse https://21st.dev and select an individual component.",
    rights: "Marketplace items have different authors and terms; never assume a site-wide license.",
    gate: "per-item-review",
  },
];

// Copies rather than a live provider integration. Keep source identity unambiguous.
export const UI_COMPONENT_SOURCES = Object.freeze(SOURCES.map((source) => Object.freeze({ ...source })));
export const UI_COMPONENT_SOURCE_GROUPS = Object.freeze(["All", "Foundation", "Specialist", "Gallery", "Marketplace"]);

export function searchUiComponentSources({ query = "", group = "All" } = {}) {
  if (typeof query !== "string" || query.length > 200) throw new TypeError("query must be a string of at most 200 characters");
  if (!UI_COMPONENT_SOURCE_GROUPS.includes(group)) throw new TypeError("unknown component-source group");
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return UI_COMPONENT_SOURCES.filter((source) =>
    (group === "All" || source.group === group) &&
    words.every((word) =>
      [source.name, source.purpose, source.usage, source.group].join(" ").toLocaleLowerCase().includes(word)),
  );
}
