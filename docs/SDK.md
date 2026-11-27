# Ninerr Programmatic Local SDK

Ninerr ships a local-first, zero-egress, Apache-2.0 JavaScript SDK alongside the `ninerr` CLI and MCP server. Every deterministic capability works offline with zero mandatory cloud accounts, API keys, or model downloads.

## Installation

Install the Ninerr Engine package (or import directly from the built tarball):

```js
import {
  planDesignDirections,
  evaluateTaste,
  compileMotionStylesheet,
  searchNinerrComponents,
  auditDesignSystem,
  buildCritiqueReport,
  improveDesignInMemory,
  exportHtml,
  exportVue,
  exportSvelte,
  exportAstro,
  analyzeCodebase,
  planRedesign,
  verifyFunctionalInvariance,
  extractPatternsFromSource,
  createLocalReferencePack,
} from "ninerr"; // or "ninerr/sdk"
```

## Capabilities

### 1. Design Intelligence, Taste & Motion
- `DOMAIN_ARCHETYPES`, `ARCHETYPE_IDS`, `getDomainArchetype(id)`
- `planDesignDirections({ domain, productName, audience, density, themePreference })` — generates 3 distinct WCAG-AA token-ready aesthetic directions
- `evaluateTaste(document, { rootId })` — brief-aware deterministic defect, heuristic, and subjective critique
- `MOTION_TOKENS`, `MOTION_PRESETS`, `compileMotionStylesheet(...)`, `compileMotionReact(...)`, `evaluateMotionFrequency(...)`, `lintMotionCss(...)`
- `listSkills()`, `getSkill(id)`, `renderSkillMarkdown(id)` — 19 official Ninerr agent design skills

### 2. Native Components & Design Systems
- `NINERR_COMPONENT_CATEGORIES`, `searchNinerrComponents(query)`, `getNinerrComponent(id)`, `buildComponentOperations(...)`
- `auditDesignSystem(document)` — detects unused tokens, duplicates, missing modes, hardcoded matches, and cross-mode WCAG contrast failures
- `generateHighContrastMode(document)`, `planThemeMigration(document, ...)`, `compileBreakpointsStylesheet(...)`, `planRegistryItemUpdate(...)`
- `exportDtcgTokens(document)`, `planDtcgTokens(document, json)`

### 3. Real-Browser Vision & Critic
- `STANDARD_VIEWPORTS`, `discoverBrowser()`, `renderAndInspect({ html, viewports, ... })`, `diffPngBuffers(beforePng, afterPng)`
- `buildCritiqueReport({ document, tasteFindings, systemFindings, visionCaptures })`
- `improveDesignInMemory(document, { maxIterations, evaluate })` — bounded, non-regressing in-memory repair loop

### 4. Multi-Framework Code Export & Existing-App Redesign
- `exportHtml`, `exportJsx`, `exportTailwind`, `exportVue`, `exportSvelte`, `exportAstro`, `importJsx`
- `analyzeCodebase(workspaceRoot)` — static offline framework, styling, route, token, and functional contract discovery
- `verifyFunctionalInvariance(beforeSource, afterSource, filePath)` — Whole-File `@babel/parser` Business-Logic & JSX Functional-Contract Invariance Gate
- `verifyCssTokenPatchInvariance(beforeCss, afterCss, { scss })` — strict Tier 1 CSS custom-property invariance check
- `planRedesign(workspaceRoot, ...)`, `applyRedesignPlan(plan, { journalDir, expectedPlanToken })`, `rollbackRedesign({ workspaceRoot, journalDir, runId })`

### 5. Offline Research & Reference Packs
- `extractPatternsFromSource({ html, css })` — offline palette, typography, spacing, layout, and custom-property extractor (`observed-inspiration-only`)
- `createLocalReferencePack({ packId, entries })`, `writeLocalReferencePack(...)`, `listLocalReferencePacks(dir)`

### 6. Reproducible Benchmarks
- `BENCHMARK_CATEGORIES`, `BENCHMARK_RUBRIC`, `runBenchmarkSuite({ categories, includeVision })` — runs the 14-category offline benchmark suite with strict separation of automated metrics (65 pts) and pending blinded human rubrics (35 pts).

## Example: Plan, Critique, and Export Offline

```js
import { createDocument, planDesignDirections, exportVue, extractPatternsFromSource } from "ninerr";

const plan = planDesignDirections({
  domain: "fintech",
  productName: "Treasury Desk",
  density: "compact",
});

const doc = createDocument({
  id: "doc-demo",
  name: "Treasury Desk",
  nodes: [{ id: "root", type: "frame", props: { tag: "main", style: { padding: "24px" } } }],
});

const vueSfc = exportVue(doc, "root");
const patterns = extractPatternsFromSource({ html: "<main><h1>Ledger</h1></main>", css: ":root { --accent: #0f766e; }" });
console.log(plan.directions.length, vueSfc.componentName, patterns.rightsPolicy);
```
