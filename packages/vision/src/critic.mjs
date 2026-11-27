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
const MAX_STYLESHEET_BYTES = 2 * 1024 * 1024;
const UNSAFE_STYLE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const LAYOUT_THRASHING_PROPS = new Set([
  "all", "width", "height", "min-width", "min-height", "max-width", "max-height",
  "top", "left", "right", "bottom",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-width", "font-size", "line-height",
]);

function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNeutralTree(document, nodeId, visited = new Set(), depth = 0) {
  if (depth > 128 || typeof nodeId !== "string" || visited.has(nodeId) || !Object.hasOwn(document.nodes ?? {}, nodeId)) return null;
  const node = document.nodes[nodeId];
  if (!node || node.type === "design-system") return null;
  visited.add(nodeId);
  const styleObj = isPlainRecord(node.props?.style) ? node.props.style : null;
  const style = styleObj
    ? Object.entries(styleObj)
      .filter(([k, v]) => typeof k === "string" && typeof v === "string")
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ")
    : undefined;
  const children = [];
  for (const cid of Array.isArray(node.children) ? node.children : []) {
    const child = toNeutralTree(document, cid, visited, depth + 1);
    if (child) children.push(child);
  }
  const rawTag = node.props?.tag;
  const tag = typeof rawTag === "string" && rawTag.trim() !== "" ? rawTag.trim() : (node.type === "text" ? "p" : "div");
  const attributes = isPlainRecord(node.props?.attributes) ? node.props.attributes : {};
  return {
    id: node.id,
    tag,
    attributes,
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

function resolveInheritedBackground(document, nodeId, localStyle) {
  const tryStyle = (st) => {
    if (!isPlainRecord(st)) return null;
    for (const k of ["background-color", "backgroundColor", "background"]) {
      if (Object.hasOwn(st, k) && typeof st[k] === "string") {
        const parsed = parseOpaqueColor(st[k]);
        if (parsed) return parsed;
      }
    }
    return null;
  };
  const direct = tryStyle(localStyle);
  if (direct) return direct;
  const visited = new Set([nodeId]);
  let cur = document.nodes?.[nodeId]?.parentId ?? null;
  while (typeof cur === "string" && !visited.has(cur) && Object.hasOwn(document.nodes ?? {}, cur)) {
    visited.add(cur);
    const parent = document.nodes[cur];
    const parsed = tryStyle(parent?.props?.style);
    if (parsed) return parsed;
    cur = parent?.parentId ?? null;
  }
  return [255, 255, 255];
}

function snapPxTo4(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\b(\d+(?:\.\d+)?)px\b/giu, (match, numStr) => {
    const px = Number(numStr);
    if (!Number.isFinite(px) || px <= 2 || px % 4 === 0) return match;
    return `${Math.max(4, Math.round(px / 4) * 4)}px`;
  });
}

function containsLayoutThrashProp(value) {
  const lower = value.trim().toLowerCase();
  if (lower === "" || lower === "none" || lower === "0s" || lower === "0ms") return false;
  for (const part of lower.split(",")) {
    for (const tok of part.trim().split(/\s+/u)) {
      if (LAYOUT_THRASHING_PROPS.has(tok)) return true;
    }
  }
  return false;
}

/**
 * Safely rewrite non-composited `transition` / `transition-property` declarations in a CSS
 * stylesheet while preserving comments, quoted strings, selectors, and `transition: none`.
 */
function rewriteThrashingTransitions(css) {
  let out = "";
  let i = 0;
  let changed = false;
  while (i < css.length) {
    // Preserve CSS comments verbatim.
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) return { css, changed: false };
      out += css.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    // Preserve quoted strings verbatim.
    if (css[i] === "\"" || css[i] === "'") {
      const q = css[i];
      let j = i + 1;
      while (j < css.length) {
        if (css[j] === "\\" && j + 1 < css.length) { j += 2; continue; }
        if (css[j] === q) { j += 1; break; }
        j += 1;
      }
      out += css.slice(i, j);
      i = j;
      continue;
    }
    // Match `transition:` or `transition-property:` at a property-name boundary.
    const prev = i > 0 ? css[i - 1] : "";
    if (!/[\w-]/u.test(prev)) {
      const rest = css.slice(i);
      const propMatch = /^(transition(?:-property)?)\s*:/iu.exec(rest);
      if (propMatch) {
        const propName = propMatch[1].toLowerCase();
        let valEnd = i + propMatch[0].length;
        let quote = null;
        while (valEnd < css.length) {
          const ch = css[valEnd];
          if (quote !== null) {
            if (ch === "\\" && valEnd + 1 < css.length) { valEnd += 2; continue; }
            if (ch === quote) quote = null;
            valEnd += 1;
            continue;
          }
          if (ch === "\"" || ch === "'") { quote = ch; valEnd += 1; continue; }
          if (ch === "/" && css[valEnd + 1] === "*") {
            const cEnd = css.indexOf("*/", valEnd + 2);
            if (cEnd < 0) return { css, changed: false };
            valEnd = cEnd + 2;
            continue;
          }
          if (ch === ";" || ch === "}" || ch === "{") break;
          valEnd += 1;
        }
        const declVal = css.slice(i + propMatch[0].length, valEnd);
        if (css[valEnd] !== "{" && containsLayoutThrashProp(declVal)) {
          out += propName === "transition-property"
            ? "transition-property: transform, opacity"
            : "transition: transform 150ms cubic-bezier(0.23, 1, 0.32, 1), opacity 150ms cubic-bezier(0.23, 1, 0.32, 1)";
          changed = true;
          i = valEnd;
          continue;
        }
      }
    }
    out += css[i];
    i += 1;
  }
  return { css: out, changed };
}

