// Ninerr Programmatic Local SDK:
// Curated, zero-egress, Apache-2.0 JavaScript API for embedding Ninerr's deterministic
// design intelligence, component library, design-system ops, real-browser Vision/Critic,
// framework exporters, existing-app redesign engine, and local research packs in Node.js.

export {
  ARCHETYPE_IDS,
  DOMAIN_ARCHETYPES,
  MOTION_PRESETS,
  MOTION_PRESET_IDS,
  MOTION_TOKENS,
  compileMotionReact,
  compileMotionStylesheet,
  evaluateMotionFrequency,
  evaluateTaste,
  getDomainArchetype,
  getSkill,
  lintMotionCss,
  listSkills,
  planDesignDirections,
  renderSkillMarkdown,
} from "@ninerr/design-intelligence";

export {
  NINERR_COMPONENT_CATEGORIES,
  buildComponentOperations,
  getNinerrComponent,
  searchNinerrComponents,
} from "@ninerr/component-sources";

export {
  STANDARD_VIEWPORTS,
  buildCritiqueReport,
  diffPngBuffers,
  discoverBrowser,
  improveDesignInMemory,
  renderAndInspect,
} from "@ninerr/vision";

export {
  DOCUMENT_SCHEMA_VERSION,
  compileTokens,
  createDocument,
  designSystemOf,
} from "@ninerr/document-model";

export {
  createProject,
  openProject,
} from "@ninerr/persistence";

export {
  exportAstro,
  exportHtml,
  exportJsx,
  exportSvelte,
  exportTailwind,
  exportVue,
  importJsx,
} from "./code.ts";

export {
  exportDtcgTokens,
  planDtcgTokens,
} from "./tokens-dtcg.ts";

export {
  auditDesignSystem,
  compileBreakpointsStylesheet,
  generateHighContrastMode,
  planRegistryItemUpdate,
  planThemeMigration,
} from "./design-system-ops.ts";

export {
  REDESIGN_LIMITS,
  analyzeCodebase,
  applyRedesignPlan,
  extractCssCustomProperties,
  patchCssTokensSource,
  patchJsxClassStrings,
  planRedesign,
  rollbackRedesign,
  verifyCssTokenPatchInvariance,
  verifyFunctionalInvariance,
} from "./redesign.ts";

export {
  RESEARCH_LIMITS,
  createLocalReferencePack,
  extractPatternsFromSource,
  listLocalReferencePacks,
  writeLocalReferencePack,
} from "./research.ts";
