// Ninerr Taste Engine: context-aware deterministic and heuristic design evaluation.
// Every finding is explicitly classified into one of three tiers:
//   - "deterministic-defect": objectively verifiable failure (contrast, target size, invalid spacing/layout)
//   - "heuristic-observation": strong design craft smell contextualized by the active product brief
//   - "subjective-suggestion": optional aesthetic refinement for agent or human consideration

import { contrastRatio, parseOpaqueColor } from "@ninerr/design-assurance";
import { designSystemOf } from "@ninerr/document-model";
import { getDomainArchetype } from "./archetypes.mjs";
import { lintMotionCss } from "./motion.mjs";

const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const SEVERITY_ORDER = Object.freeze({ error: 0, warning: 1, info: 2 });
const SPACING_PROPS = Object.freeze([
  "padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
  "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
  "gap", "row-gap", "column-gap", "rowGap", "columnGap",
]);

function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function parsePx(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  let match = /^(-?\d+(?:\.\d+)?)px$/iu.exec(trimmed);
  if (match) return Number(match[1]);
  match = /^(-?\d+(?:\.\d+)?)rem$/iu.exec(trimmed);
  if (match) return Number(match[1]) * 16;
  return null;
}

function parseLineHeightRatio(lineHeight, fontSizePx) {
  if (typeof lineHeight !== "string") return null;
  const trimmed = lineHeight.trim();
  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) return Number(trimmed);
  const px = parsePx(trimmed);
  if (px !== null && fontSizePx && fontSizePx > 0) return px / fontSizePx;
  return null;
}

function resolveTokenMap(system) {
  const map = new Map();
  if (!system?.props?.tokens) return map;
  const defaults = new Map(system.props.collections.map((c) => [c.id, c.defaultMode]));
  for (const token of system.props.tokens) {
    const mode = defaults.get(token.collection);
    const val = token.values?.[mode] ?? Object.values(token.values ?? {})[0];
    if (typeof val === "string") map.set(token.name, val);
  }
  return map;
}

/** Resolve var(--name, fallback) calls inside a CSS value, handling nested fallbacks and shorthands. */
function resolveCssValue(raw, tokenMap, depth = 0) {
  if (typeof raw !== "string" || depth > 8 || !raw.includes("var(")) return raw;
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const idx = raw.indexOf("var(", i);
    if (idx === -1) {
      out += raw.slice(i);
      break;
    }
    out += raw.slice(i, idx);
    let depthParen = 1;
    let end = idx + 4;
    while (end < raw.length && depthParen > 0) {
      if (raw[end] === "(") depthParen += 1;
      else if (raw[end] === ")") depthParen -= 1;
      end += 1;
    }
    if (depthParen !== 0) {
      out += raw.slice(idx);
      break;
    }
    const inner = raw.slice(idx + 4, end - 1);
    const comma = inner.indexOf(",");
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? "" : inner.slice(comma + 1).trim();
    const mapped = tokenMap.get(name);
    if (mapped !== undefined) {
      out += resolveCssValue(mapped, tokenMap, depth + 1);
    } else if (fallback !== "") {
      out += resolveCssValue(fallback, tokenMap, depth + 1);
    } else {
      out += raw.slice(idx, end);
    }
    i = end;
  }
  return out;
}

/** Extract max blur radius (px) and max alpha from a CSS box-shadow value. */
function inspectBoxShadow(rawShadow) {
  if (typeof rawShadow !== "string" || rawShadow.trim() === "" || rawShadow.trim().toLowerCase() === "none") {
    return { maxBlurPx: 0, maxAlpha: 0 };
  }
  let maxBlurPx = 0;
  let maxAlpha = 0;
  // Split shadow layers on top-level commas (outside parentheses).
  const layers = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i <= rawShadow.length; i += 1) {
    const ch = rawShadow[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if ((ch === "," && depth === 0) || i === rawShadow.length) {
      layers.push(rawShadow.slice(start, i).trim());
      start = i + 1;
    }
  }
  for (const layer of layers) {
    // Remove color functions before reading offset-x, offset-y, blur-radius, spread-radius lengths.
    for (const alphaMatch of layer.matchAll(/rgba?\([^)]*?(?:,|\/)\s*(0?\.\d+|1(?:\.0+)?|0)\s*\)/giu)) {
      const a = Number(alphaMatch[1]);
      if (Number.isFinite(a) && a > maxAlpha) maxAlpha = a;
    }
    const withoutColors = layer.replace(/[a-z]+\([^)]*\)|#[0-9a-f]{3,8}\b|\binset\b/giu, " ");
    const lengths = [...withoutColors.matchAll(/(?:^|\s)(-?\d+(?:\.\d+)?)(px|rem)?(?=\s|$)/giu)]
      .map((m) => (m[2]?.toLowerCase() === "rem" ? Number(m[1]) * 16 : Number(m[1])));
    if (lengths.length >= 3 && Number.isFinite(lengths[2]) && lengths[2] > maxBlurPx) {
      maxBlurPx = lengths[2];
    }
  }
  return { maxBlurPx, maxAlpha };
}

