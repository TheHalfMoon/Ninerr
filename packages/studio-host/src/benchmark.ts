// Ninerr Reproducible 14-Category Design & Engineering Benchmark Suite.
// Implements the 9-dimension weighted rubric, strictly separating deterministic automated
// metrics (65% of total weight) from blinded human/evaluator rubrics (35% of total weight,
// never fabricated or auto-filled). Runs 100% locally with zero network egress.

import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildComponentOperations, getNinerrComponent } from "@ninerr/component-sources";
import {
  ARCHETYPE_IDS,
  compileMotionStylesheet,
  evaluateTaste,
  lintMotionCss,
  planDesignDirections,
} from "@ninerr/design-intelligence";
import { compileTokens, createDocument, newDesignSystemProps, serializeDocument, setToken } from "@ninerr/document-model";
import { applyTransaction, commitTransaction, createHistoryState, redo, undo } from "@ninerr/history";
import { buildCritiqueReport, discoverBrowser, improveDesignInMemory, renderAndInspect } from "@ninerr/vision";
import { exportAstro, exportHtml, exportJsx, exportSvelte, exportTailwind, exportVue } from "./code.ts";
import { auditDesignSystem, compileBreakpointsStylesheet, generateHighContrastMode, planThemeMigration } from "./design-system-ops.ts";
import { StudioError } from "./errors.ts";
import { analyzeCodebase, applyRedesignPlan, planRedesign, rollbackRedesign, verifyFunctionalInvariance } from "./redesign.ts";

export interface RubricDimension {
  id: string;
  label: string;
  weight: number;
  automated: boolean;
  description: string;
}

/**
 * 9-dimension weighted rubric (total weight = 100).
 * Automated deterministic dimensions account for 65 points; blinded human/evaluator dimensions
 * (`aesthetic` 20 + `ux` 15 = 35 points) remain explicitly pending and are never fabricated.
 */
export const BENCHMARK_RUBRIC: readonly RubricDimension[] = Object.freeze([
  { id: "aesthetic", label: "Aesthetic Craft", weight: 20, automated: false, description: "Blinded human/evaluator visual craft, restraint, and domain fit (never auto-filled)." },
  { id: "ux", label: "UX & Interaction Quality", weight: 15, automated: false, description: "Blinded human/evaluator flow clarity, hierarchy, and cognitive load (never auto-filled)." },
  { id: "codeQuality", label: "Production Code Quality", weight: 15, automated: true, description: "Deterministic multi-framework export validity (HTML/JSX/Tailwind/Vue/Svelte/Astro) and token cleanliness." },
  { id: "accessibility", label: "Accessibility (WCAG AA/AAA)", weight: 15, automated: true, description: "Deterministic contrast, semantic headings/labels, touch targets, and reduced-motion compliance." },
  { id: "responsive", label: "Responsive Integrity", weight: 10, automated: true, description: "Deterministic breakpoint compilation, fluid container structure, and zero-overflow viewport verification." },
  { id: "functionalPreservation", label: "Functional Preservation", weight: 10, automated: true, description: "Whole-File AST Business-Logic Invariance, reversible undo/redo history, and byte-for-byte rollback proof." },
  { id: "brandCoherence", label: "Brand & System Coherence", weight: 5, automated: true, description: "Brief alignment, domain archetype distinctness, token coverage, and zero anti-slop defects." },
  { id: "executionTime", label: "Execution Speed", weight: 5, automated: true, description: "Local wall-clock budget compliance (< 500ms static, < 15s with real-browser Vision)." },
  { id: "resourceCost", label: "Resource & Zero-Egress Cost", weight: 5, automated: true, description: "Zero mandatory cloud inference cost ($0), zero network egress, bounded local execution." },
]);

export interface BenchmarkCategorySpec {
  id: string;
  title: string;
  domain: string;
  density: "compact" | "balanced" | "spacious";
  themePreference: "light" | "dark" | "system";
  components: readonly string[];
  kind: "authoring" | "theme-migration" | "existing-app-redesign";
}

