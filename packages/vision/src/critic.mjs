// Unified Ninerr Critic and Bounded In-Memory Iterative Design Improvement Engine.
// Combines static accessibility (WCAG), document taste/motion findings, and real-browser
// Vision telemetry into a single evidence-grounded critique strictly classified into:
//   - "deterministic-defect"
//   - "heuristic-observation"
//   - "subjective-suggestion"
//
// `improveDesignInMemory` runs bounded iterations in memory via @ninerr/history, checks
// non-regression after every candidate pass, and returns ONE atomic operation batch.

import { auditAccessibility, contrastRatio, parseOpaqueColor } from "@ninerr/design-assurance";
import { isCodePart } from "@ninerr/document-model";
import { applyTransaction } from "@ninerr/history";
import { visionTelemetryFindings } from "./telemetry.mjs";

const SEVERITY_RANK = Object.freeze({ error: 0, warning: 1, info: 2 });
const PX_VALUE = /^(\d+(?:\.\d+)?)px$/iu;

function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toNeutralTree(document, nodeId) {
  const node = document.nodes[nodeId];
  if (!node || node.type === "design-system") return null;
  const styleObj = node.props?.style && typeof node.props.style === "object" ? node.props.style : null;
  const style = styleObj
    ? Object.entries(styleObj).map(([k, v]) => `${k}: ${v}`).join("; ")
    : undefined;
  const children = [];
  for (const cid of node.children ?? []) {
    const child = toNeutralTree(document, cid);
    if (child) children.push(child);
  }
  return {
    id: node.id,
    tag: node.props?.tag ?? (node.type === "text" ? "p" : "div"),
    attributes: node.props?.attributes && typeof node.props.attributes === "object" ? node.props.attributes : {},
    ...(typeof node.props?.text === "string" ? { text: node.props.text } : {}),
    ...(style ? { style } : {}),
    children,
  };
}

/** Run static WCAG accessibility audit over a Ninerr document or subtree. */
export function staticAccessibilityFindings(document, { rootId = null } = {}) {
  const roots = rootId ? [rootId] : (document.rootIds ?? []);
  const findings = [];
  for (const id of roots) {
    const tree = toNeutralTree(document, id);
    if (!tree) continue;
    const result = auditAccessibility(tree);
    for (const item of result.findings ?? []) {
      findings.push({
        ruleId: `a11y:${item.ruleId.replace(/^a11y\//u, "")}`,
        kind: "deterministic-defect",
        severity: item.severity === "major" ? "error" : "warning",
        nodeId: item.nodeId ?? null,
        message: `${item.message} (WCAG ${item.wcag})`,
        evidence: { wcag: item.wcag, path: item.path },
        suggestion: item.message,
      });
    }
  }
  return findings;
}

/**
 * Assemble a unified, deduplicated, severity-sorted Ninerr Critic report across static
 * accessibility, optional Taste/Motion findings, optional Design System audit findings,
 * and optional live Vision browser telemetry captures.
 */