/**
 * Generate safe, deterministic repair operations for high-confidence defects in `report`.
 */
function proposeDeterministicFixes(document, report) {
  const patchesByNode = new Map();
  const patchFor = (nodeId) => {
    if (typeof nodeId !== "string" || !Object.hasOwn(document.nodes ?? {}, nodeId)) return null;
    const node = document.nodes[nodeId];
    if (!node || node.type === "design-system" || node.type === "component-instance" || node.type === "component-definition" || isCodePart(node)) return null;
    let entry = patchesByNode.get(nodeId);
    if (!entry) {
      entry = {
        node,
        style: { ...(isPlainRecord(node.props?.style) ? node.props.style : {}) },
        styleChanged: false,
        attributes: { ...(isPlainRecord(node.props?.attributes) ? node.props.attributes : {}) },
        attributesChanged: false,
        stylesheet: typeof node.props?.stylesheet === "string" ? node.props.stylesheet : null,
        stylesheetChanged: false,
        reasons: [],
      };
      patchesByNode.set(nodeId, entry);
    }
    return entry;
  };

  const setStyle = (patch, key, value) => {
    if (UNSAFE_STYLE_KEYS.has(key)) return false;
    if (Object.hasOwn(patch.style, key) && patch.style[key] === value) return false;
    patch.style[key] = value;
    patch.styleChanged = true;
    return true;
  };
  const delStyle = (patch, key) => {
    if (UNSAFE_STYLE_KEYS.has(key) || !Object.hasOwn(patch.style, key)) return false;
    delete patch.style[key];
    patch.styleChanged = true;
    return true;
  };

  for (const finding of report.findings) {
    if (!finding.nodeId) continue;
    const patch = patchFor(finding.nodeId);
    if (!patch) continue;

    if (finding.ruleId === "taste:color-low-contrast" || finding.ruleId === "a11y:text-contrast" || finding.ruleId === "vision:rendered-low-contrast") {
      const explicitBg = finding.evidence?.background ?? finding.evidence?.effectiveBackground;
      const bgRgb = (typeof explicitBg === "string" ? parseOpaqueColor(explicitBg) : null)
        ?? resolveInheritedBackground(document, finding.nodeId, patch.style);
      const nextColor = chooseAccessibleForeground(bgRgb);
      if (setStyle(patch, "color", nextColor)) {
        patch.reasons.push(`improved contrast on ${finding.nodeId} to ${nextColor}`);
      }
    } else if (finding.ruleId === "taste:interactive-target-size" || finding.ruleId === "vision:target-below-24px") {
      let mutated = false;
      if (setStyle(patch, "min-height", "36px")) mutated = true;
      if (setStyle(patch, "min-width", "36px")) mutated = true;
      if (delStyle(patch, "minHeight")) mutated = true;
      if (delStyle(patch, "minWidth")) mutated = true;
      if (Object.hasOwn(patch.style, "height") && typeof patch.style.height === "string" && PX_VALUE.test(patch.style.height) && parseFloat(patch.style.height) < 36) {
        if (delStyle(patch, "height")) mutated = true;
      }
      if (Object.hasOwn(patch.style, "width") && typeof patch.style.width === "string" && PX_VALUE.test(patch.style.width) && parseFloat(patch.style.width) < 36) {
        if (delStyle(patch, "width")) mutated = true;
      }
      if (mutated) patch.reasons.push(`raised target size on ${finding.nodeId} to >=36px`);
    } else if (finding.ruleId === "taste:mobile-touch-target" || finding.ruleId === "vision:mobile-target-below-44px") {
      let mutated = false;
      if (setStyle(patch, "min-height", "44px")) mutated = true;
      if (setStyle(patch, "min-width", "44px")) mutated = true;
      if (delStyle(patch, "minHeight")) mutated = true;
      if (delStyle(patch, "minWidth")) mutated = true;
      if (Object.hasOwn(patch.style, "height") && typeof patch.style.height === "string" && PX_VALUE.test(patch.style.height) && parseFloat(patch.style.height) < 44) {
        if (delStyle(patch, "height")) mutated = true;
      }
      if (Object.hasOwn(patch.style, "width") && typeof patch.style.width === "string" && PX_VALUE.test(patch.style.width) && parseFloat(patch.style.width) < 44) {
        if (delStyle(patch, "width")) mutated = true;
      }
      if (mutated) patch.reasons.push(`raised mobile touch target on ${finding.nodeId} to >=44px`);
    } else if (finding.ruleId === "vision:horizontal-overflow") {
      let mutated = false;
      if (setStyle(patch, "max-width", "100%")) mutated = true;
      if (setStyle(patch, "box-sizing", "border-box")) mutated = true;
      if (delStyle(patch, "maxWidth")) mutated = true;
      if (delStyle(patch, "boxSizing")) mutated = true;
      if (Object.hasOwn(patch.style, "width") && typeof patch.style.width === "string" && PX_VALUE.test(patch.style.width) && parseFloat(patch.style.width) > 320) {
        if (setStyle(patch, "width", "100%")) mutated = true;
      }
      if (mutated) patch.reasons.push(`constrained horizontal overflow on ${finding.nodeId}`);
    } else if (finding.ruleId === "taste:body-tight-leading") {
      const m1 = setStyle(patch, "line-height", "1.55");
      const m2 = delStyle(patch, "lineHeight");
      if (m1 || m2) patch.reasons.push(`improved body line-height on ${finding.nodeId} to 1.55`);
    } else if (finding.ruleId === "taste:display-loose-leading") {
      const m1 = setStyle(patch, "line-height", "1.12");
      const m2 = delStyle(patch, "lineHeight");
      if (m1 || m2) patch.reasons.push(`tightened display line-height on ${finding.nodeId} to 1.12`);
    } else if (finding.ruleId === "taste:spacing-off-grid") {
      const prop = finding.evidence?.property;
      if (typeof prop === "string" && !UNSAFE_STYLE_KEYS.has(prop) && Object.hasOwn(patch.style, prop) && typeof patch.style[prop] === "string") {
        const snapped = snapPxTo4(patch.style[prop]);
        if (setStyle(patch, prop, snapped)) {
          patch.reasons.push(`snapped ${prop} on ${finding.nodeId} to 4px grid (${snapped})`);
        }
      }
    } else if (finding.ruleId === "taste:anti-slop-heavy-shadow") {
      const m1 = setStyle(patch, "box-shadow", "var(--shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.06))");
      const m2 = delStyle(patch, "boxShadow");
      if (m1 || m2) patch.reasons.push(`replaced heavy drop shadow on ${finding.nodeId} with subtle elevation`);
    } else if (finding.ruleId === "motion:gpu-composited-only" && typeof patch.stylesheet === "string") {
      const { css: updated, changed } = rewriteThrashingTransitions(patch.stylesheet);
      if (changed && Buffer.byteLength(updated, "utf8") <= MAX_STYLESHEET_BYTES) {
        patch.stylesheet = updated;
        patch.stylesheetChanged = true;
        patch.reasons.push(`restricted transitions on ${finding.nodeId} to compositor-only properties`);
      }
    } else if (finding.ruleId === "motion:missing-reduced-motion" && typeof patch.stylesheet === "string") {
      if (!/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/iu.test(patch.stylesheet)) {
        const candidate = `${patch.stylesheet.trimEnd()}\n@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`;
        if (Buffer.byteLength(candidate, "utf8") <= MAX_STYLESHEET_BYTES) {
          patch.stylesheet = candidate;
          patch.stylesheetChanged = true;
          patch.reasons.push(`added prefers-reduced-motion fallback to ${finding.nodeId}`);
        }
      }
    } else if (finding.ruleId === "a11y:image-alt") {
      const tag = typeof patch.node.props?.tag === "string" ? patch.node.props.tag.toLowerCase() : "";
      if (tag === "img" && !Object.hasOwn(patch.attributes, "alt")) {
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