// Every category uses a canonical domain archetype ID from ARCHETYPE_IDS, covering all 9 archetypes.
export const BENCHMARK_CATEGORIES: readonly BenchmarkCategorySpec[] = Object.freeze([
  { id: "saas-dashboard", title: "Enterprise SaaS Dashboard", domain: "enterprise-saas", density: "balanced", themePreference: "light", components: ["navbar", "kpi-card", "data-table"], kind: "authoring" },
  { id: "landing-page", title: "Product Launch Landing Page", domain: "ecommerce", density: "spacious", themePreference: "light", components: ["navbar", "hero-section", "pricing-tiers"], kind: "authoring" },
  { id: "settings-console", title: "Application Settings Console", domain: "enterprise-saas", density: "balanced", themePreference: "light", components: ["tabs", "settings-panel", "switch-control"], kind: "authoring" },
  { id: "data-analytics", title: "Data Table & KPI Analytics", domain: "admin-data", density: "compact", themePreference: "light", components: ["metric-strip", "chart-card", "data-table"], kind: "authoring" },
  { id: "auth-onboarding", title: "Authentication & Onboarding Flow", domain: "consumer-mobile", density: "balanced", themePreference: "light", components: ["auth-card", "toast-alert"], kind: "authoring" },
  { id: "checkout-pricing", title: "Checkout & Pricing Comparison", domain: "ecommerce", density: "balanced", themePreference: "light", components: ["pricing-tiers", "billing-plan-row", "radio-group"], kind: "authoring" },
  { id: "mobile-app-shell", title: "Mobile-First App Shell", domain: "consumer-mobile", density: "spacious", themePreference: "light", components: ["card", "button", "toast-alert"], kind: "authoring" },
  { id: "healthcare-clinical", title: "Healthcare Clinical Triage Console", domain: "healthcare", density: "balanced", themePreference: "light", components: ["toast-alert", "kpi-card", "data-table"], kind: "authoring" },
  { id: "fintech-ledger", title: "Fintech Ledger & Transfer Console", domain: "fintech", density: "compact", themePreference: "light", components: ["kpi-card", "data-table", "timeline-list"], kind: "authoring" },
  { id: "developer-console", title: "Developer CLI & Observability Console", domain: "developer-tools", density: "compact", themePreference: "dark", components: ["command-bar", "tabs", "badge"], kind: "authoring" },
  { id: "creative-portfolio", title: "Creative Portfolio Showcase", domain: "creative-portfolio", density: "spacious", themePreference: "dark", components: ["hero-section", "feature-grid", "cta-banner"], kind: "authoring" },
  { id: "editorial-docs", title: "Editorial & Technical Docs Layout", domain: "editorial", density: "spacious", themePreference: "light", components: ["navbar", "breadcrumbs", "split-detail-pane"], kind: "authoring" },
  { id: "theme-high-contrast", title: "Light/Dark + WCAG AAA High-Contrast Migration", domain: "enterprise-saas", density: "balanced", themePreference: "system", components: ["card", "button", "badge"], kind: "theme-migration" },
  { id: "existing-app-redesign", title: "Existing React/Tailwind App Redesign & AST Invariance", domain: "fintech", density: "balanced", themePreference: "light", components: [], kind: "existing-app-redesign" },
]);

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function makeOpApplier(prefix: string) {
  let seq = 0;
  return (doc: any, operations: any[]): any => {
    if (!Array.isArray(operations) || operations.length === 0) return doc;
    seq += 1;
    return applyTransaction(doc, {
      id: `${prefix}-tx-${seq}`,
      actor: "ninerr-benchmark",
      operations,
    }).document;
  };
}

const A11Y_RULE_RE = /contrast|a11y|accessibility|touch|heading|label|focus|alt|landmark|reduced-motion|font-size|small-text/iu;

/**
 * Compute deterministic accessibility score (0..100) from concrete Critique findings + reduced-motion compliance.
 */
export function scoreAccessibilityFindings(
  findings: ReadonlyArray<{ ruleId?: string; severity?: string }>,
  reducedMotionOk: boolean,
) {
  let a11yErrors = 0;
  let a11yWarnings = 0;
  for (const f of findings) {
    const ruleId = typeof f?.ruleId === "string" ? f.ruleId : "";
    const isA11y = A11Y_RULE_RE.test(ruleId) || (!ruleId.startsWith("system:") && f?.severity === "error");
    if (!isA11y) continue;
    if (f.severity === "error") a11yErrors += 1;
    else if (f.severity === "warning") a11yWarnings += 1;
  }
  const score = Math.max(0, 100 - a11yErrors * 25 - Math.min(20, a11yWarnings * 5) - (reducedMotionOk ? 0 : 15));
  return { score, a11yErrors, a11yWarnings };
}