function isCardLike(style) {
  if (!style || typeof style !== "object") return false;
  const hasRadius = parsePx(style.borderRadius ?? style["border-radius"] ?? "") > 0;
  const hasBorder = typeof (style.border ?? style["border-color"]) === "string" && !/none|0px/iu.test(String(style.border ?? ""));
  const hasShadow = typeof (style.boxShadow ?? style["box-shadow"]) === "string" && !/none/iu.test(String(style.boxShadow ?? style["box-shadow"]));
  const hasBg = typeof (style.background ?? style.backgroundColor ?? style["background-color"]) === "string";
  return (hasRadius && (hasBorder || hasShadow)) || (hasBorder && hasShadow && hasBg);
}

function isBadgeLike(node, style) {
  const tag = String(node.props?.tag ?? "").toLowerCase();
  const text = typeof node.props?.text === "string" ? node.props.text.trim() : "";
  const radius = parsePx(style?.borderRadius ?? style?.["border-radius"] ?? "");
  const fontSize = parsePx(style?.fontSize ?? style?.["font-size"] ?? "");
  const cls = String(node.props?.attributes?.class ?? "").toLowerCase();
  if (/\bbadge\b|\bpill\b|\bchip\b|\btag\b/u.test(cls)) return true;
  if ((tag === "span" || tag === "div") && text.length > 0 && text.length <= 28 && radius !== null && radius >= 99 && (fontSize === null || fontSize <= 13)) {
    return true;
  }
  return false;
}

function walkSubtree(document, rootId, visit) {
  const roots = rootId ? [rootId] : document.rootIds;
  const stack = [];
  const visited = new Set();
  for (let i = roots.length - 1; i >= 0; i -= 1) {
    const id = roots[i];
    if (Object.hasOwn(document.nodes, id)) stack.push({ id, parentId: null, cardDepth: 0 });
  }
  while (stack.length > 0) {
    const item = stack.pop();
    if (visited.has(item.id) || !Object.hasOwn(document.nodes, item.id)) continue;
    visited.add(item.id);
    const node = document.nodes[item.id];
    if (!node || node.type === "design-system") continue;
    const style = node.props?.style ?? {};
    const cardDepth = isCardLike(style) ? item.cardDepth + 1 : item.cardDepth;
    visit(node, { parentId: item.parentId, cardDepth });
    const children = Array.isArray(node.children) ? node.children : [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push({ id: children[i], parentId: node.id, cardDepth });
    }
  }
}

/**
 * Evaluate a Ninerr document with brief-aware Taste rules covering hierarchy, typography,
 * color harmony, spacing grid, density alignment, anti-slop patterns, token adoption,
 * interactive target sizing, and motion restraint.
 */