export function buildCritiqueReport({
  document,
  rootId = null,
  tasteFindings = [],
  systemFindings = [],
  visionCaptures = [],
}) {
  const raw = [
    ...staticAccessibilityFindings(document, { rootId }),
    ...tasteFindings,
    ...systemFindings,
    ...visionTelemetryFindings(visionCaptures),
  ];

  const seen = new Set();
  const findings = [];
  for (const item of raw) {
    const normalized = {
      ruleId: String(item.ruleId ?? "critic:general"),
      kind: item.kind === "deterministic-defect" || item.kind === "subjective-suggestion"
        ? item.kind
        : "heuristic-observation",
      severity: item.severity === "error" || item.severity === "info" ? item.severity : "warning",
      nodeId: item.nodeId ?? null,
      ...(item.viewport ? { viewport: item.viewport } : {}),
      message: String(item.message ?? ""),
      evidence: item.evidence ?? {},
      ...(item.suggestion ? { suggestion: String(item.suggestion) } : {}),
    };
    const key = `${normalized.ruleId}|${normalized.nodeId ?? ""}|${normalized.viewport ?? ""}|${normalized.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(normalized);
  }

  findings.sort((a, b) => (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || compareCodeUnits(a.ruleId, b.ruleId)
    || compareCodeUnits(String(a.nodeId ?? ""), String(b.nodeId ?? ""))
    || compareCodeUnits(a.message, b.message)
  ));

  const deterministicDefects = findings.filter((f) => f.kind === "deterministic-defect").length;
  const heuristicObservations = findings.filter((f) => f.kind === "heuristic-observation").length;
  const subjectiveSuggestions = findings.filter((f) => f.kind === "subjective-suggestion").length;
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => f.severity === "info").length;

  // Deterministic penalty score (0 = clean, higher = worse) for non-regression gating.
  const defectScore = errors * 10 + warnings * 3 + info;

  return Object.freeze({
    summary: Object.freeze({
      total: findings.length,
      deterministicDefects,
      heuristicObservations,
      subjectiveSuggestions,
      errors,
      warnings,
      info,
      defectScore,
    }),
    findings: Object.freeze(findings),
  });
}

function chooseAccessibleForeground(bgRgb) {
  const darkInk = [15, 23, 42];
  const whiteInk = [255, 255, 255];
  return contrastRatio(darkInk, bgRgb) >= contrastRatio(whiteInk, bgRgb) ? "#0f172a" : "#ffffff";
}

function snapPxTo4(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\b(\d+(?:\.\d+)?)px\b/giu, (match, numStr) => {
    const px = Number(numStr);
    if (!Number.isFinite(px) || px <= 2 || px % 4 === 0) return match;
    return `${Math.max(4, Math.round(px / 4) * 4)}px`;
  });
}

/**
 * Generate safe, deterministic repair operations for high-confidence defects in `report`.
 */
function proposeDeterministicFixes(document, report) {
  const patchesByNode = new Map();
  const patchFor = (nodeId) => {
    if (!Object.hasOwn(document.nodes, nodeId)) return null;
    const node = document.nodes[nodeId];
    if (node.type === "design-system" || node.type === "component-instance" || node.type === "component-definition" || isCodePart(node)) return null;
    let entry = patchesByNode.get(nodeId);
    if (!entry) {
      entry = {
        style: { ...(node.props?.style && typeof node.props.style === "object" ? node.props.style : {}) },
        styleChanged: false,
        attributes: { ...(node.props?.attributes && typeof node.props.attributes === "object" ? node.props.attributes : {}) },
        attributesChanged: false,
        stylesheet: typeof node.props?.stylesheet === "string" ? node.props.stylesheet : null,
        stylesheetChanged: false,
        reasons: [],
      };
      patchesByNode.set(nodeId, entry);
    }
    return entry;
  };

  for (const finding of report.findings) {
    if (!finding.nodeId) continue;
    const patch = patchFor(finding.nodeId);
    if (!patch) continue;

    if (finding.ruleId === "taste:color-low-contrast" || finding.ruleId === "a11y:text-contrast" || finding.ruleId === "vision:rendered-low-contrast") {
      const rawBg = finding.evidence?.background ?? finding.evidence?.effectiveBackground ?? patch.style["background-color"] ?? patch.style.backgroundColor ?? patch.style.background;
      const bgRgb = parseOpaqueColor(String(rawBg ?? "")) ?? [255, 255, 255];
      const nextColor = chooseAccessibleForeground(bgRgb);
      if (patch.style.color !== nextColor) {
        patch.style.color = nextColor;
        patch.styleChanged = true;
        patch.reasons.push(`improved contrast on ${finding.nodeId} to ${nextColor}`);
      }
    } else if (finding.ruleId === "taste:interactive-target-size" || finding.ruleId === "vision:target-below-24px") {
      patch.style["min-height"] = "36px";
      patch.style["min-width"] = "36px";
      delete patch.style.minHeight;
      delete patch.style.minWidth;
      if (typeof patch.style.height === "string" && PX_VALUE.test(patch.style.height) && parseFloat(patch.style.height) < 36) delete patch.style.height;
      patch.styleChanged = true;
      patch.reasons.push(`raised target size on ${finding.nodeId} to >=36px`);
    } else if (finding.ruleId === "taste:mobile-touch-target" || finding.ruleId === "vision:mobile-target-below-44px") {
      patch.style["min-height"] = "44px";
      delete patch.style.minHeight;
      if (typeof patch.style.height === "string" && PX_VALUE.test(patch.style.height) && parseFloat(patch.style.height) < 44) delete patch.style.height;
      patch.styleChanged = true;
      patch.reasons.push(`raised mobile touch target on ${finding.nodeId} to >=44px`);
    } else if (finding.ruleId === "vision:horizontal-overflow") {
      patch.style["max-width"] = "100%";
      patch.style["box-sizing"] = "border-box";
      delete patch.style.maxWidth;
      delete patch.style.boxSizing;
      if (typeof patch.style.width === "string" && PX_VALUE.test(patch.style.width) && parseFloat(patch.style.width) > 320) patch.style.width = "100%";
      patch.styleChanged = true;
      patch.reasons.push(`constrained horizontal overflow on ${finding.nodeId}`);
    } else if (finding.ruleId === "taste:body-tight-leading") {
      patch.style["line-height"] = "1.55";
      delete patch.style.lineHeight;
      patch.styleChanged = true;
      patch.reasons.push(`improved body line-height on ${finding.nodeId} to 1.55`);
    } else if (finding.ruleId === "taste:display-loose-leading") {
      patch.style["line-height"] = "1.12";
      delete patch.style.lineHeight;
      patch.styleChanged = true;
      patch.reasons.push(`tightened display line-height on ${finding.nodeId} to 1.12`);
    } else if (finding.ruleId === "taste:spacing-off-grid") {
      const prop = finding.evidence?.property;
      if (typeof prop === "string" && typeof patch.style[prop] === "string") {
        const snapped = snapPxTo4(patch.style[prop]);
        if (snapped !== patch.style[prop]) {
          patch.style[prop] = snapped;
          patch.styleChanged = true;
          patch.reasons.push(`snapped ${prop} on ${finding.nodeId} to 4px grid (${snapped})`);
        }
      }
    } else if (finding.ruleId === "taste:anti-slop-heavy-shadow") {
      patch.style["box-shadow"] = "var(--shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.06))";
      delete patch.style.boxShadow;
      patch.styleChanged = true;
      patch.reasons.push(`replaced heavy drop shadow on ${finding.nodeId} with subtle elevation`);
    } else if (finding.ruleId === "motion:gpu-composited-only" && typeof patch.stylesheet === "string") {
      const updated = patch.stylesheet.replace(/(?<![\w-])transition\s*:\s*[^;{}]+/giu, "transition: transform 150ms cubic-bezier(0.23, 1, 0.32, 1), opacity 150ms cubic-bezier(0.23, 1, 0.32, 1)");
      if (updated !== patch.stylesheet) {
        patch.stylesheet = updated;
        patch.stylesheetChanged = true;
        patch.reasons.push(`restricted transitions on ${finding.nodeId} to compositor-only properties`);
      }
    } else if (finding.ruleId === "motion:missing-reduced-motion" && typeof patch.stylesheet === "string") {
      if (!/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/iu.test(patch.stylesheet)) {
        patch.stylesheet = `${patch.stylesheet.trimEnd()}\n@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`;
        patch.stylesheetChanged = true;
        patch.reasons.push(`added prefers-reduced-motion fallback to ${finding.nodeId}`);
      }
    } else if (finding.ruleId === "a11y:image-alt") {
      if (!Object.hasOwn(patch.attributes, "alt")) {
        patch.attributes.alt = "";
        patch.attributesChanged = true;
        patch.reasons.push(`added decorative alt="" attribute on ${finding.nodeId}`);
      }
    }
  }

  const operations = [];
  const appliedReasons = [];
  for (const [nodeId, patch] of patchesByNode) {
    const set = {};
    if (patch.styleChanged) set.style = patch.style;
    if (patch.attributesChanged) set.attributes = patch.attributes;
    if (patch.stylesheetChanged) set.stylesheet = patch.stylesheet;
    if (Object.keys(set).length > 0) {
      operations.push({ type: "set-props", nodeId, set });
      appliedReasons.push(...patch.reasons);
    }
  }
  return { operations, appliedReasons };
}

/**
 * Run a bounded, in-memory iterative design improvement loop. Evaluates every candidate
 * pass via `evaluate(candidateDoc)`, accepts ONLY strictly improving non-regressing passes,
 * and returns a SINGLE collapsed atomic `operations` array ready for one undoable commit.
 */
export async function improveDesignInMemory(document, {
  evaluate,
  maxIterations = 3,
} = {}) {
  if (typeof evaluate !== "function") throw new Error("improveDesignInMemory requires an evaluate(doc) callback");
  const limit = Math.max(1, Math.min(5, Number(maxIterations) || 3));

  let currentDoc = document;
  const baselineReport = await evaluate(currentDoc);
  let bestReport = baselineReport;
  const history = [];
  const finalOpsByNode = new Map();

  for (let iteration = 1; iteration <= limit; iteration += 1) {
    if (bestReport.summary.defectScore === 0) break;
    const { operations, appliedReasons } = proposeDeterministicFixes(currentDoc, bestReport);
    if (operations.length === 0) break;

    const tx = applyTransaction(currentDoc, {
      id: `improve-sim-${iteration}`,
      baseRevision: currentDoc.revision,
      actor: "ninerr-critic",
      actorKind: "agent",
      intent: `Simulate design improvement pass ${iteration}`,
      timestamp: "2026-11-27T00:00:00.000Z",
      operations,
    });
    const candidateReport = await evaluate(tx.document);
    const improved = candidateReport.summary.defectScore < bestReport.summary.defectScore
      && candidateReport.summary.errors <= bestReport.summary.errors;

    history.push({
      iteration,
      accepted: improved,
      beforeScore: bestReport.summary.defectScore,
      afterScore: candidateReport.summary.defectScore,
      changes: appliedReasons,
    });

    if (!improved) {
      // Non-regression guard: discard candidate and stop.
      break;
    }

    currentDoc = tx.document;
    bestReport = candidateReport;
    for (const op of operations) {
      const prev = finalOpsByNode.get(op.nodeId) ?? { type: "set-props", nodeId: op.nodeId, set: {} };
      prev.set = { ...prev.set, ...op.set };
      finalOpsByNode.set(op.nodeId, prev);
    }
  }

  return {
    improved: bestReport.summary.defectScore < baselineReport.summary.defectScore,
    iterationsRun: history.length,
    baseline: baselineReport.summary,
    final: bestReport.summary,
    history,
    operations: [...finalOpsByNode.values()],
  };
}