function buildAuthoringDoc(spec: BenchmarkCategorySpec) {
  if (!ARCHETYPE_IDS.includes(spec.domain as any)) {
    throw new StudioError(500, "invalid-benchmark-domain", `benchmark domain ${JSON.stringify(spec.domain)} is not in ARCHETYPE_IDS`);
  }
  const applyOps = makeOpApplier(`bench-${spec.id}`);
  const planned = planDesignDirections({
    domain: spec.domain,
    productName: spec.title,
    density: spec.density,
    themePreference: spec.themePreference,
  });
  const dir = planned.directions[0];
  const isDarkDefault = spec.themePreference === "dark";
  const dsProps = newDesignSystemProps();
  dsProps.collections = [{
    id: "theme",
    name: "Theme",
    modes: [{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }],
    defaultMode: isDarkDefault ? "dark" : "light",
  }];
  dsProps.brief = {
    domain: spec.domain,
    productName: spec.title,
    density: spec.density,
    themePreference: spec.themePreference,
    aestheticDirection: dir.name,
  };
  dsProps.breakpoints = [
    { id: "mobile", name: "Mobile", maxWidth: 640 },
    { id: "desktop", name: "Desktop", minWidth: 1024 },
  ];
  const motionCss = compileMotionStylesheet({ presetIds: ["enter", "focus"], selector: "[data-ninerr-page] section" }).css;
  const bpCss = compileBreakpointsStylesheet(
    dsProps.breakpoints,
    {
      mobile: "[data-ninerr-page] { padding: 16px; gap: 16px; }",
      desktop: "[data-ninerr-page] { padding: 32px; gap: 24px; }",
    },
  );

  let doc = createDocument({
    id: `doc-bench-${spec.id}`,
    name: spec.title,
    nodes: [
      { id: "ds-bench", type: "design-system", props: dsProps },
      {
        id: "root-frame",
        type: "frame",
        props: {
          name: spec.title,
          tag: "main",
          style: {
            width: "100%",
            "max-width": "1200px",
            margin: "0 auto",
            padding: "24px",
            display: "flex",
            "flex-direction": "column",
            gap: "24px",
            background: "var(--bg-canvas)",
            color: "var(--text-primary)",
            "font-family": "var(--font-body)",
          },
          stylesheet: `${motionCss}\n${bpCss}`,
        },
        children: ["hero-h1"],
      },
      {
        id: "hero-h1",
        type: "element",
        parentId: "root-frame",
        props: {
          tag: "h1",
          name: "Page Heading",
          style: { "font-size": "32px", "line-height": "1.2", margin: "0", color: "var(--text-primary)" },
        },
        children: ["hero-h1-text"],
      },
      {
        id: "hero-h1-text",
        type: "text",
        parentId: "hero-h1",
        props: { text: spec.title },
      },
    ],
  });

  // Seed dual-mode semantic tokens from planned direction.
  for (const tok of dir.tokens) {
    const ops = setToken(doc, {
      name: tok.name,
      type: tok.type,
      collection: "theme",
      values: { light: tok.light, dark: tok.dark ?? tok.light },
      ...(tok.description ? { description: tok.description } : {}),
    });
    doc = applyOps(doc, ops);
  }

  // Instantiate native WCAG-AA token-bound components for this category.
  for (let i = 0; i < spec.components.length; i += 1) {
    const compId = spec.components[i];
    if (!getNinerrComponent(compId)) throw new StudioError(500, "missing-benchmark-component", `benchmark component ${compId} not found`);
    const built = buildComponentOperations(compId, {
      parentId: "root-frame",
      insertIndex: doc.nodes["root-frame"].children.length,
      idPrefix: `b${i}`,
    });
    doc = applyOps(doc, built.operations);
  }

  return { doc, planned, motionCss, bpCss, applyOps };
}