export function evaluateTaste(document, { brief: briefOverride = null, rootId = null } = {}) {
  const system = designSystemOf(document);
  const brief = briefOverride ?? system?.props?.brief ?? null;
  const archetype = getDomainArchetype(brief?.domain ?? "enterprise-saas");
  const tokenMap = resolveTokenMap(system);
  const findings = [];

  const headingSizes = { h1: [], h2: [], h3: [] };
  const bodySizes = [];
  const fontFamilies = new Set();
  const literalColors = new Map();
  const literalAccentColors = new Set();
  const paddings = [];

  walkSubtree(document, rootId, (node, { cardDepth }) => {
    const props = node.props ?? {};
    const tag = String(props.tag ?? (node.type === "text" ? "p" : "div")).toLowerCase();
    const style = props.style && typeof props.style === "object" ? props.style : {};
    const text = typeof props.text === "string" ? props.text.trim() : "";

    const rawFontSize = resolveCssValue(style.fontSize ?? style["font-size"], tokenMap);
    const fontSizePx = parsePx(rawFontSize);
    const rawLineHeight = resolveCssValue(style.lineHeight ?? style["line-height"], tokenMap);
    const rawFontFamily = resolveCssValue(style.fontFamily ?? style["font-family"], tokenMap);
    const rawColor = resolveCssValue(style.color, tokenMap);
    const rawBg = resolveCssValue(style.backgroundColor ?? style["background-color"] ?? style.background, tokenMap);
    const rawShadow = resolveCssValue(style.boxShadow ?? style["box-shadow"], tokenMap);
    const rawWidth = resolveCssValue(style.width, tokenMap);
    const rawHeight = resolveCssValue(style.height, tokenMap);
    const rawMaxWidth = resolveCssValue(style.maxWidth ?? style["max-width"], tokenMap);

    if (rawFontFamily && typeof rawFontFamily === "string") {
      const primary = rawFontFamily.split(",")[0].replace(/['"]/gu, "").trim().toLowerCase();
      if (primary) fontFamilies.add(primary);
    }

    if (HEADING_TAGS.has(tag) && fontSizePx !== null) {
      if (tag === "h1" || tag === "h2" || tag === "h3") headingSizes[tag].push({ nodeId: node.id, px: fontSizePx });
      if (fontSizePx >= 36) {
        const lh = parseLineHeightRatio(rawLineHeight, fontSizePx);
        if (lh !== null && lh > 1.35) {
          findings.push({
            ruleId: "taste:display-loose-leading",
            kind: "heuristic-observation",
            severity: "warning",
            nodeId: node.id,
            message: `Display heading (${fontSizePx}px) has loose line-height (${lh.toFixed(2)}); large display headings read tighter between 1.05 and 1.25.`,
            evidence: { fontSizePx, lineHeight: rawLineHeight },
            suggestion: "Tighten display heading line-height to 1.1 to 1.2 and add subtle negative letter-spacing (-0.02em to -0.03em).",
          });
        }
      }
    } else if ((tag === "p" || tag === "span" || tag === "li" || node.type === "text") && fontSizePx !== null) {
      bodySizes.push(fontSizePx);
      const lh = parseLineHeightRatio(rawLineHeight, fontSizePx);
      if (lh !== null && lh < 1.35 && text.length >= 40) {
        findings.push({
          ruleId: "taste:body-tight-leading",
          kind: "heuristic-observation",
          severity: "warning",
          nodeId: node.id,
          message: `Body text (${fontSizePx}px) has cramped line-height (${lh.toFixed(2)}); multi-line copy needs 1.45 to 1.7.`,
          evidence: { fontSizePx, lineHeight: rawLineHeight },
          suggestion: "Increase body copy line-height to at least 1.5 for comfortable scanning.",
        });
      }
    }

    // Long paragraph measure check
    if ((tag === "p" || node.type === "text") && text.length >= 160) {
      const widthPx = parsePx(rawMaxWidth ?? rawWidth ?? "");
      if (widthPx !== null && widthPx > 780) {
        findings.push({
          ruleId: "taste:typography-line-length",
          kind: "heuristic-observation",
          severity: "warning",
          nodeId: node.id,
          message: `Long-form text block width (${widthPx}px) exceeds comfortable reading measure (~58ch to 72ch).`,
          evidence: { textLength: text.length, widthPx },
          suggestion: `Constrain reading measure with maxWidth around ${archetype.typography.measureCh}ch (roughly 620px to 700px).`,
        });
      }
    }

    // Direct fg/bg contrast check when both resolve to opaque colors
    const fgRgb = parseOpaqueColor(rawColor);
    const bgRgb = parseOpaqueColor(rawBg);
    if (fgRgb && bgRgb) {
      const ratio = contrastRatio(fgRgb, bgRgb);
      const rawWeight = resolveCssValue(style.fontWeight ?? style["font-weight"], tokenMap);
      const weightNum = rawWeight === "bold" ? 700 : Number(rawWeight ?? 400);
      const isLarge = fontSizePx !== null && (fontSizePx >= 24 || (fontSizePx >= 18.66 && weightNum >= 700));
      const minRatio = isLarge ? 3.0 : 4.5;
      if (ratio < minRatio) {
        const floored = Math.floor(ratio * 100) / 100;
        findings.push({
          ruleId: "taste:color-low-contrast",
          kind: "deterministic-defect",
          severity: "error",
          nodeId: node.id,
          message: `Foreground ${rawColor} on background ${rawBg} achieves ${floored.toFixed(2)}:1 contrast, below WCAG AA (${minRatio}:1).`,
          evidence: { color: rawColor, background: rawBg, contrastRatio: floored, required: minRatio },
          suggestion: "Adjust foreground or surface color tokens to reach at least 4.5:1 for normal text (3:1 for large display text).",
        });
      }
    }

    // Track literal colors when design-system exists
    for (const key of ["color", "backgroundColor", "background-color", "borderColor", "border-color"]) {
      const val = style[key];
      if (typeof val === "string" && !val.includes("var(")) {
        const rgb = parseOpaqueColor(val);
        if (rgb) {
          const norm = val.trim().toLowerCase();
          literalColors.set(norm, (literalColors.get(norm) ?? 0) + 1);
          const [r, g, b] = rgb;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max - min >= 55) literalAccentColors.add(norm);
        }
      }
    }

    // 4px spacing grid check (both kebab-case and camelCase CSS properties)
    for (const prop of SPACING_PROPS) {
      const resolved = resolveCssValue(style[prop], tokenMap);
      if (typeof resolved !== "string") continue;
      for (const token of resolved.split(/\s+/u)) {
        const px = parsePx(token);
        if (px !== null && px > 2) {
          if (prop === "padding" && !INTERACTIVE_TAGS.has(tag)) paddings.push({ nodeId: node.id, px });
          if (px % 4 !== 0) {
            findings.push({
              ruleId: "taste:spacing-off-grid",
              kind: "heuristic-observation",
              severity: "info",
              nodeId: node.id,
              message: `Spacing ${prop}: ${token} breaks the 4px spatial rhythm grid.`,
              evidence: { property: prop, value: token },
              suggestion: `Snap ${prop} to a 4px multiple (such as ${Math.round(px / 4) * 4}px) or bind a spacing token.`,
            });
          }
        }
      }
    }

    // Anti-slop: gratuitous gradients unless brief explicitly invites editorial gradients
    const bgDecl = String(rawBg ?? "");
    if (/linear-gradient|radial-gradient|conic-gradient/iu.test(bgDecl) && brief?.allowEditorialGradients !== true) {
      findings.push({
        ruleId: "taste:anti-slop-gratuitous-gradient",
        kind: "heuristic-observation",
        severity: "warning",
        nodeId: node.id,
        message: "Decorative CSS gradient detected on a surface whose brief does not request editorial gradients.",
        evidence: { background: bgDecl.slice(0, 120) },
        suggestion: "Prefer clean tonal surface steps (--bg-canvas, --bg-surface, --bg-subtle) and crisp 1px borders unless the brand explicitly calls for a gradient.",
      });
    }

    // Anti-slop: nested cards (card-in-card clutter)
    if (cardDepth >= 2 && isCardLike(style)) {
      findings.push({
        ruleId: "taste:anti-slop-nested-cards",
        kind: "heuristic-observation",
        severity: "warning",
        nodeId: node.id,
        message: `Nested rounded card container at card depth ${cardDepth} adds visual box clutter.`,
        evidence: { cardDepth },
        suggestion: "Flatten inner grouping with spacing, subtle surface tints, or thin dividers instead of nesting bordered cards inside cards.",
      });
    }

    // Anti-slop: heavy harsh shadows (large blur >= 40px, or murky wide blur >= 32px with heavy opacity >= 0.4)
    if (typeof rawShadow === "string" && rawShadow.trim() !== "" && rawShadow !== "none") {
      const { maxBlurPx, maxAlpha } = inspectBoxShadow(rawShadow);
      if (maxBlurPx >= 40 || (maxBlurPx >= 32 && maxAlpha >= 0.4)) {
        findings.push({
          ruleId: "taste:anti-slop-heavy-shadow",
          kind: "heuristic-observation",
          severity: "warning",
          nodeId: node.id,
          message: `Heavy box-shadow (${rawShadow.slice(0, 80)}) creates murky elevation.`,
          evidence: { boxShadow: rawShadow, blurPx: maxBlurPx, alpha: maxAlpha },
          suggestion: "Use crisp 1px borders paired with subtle low-opacity elevation (--shadow-sm or --shadow-md).",
        });
      }
    }

    // Anti-slop: badge clutter and monotonous uniform card grids on parent containers
    const childIds = Array.isArray(node.children) ? node.children : [];
    if (childIds.length >= 4) {
      let badgeCount = 0;
      let identicalCards = 0;
      const signatures = new Map();
      for (const cid of childIds) {
        const child = document.nodes[cid];
        if (!child) continue;
        const cStyle = child.props?.style ?? {};
        if (isBadgeLike(child, cStyle)) badgeCount += 1;
        if (isCardLike(cStyle)) {
          identicalCards += 1;
          const sig = `${child.props?.tag ?? "div"}:${(child.children ?? []).length}`;
          signatures.set(sig, (signatures.get(sig) ?? 0) + 1);
        }
      }
      if (badgeCount >= 4) {
        findings.push({
          ruleId: "taste:anti-slop-badge-clutter",
          kind: "heuristic-observation",
          severity: "warning",
          nodeId: node.id,
          message: `Container holds ${badgeCount} competing pill badges, diluting visual priority.`,
          evidence: { badgeCount },
          suggestion: "Limit prominent pills to 1 to 2 meaningful statuses per container and render secondary metadata as calm muted text.",
        });
      }
      const maxIdentical = Math.max(0, ...signatures.values());
      if (identicalCards >= 4 && maxIdentical >= 4) {
        findings.push({
          ruleId: "taste:anti-slop-uniform-card-grid",
          kind: "subjective-suggestion",
          severity: "info",
          nodeId: node.id,
          message: `Container repeats ${maxIdentical} structurally identical cards; consider varying focal emphasis or using a scannable structured list.`,
          evidence: { identicalCards: maxIdentical },
          suggestion: "Introduce focal asymmetry (lead item, structured table, or split detail view) if these items are not genuinely equal peers.",
        });
      }
    }

    // Interactive touch/click target size check
    if (INTERACTIVE_TAGS.has(tag)) {
      const h = parsePx(rawHeight ?? "");
      const w = parsePx(rawWidth ?? "");
      const minDim = Math.min(h ?? Infinity, w ?? Infinity);
      if (minDim < 24) {
        findings.push({
          ruleId: "taste:interactive-target-size",
          kind: "deterministic-defect",
          severity: "error",
          nodeId: node.id,
          message: `Interactive <${tag}> dimension (${minDim}px) is below WCAG 2.5.8 minimum 24px target size.`,
          evidence: { tag, width: rawWidth ?? null, height: rawHeight ?? null },
          suggestion: "Increase interactive control dimensions or padding to at least 24px (44px on mobile).",
        });
      } else if (brief?.domain === "consumer-mobile" && minDim < 44) {
        findings.push({
          ruleId: "taste:mobile-touch-target",
          kind: "heuristic-observation",
          severity: "warning",
          nodeId: node.id,
          message: `Mobile interactive <${tag}> dimension (${minDim}px) is smaller than the 44px thumb-target recommendation.`,
          evidence: { tag, width: rawWidth ?? null, height: rawHeight ?? null },
          suggestion: "Size mobile touch controls to at least 44px height for reliable tapping.",
        });
      }
    }

    // Motion stylesheet lint on node
    if (typeof props.stylesheet === "string" && props.stylesheet.trim() !== "") {
      findings.push(...lintMotionCss(props.stylesheet, {
        nodeId: node.id,
        allowAmbient: system?.props?.motion?.allowAmbient === true || brief?.allowExpressiveMotion === true,
      }));
    }
  });

  // Document-level checks
  if (fontFamilies.size > 3) {
    findings.push({
      ruleId: "taste:excessive-font-families",
      kind: "heuristic-observation",
      severity: "warning",
      nodeId: rootId,
      message: `Design declares ${fontFamilies.size} distinct font families (${[...fontFamilies].join(", ")}); cohesive interfaces typically stay within 1 to 3 families.`,
      evidence: { fontFamilies: [...fontFamilies] },
      suggestion: "Consolidate onto --font-heading, --font-body, and --font-mono tokens.",
    });
  }

  const medianBody = bodySizes.length > 0 ? bodySizes.sort((a, b) => a - b)[Math.floor(bodySizes.length / 2)] : archetype.typography.baseSizePx;
  for (const h1 of headingSizes.h1) {
    if (h1.px < medianBody * 1.5) {
      findings.push({
        ruleId: "taste:weak-heading-hierarchy",
        kind: "heuristic-observation",
        severity: "warning",
        nodeId: h1.nodeId,
        message: `Primary <h1> (${h1.px}px) is less than 1.5x body size (${medianBody}px), weakening page hierarchy.`,
        evidence: { h1Px: h1.px, bodyPx: medianBody },
        suggestion: `Raise primary heading scale to at least ${Math.round(medianBody * 1.75)}px or bind --text-display.`,
      });
    }
  }
  if (headingSizes.h1.length > 0 && headingSizes.h2.length > 0) {
    const minH1 = Math.min(...headingSizes.h1.map((h) => h.px));
    const maxH2Entry = headingSizes.h2.reduce((best, cur) => (cur.px > best.px ? cur : best), headingSizes.h2[0]);
    if (maxH2Entry.px >= minH1) {
      findings.push({
        ruleId: "taste:inverted-heading-scale",
        kind: "deterministic-defect",
        severity: "warning",
        nodeId: maxH2Entry.nodeId,
        message: `Section heading <h2> (${maxH2Entry.px}px) is as large as or larger than <h1> (${minH1}px).`,
        evidence: { minH1, maxH2: maxH2Entry.px },
        suggestion: "Ensure visual type scale decreases monotonically from h1 -> h2 -> h3 -> body.",
      });
    }
  }

  if (literalAccentColors.size > 4) {
    findings.push({
      ruleId: "taste:color-excessive-accents",
      kind: "heuristic-observation",
      severity: "warning",
      nodeId: rootId,
      message: `Detected ${literalAccentColors.size} distinct saturated literal accent colors; excessive accents fragment focus.`,
      evidence: { accentColors: [...literalAccentColors] },
      suggestion: "Standardize on neutral surfaces plus 1 primary accent and reserved semantic status tokens.",
    });
  }

  if (system && system.props.tokens.length > 0) {
    const repeatedLiterals = [...literalColors.entries()].filter(([, count]) => count >= 3);
    if (repeatedLiterals.length > 0) {
      findings.push({
        ruleId: "taste:missing-token-binding",
        kind: "heuristic-observation",
        severity: "info",
        nodeId: system.id,
        message: `${repeatedLiterals.length} literal color value(s) repeat 3+ times without binding var(--token) references.`,
        evidence: { repeated: repeatedLiterals.map(([value, count]) => ({ value, count })) },
        suggestion: "Bind repeated colors to semantic design-system tokens so theme modes and redesigns stay consistent.",
      });
    }
  }

  if (brief?.density && paddings.length > 0) {
    const avgPadding = paddings.reduce((sum, item) => sum + item.px, 0) / paddings.length;
    if (brief.density === "compact" && avgPadding >= 40) {
      findings.push({
        ruleId: "taste:density-mismatch",
        kind: "heuristic-observation",
        severity: "warning",
        nodeId: rootId,
        message: `Brief requests "compact" density, but average container padding is ${Math.round(avgPadding)}px.`,
        evidence: { expectedDensity: "compact", averagePaddingPx: Math.round(avgPadding) },
        suggestion: "Tighten container padding toward 12px to 20px to match compact operational ergonomics.",
      });
    } else if (brief.density === "spacious" && avgPadding <= 8) {
      findings.push({
        ruleId: "taste:density-mismatch",
        kind: "heuristic-observation",
        severity: "warning",
        nodeId: rootId,
        message: `Brief requests "spacious" density, but average container padding is ${Math.round(avgPadding)}px.`,
        evidence: { expectedDensity: "spacious", averagePaddingPx: Math.round(avgPadding) },
        suggestion: "Increase breathing room toward 24px to 40px around major content groups.",
      });
    }
  }

  findings.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    return compareCodeUnits(a.ruleId, b.ruleId) || compareCodeUnits(String(a.nodeId ?? ""), String(b.nodeId ?? ""));
  });

  const summary = {
    total: findings.length,
    deterministicDefects: findings.filter((f) => f.kind === "deterministic-defect").length,
    heuristicObservations: findings.filter((f) => f.kind === "heuristic-observation").length,
    subjectiveSuggestions: findings.filter((f) => f.kind === "subjective-suggestion").length,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  };

  return Object.freeze({
    archetypeId: archetype.id,
    briefApplied: brief !== null,
    summary: Object.freeze(summary),
    findings: Object.freeze(findings),
  });
}