function verifyUndoRedoRoundTrip(doc: any, operations: any[]): boolean {
  const testOps = operations.length > 0
    ? operations
    : [{ type: "set-props", nodeId: "hero-h1-text", set: { text: `${doc.nodes["hero-h1-text"]?.props?.text ?? "Title"} (Verified)` } }];
  const initialState = createHistoryState(doc);
  const beforeSerialized = serializeDocument({ ...initialState.document, revision: 0 });
  const committed = commitTransaction(initialState, {
    id: `bench-roundtrip-${doc.id}`,
    baseRevision: initialState.document.revision,
    actor: "ninerr-benchmark",
    operations: testOps,
  });
  const afterCommitSerialized = serializeDocument({ ...committed.document, revision: 0 });
  const undone = undo(committed);
  const afterUndoSerialized = serializeDocument({ ...undone.document, revision: 0 });
  const redone = redo(undone);
  const afterRedoSerialized = serializeDocument({ ...redone.document, revision: 0 });
  return afterUndoSerialized === beforeSerialized && afterRedoSerialized === afterCommitSerialized;
}

async function runCategory(spec: BenchmarkCategorySpec, { includeVision, browserPath }: { includeVision: boolean; browserPath: string | null }) {
  const t0 = performance.now();

  if (spec.kind === "existing-app-redesign") {
    let workDir: string | null = null;
    let journalDir: string | null = null;
    try {
      workDir = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-bench-app-")));
      journalDir = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-bench-journal-")));
      mkdirSync(join(workDir, "src"), { recursive: true });
      const origPkg = JSON.stringify({ name: "bench-fintech-app", dependencies: { react: "19.0.0", tailwindcss: "^4.0.0" } }, null, 2);
      const origCss = ":root {\n  --bg-canvas: #ffffff;\n  --accent-primary: #3b82f6;\n}\n";
      const origTsx = `"use client";\nimport { useState } from "react";\nexport function TransferForm({ onSubmit }) {\n  const [amount, setAmount] = useState("250");\n  return (\n    <main className="p-4 sm:p-6 bg-white">\n      <form onSubmit={onSubmit} className="p-4 bg-white rounded-md">\n        <label htmlFor="transfer-amount">Transfer amount</label>\n        <input id="transfer-amount" name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="transfer-amount" />\n        <button type="submit" className={cn("bg-blue-500 text-white px-4", amount === "" && "opacity-50")}>Send {amount}</button>\n      </form>\n    </main>\n  );\n}\n`;
      writeFileSync(join(workDir, "package.json"), origPkg);
      writeFileSync(join(workDir, "src", "tokens.css"), origCss);
      writeFileSync(join(workDir, "src", "TransferForm.tsx"), origTsx);

      const plan = planRedesign(workDir, {
        cssTokenUpdates: { "--accent-primary": "#0f766e" },
        jsxClassReplacements: { "bg-blue-500": "bg-teal-700", "p-4": "p-6" },
      });
      const applied = applyRedesignPlan(plan, { journalDir, expectedPlanToken: plan.planToken });
      const afterCss = readFileSync(join(workDir, "src", "tokens.css"), "utf8");
      const afterTsx = readFileSync(join(workDir, "src", "TransferForm.tsx"), "utf8");
      const afterAnalysis = analyzeCodebase(workDir);
      const validPass = verifyFunctionalInvariance(origTsx, afterTsx, "src/TransferForm.tsx").ok;
      const hostileBlocked = !verifyFunctionalInvariance(origTsx, afterTsx.replace("onSubmit={onSubmit}", "onSubmit={() => {}}"), "src/TransferForm.tsx").ok;
      const directiveBlocked = !verifyFunctionalInvariance(origTsx, afterTsx.replace('"use client";\n', ""), "src/TransferForm.tsx").ok;

      // Measure real post-patch properties rather than hardcoding unmeasured 100s.
      const a11yPreserved =
        afterTsx.includes('htmlFor="transfer-amount"') &&
        afterTsx.includes('id="transfer-amount"') &&
        afterTsx.includes('type="submit"') &&
        afterTsx.includes('data-testid="transfer-amount"');
      const responsivePreserved = afterTsx.includes("sm:p-6") && afterTsx.includes("p-6");
      const brandTokensCoherent =
        afterAnalysis.styling.includes("tailwind-v4") &&
        afterAnalysis.styling.includes("css-variables") &&
        afterAnalysis.tokens.some((t) => t.name === "--accent-primary" && t.value === "#0f766e");

      const rollback = rollbackRedesign({ workspaceRoot: workDir, journalDir, runId: applied.runId });
      const restoredExact =
        sha256(readFileSync(join(workDir, "src", "tokens.css"), "utf8")) === sha256(origCss) &&
        sha256(readFileSync(join(workDir, "src", "TransferForm.tsx"), "utf8")) === sha256(origTsx);

      const durationMs = Math.round((performance.now() - t0) * 10) / 10;
      const preservationOk = validPass && hostileBlocked && directiveBlocked && restoredExact && afterCss.includes("#0f766e") && afterTsx.includes("bg-teal-700");
      const scores = {
        codeQuality: afterCss.includes("#0f766e") && afterTsx.includes("bg-teal-700") ? 100 : 0,
        accessibility: a11yPreserved ? 100 : 0,
        responsive: responsivePreserved ? 100 : 0,
        functionalPreservation: preservationOk ? 100 : 0,
        brandCoherence: brandTokensCoherent ? 100 : 0,
        executionTime: durationMs < 500 ? 100 : durationMs < 2000 ? 85 : 60,
        resourceCost: 100,
      };
      return finalizeCategoryResult(spec, scores, {
        durationMs,
        visionUsed: false,
        documentNetworkAttempts: 0,
        browserContainmentBlocked: 0,
        details: {
          patchesApplied: applied.filesApplied.length,
          restoredFiles: rollback.restoredFiles.length,
          validInvariancePassed: validPass,
          hostileHandlerBlocked: hostileBlocked,
          directiveDropBlocked: directiveBlocked,
          restoredByteIdentical: restoredExact,
          a11yContractsPreserved: a11yPreserved,
          responsiveClassesPreserved: responsivePreserved,
          brandTokensCoherent,
        },
      });
    } finally {
      if (workDir !== null) {
        try { rmSync(workDir, { recursive: true, force: true, maxRetries: 5 }); } catch { /* ignore cleanup error */ }
      }
      if (journalDir !== null) {
        try { rmSync(journalDir, { recursive: true, force: true, maxRetries: 5 }); } catch { /* ignore cleanup error */ }
      }
    }
  }

  let { doc, planned, motionCss, bpCss, applyOps } = buildAuthoringDoc(spec);

  // Theme & high-contrast migration category exercises atomic theme swap + WCAG AAA high-contrast generation.
  let highContrastGenerated = false;
  let themeMigrated = false;
  if (spec.kind === "theme-migration") {
    const mig = planThemeMigration(doc, {
      collectionId: "theme",
      tokens: [
        { name: "--bg-canvas", type: "color", light: "#ffffff", dark: "#090d16" },
        { name: "--text-primary", type: "color", light: "#0f172a", dark: "#f8fafc" },
        { name: "--accent-primary", type: "color", light: "#0f766e", dark: "#2dd4bf" },
      ],
    });
    if (mig.operations.length > 0) {
      doc = applyOps(doc, mig.operations);
      themeMigrated = true;
    }
    const hc = generateHighContrastMode(doc, { collectionId: "theme" });
    if (hc.operations.length > 0) {
      doc = applyOps(doc, hc.operations);
      highContrastGenerated = true;
    }
  }

  let documentNetworkAttempts = 0;
  let browserContainmentBlocked = 0;
  const colorScheme = spec.themePreference === "dark" ? "dark" : "light";
  const evaluateDoc = async (candidate: any) => {
    const taste = evaluateTaste(candidate, { rootId: "root-frame" });
    const sys = auditDesignSystem(candidate);
    let captures: any[] = [];
    if (includeVision && browserPath) {
      const { html } = exportHtml(candidate, "root-frame", { includeNodeIds: true });
      const rendered = await renderAndInspect({
        html,
        viewports: ["desktop", "mobile"],
        colorScheme,
        captureScreenshot: false,
        browserPath,
      });
      captures = rendered.captures;
      documentNetworkAttempts += Array.isArray(rendered.egress?.cdpBlocked) ? rendered.egress.cdpBlocked.length : 0;
      browserContainmentBlocked += Array.isArray(rendered.egress?.proxyBlocked) ? rendered.egress.proxyBlocked.length : 0;
    }
    return buildCritiqueReport({
      document: candidate,
      rootId: "root-frame",
      tasteFindings: taste.findings,
      systemFindings: sys.hasDesignSystem ? sys.findings : [],
      visionCaptures: captures,
    });
  };

  const improved = await improveDesignInMemory(doc, { maxIterations: 2, evaluate: evaluateDoc });
  const undoRedoOk = verifyUndoRedoRoundTrip(doc, improved.operations);
  const finalDoc = improved.operations.length > 0 ? applyOps(doc, improved.operations) : doc;
  const finalAudit = auditDesignSystem(finalDoc);
  const motionLint = lintMotionCss(motionCss);

  // Multi-framework export check across all 6 code targets.
  const htmlOut = exportHtml(finalDoc, "root-frame");
  const jsxOut = exportJsx(finalDoc, "root-frame");
  const twOut = exportTailwind(finalDoc, "root-frame");
  const vueOut = exportVue(finalDoc, "root-frame");
  const svelteOut = exportSvelte(finalDoc, "root-frame");
  const astroOut = exportAstro(finalDoc, "root-frame");
  const compiledCss = compileTokens(finalDoc);
  const allExportsValid =
    htmlOut.html.includes("<!doctype html>") &&
    jsxOut.code.includes("export function") &&
    twOut.code.includes("export function") &&
    vueOut.code.includes("<template>") &&
    svelteOut.code.includes("<style>") &&
    astroOut.code.includes("---") &&
    compiledCss.includes("--bg-canvas");

  const durationMs = Math.round((performance.now() - t0) * 10) / 10;
  const finalFindings: Array<{ ruleId?: string; severity?: string }> = Array.isArray(improved.finalFindings) ? improved.finalFindings : [];
  const reducedMotionOk = motionCss.includes("prefers-reduced-motion") && Array.isArray(motionLint) && motionLint.length === 0;
  const a11y = scoreAccessibilityFindings(finalFindings, reducedMotionOk);
  const totalErrors = improved.final.errors;
  const totalWarnings = improved.final.warnings;
  const hasResponsiveOverflow = finalFindings.some((f) => typeof f.ruleId === "string" && /overflow|clipped/iu.test(f.ruleId));
  const responsiveOk = bpCss.includes("@media") && !hasResponsiveOverflow;

  const preservationScore = spec.kind === "theme-migration"
    ? (themeMigrated && highContrastGenerated && undoRedoOk ? 100 : undoRedoOk ? 50 : 0)
    : (undoRedoOk ? 100 : 0);

  const scores = {
    codeQuality: allExportsValid ? 100 : 40,
    accessibility: a11y.score,
    responsive: responsiveOk ? 100 : 60,
    functionalPreservation: preservationScore,
    brandCoherence: planned.directions.length === 3 && finalAudit.hasDesignSystem
      ? Math.max(60, 100 - Math.min(30, finalAudit.summary.errors * 15) - Math.min(15, finalAudit.summary.warnings * 2))
      : 50,
    executionTime: durationMs < (includeVision ? 15_000 : 500) ? 100 : durationMs < (includeVision ? 25_000 : 2000) ? 85 : 65,
    resourceCost: documentNetworkAttempts === 0 ? 100 : 0,
  };

  return finalizeCategoryResult(spec, scores, {
    durationMs,
    visionUsed: includeVision && Boolean(browserPath),
    documentNetworkAttempts,
    browserContainmentBlocked,
    details: {
      directionsPlanned: planned.directions.length,
      baselineDefectScore: improved.baseline.defectScore,
      finalDefectScore: improved.final.defectScore,
      finalErrors: totalErrors,
      finalWarnings: totalWarnings,
      a11yErrors: a11y.a11yErrors,
      a11yWarnings: a11y.a11yWarnings,
      undoRedoRoundTripOk: undoRedoOk,
      allSixFrameworkExportsValid: allExportsValid,
      reducedMotionCompliant: reducedMotionOk,
      documentNetworkAttempts,
      browserContainmentBlocked,
      ...(spec.kind === "theme-migration" ? { themeMigrated, highContrastGenerated } : {}),
    },
  });
}

function finalizeCategoryResult(
  spec: BenchmarkCategorySpec,
  automatedDimensionScores: Record<string, number>,
  meta: { durationMs: number; visionUsed: boolean; documentNetworkAttempts: number; browserContainmentBlocked: number; details: Record<string, unknown> },
) {
  let weightedAutomated = 0;
  let maxAutomatedWeight = 0;
  for (const dim of BENCHMARK_RUBRIC) {
    if (!dim.automated) continue;
    maxAutomatedWeight += dim.weight;
    const raw = automatedDimensionScores[dim.id] ?? 0;
    weightedAutomated += (Math.max(0, Math.min(100, raw)) / 100) * dim.weight;
  }
  const automatedPoints = Math.round(weightedAutomated * 100) / 100;
  const automatedPercent = Math.round((weightedAutomated / maxAutomatedWeight) * 1000) / 10;

  return {
    id: spec.id,
    title: spec.title,
    domain: spec.domain,
    kind: spec.kind,
    durationMs: meta.durationMs,
    visionUsed: meta.visionUsed,
    documentNetworkAttempts: meta.documentNetworkAttempts,
    browserContainmentBlocked: meta.browserContainmentBlocked,
    automated: {
      points: automatedPoints,
      maxPoints: maxAutomatedWeight,
      percent: automatedPercent,
      dimensions: automatedDimensionScores,
    },
    humanRubric: {
      status: "pending-blinded-human-review",
      maxPoints: 100 - maxAutomatedWeight,
      dimensions: {
        aesthetic: null,
        ux: null,
      },
    },
    details: meta.details,
  };
}

/**
 * Run all 14 Ninerr benchmark categories (or a deduplicated filtered subset) offline with strict
 * separation between deterministic automated scores (65 pts) and pending blinded human rubrics (35 pts).
 */
export async function runBenchmarkSuite({
  categories,
  includeVision = false,
}: {
  categories?: string[];
  includeVision?: boolean;
} = {}) {
  const uniqueIds = categories && categories.length > 0 ? [...new Set(categories)] : null;
  const selected = uniqueIds !== null
    ? uniqueIds.map((id) => {
      const found = BENCHMARK_CATEGORIES.find((c) => c.id === id);
      if (!found) throw new StudioError(400, "unknown-category", `unknown benchmark category ${JSON.stringify(id)}`);
      return found;
    })
    : [...BENCHMARK_CATEGORIES];

  let browserPath: string | null = null;
  let visionNote: string | null = null;
  if (includeVision) {
    try {
      browserPath = discoverBrowser();
      if (!browserPath) visionNote = "no local Chromium/Edge/Chrome browser detected; ran static benchmark only";
    } catch (error) {
      browserPath = null;
      visionNote = `browser discovery failed (${error instanceof Error ? error.message : String(error)}); ran static benchmark only`;
    }
  }

  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const results = [];
  for (const spec of selected) {
    results.push(await runCategory(spec, { includeVision: includeVision && browserPath !== null, browserPath }));
  }
  const totalDurationMs = Math.round((performance.now() - t0) * 10) / 10;
  const totalDocumentNetworkAttempts = results.reduce((sum, r) => sum + (r.documentNetworkAttempts ?? 0), 0);
  const totalBrowserContainmentBlocked = results.reduce((sum, r) => sum + (r.browserContainmentBlocked ?? 0), 0);
  const anyVisionUsed = results.some((r) => r.visionUsed);
  const avgAutomatedPercent = Math.round((results.reduce((s, r) => s + r.automated.percent, 0) / results.length) * 10) / 10;
  const avgAutomatedPoints = Math.round((results.reduce((s, r) => s + r.automated.points, 0) / results.length) * 100) / 100;

  return {
    schemaVersion: 1,
    startedAt,
    totalDurationMs,
    networkAttempts: totalDocumentNetworkAttempts,
    browserContainmentBlocked: totalBrowserContainmentBlocked,
    visionRequested: includeVision,
    visionUsed: anyVisionUsed,
    ...(visionNote ? { visionNote } : {}),
    categoryCount: results.length,
    rubric: BENCHMARK_RUBRIC,
    summary: {
      automatedMeanPoints: avgAutomatedPoints,
      automatedMaxPoints: 65,
      automatedMeanPercent: avgAutomatedPercent,
      humanRubricStatus: "pending-blinded-human-review",
      humanMaxPoints: 35,
    },
    categories: results,
  };
}
