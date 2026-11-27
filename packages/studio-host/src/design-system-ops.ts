// Ninerr Systems: deterministic Design System Health Audit, High-Contrast mode generation,
// atomic reversible theme migration, responsive breakpoint CSS compilation, and 3-way
// registry component update planning (Issue #405).
import { createHash, randomUUID } from "node:crypto";
import { threeWayMerge } from "@ninerr/code-ir";
import { contrastRatio, parseOpaqueColor } from "@ninerr/design-assurance";
import {
  TOKEN_NAME,
  TOKEN_TYPES,
  cssValueProblem,
  designSystemOf,
  designSystemProblem,
  newDesignSystemProps,
  styleValuesOf,
  tokenReferences,
} from "@ninerr/document-model";
import { cssClosesUnopenedBlock, cssLoadsOrExecutes } from "@ninerr/import-stack";
import { planElement } from "@ninerr/renderer";
import { StudioError } from "./errors.ts";

export interface DesignSystemAuditFinding {
  ruleId: string;
  kind: "deterministic-defect" | "heuristic-observation";
  severity: "error" | "warning" | "info";
  message: string;
  evidence: Record<string, unknown>;
}

const CONTRAST_PAIRS: ReadonlyArray<{ fg: string; bg: string; label: string }> = Object.freeze([
  { fg: "--text-primary", bg: "--bg-canvas", label: "primary text on canvas" },
  { fg: "--text-primary", bg: "--bg-surface", label: "primary text on surface" },
  { fg: "--text-muted", bg: "--bg-surface", label: "muted text on surface" },
  { fg: "--accent-contrast", bg: "--accent-primary", label: "text on primary accent" },
]);

const RESERVED_MARKER_RE = /ninerr-(?:breakpoints|motion):(?:start|end)/iu;

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sameStringRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.hasOwn(b, key) || a[key] !== b[key]) return false;
  }
  return true;
}

/** Replace CSS comments and string literals with spaces so custom-property declarations scan cleanly. */
function stripCssStringsAndComments(css: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (quote !== null) {
      if (ch === "\\" && i + 1 < css.length) {
        out += "  ";
        i += 1;
        continue;
      }
      if (ch === quote || ch === "\n" || ch === "\r" || ch === "\f") quote = null;
      out += " ";
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) return out;
      out += " ";
      i = end + 1;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

function resolveValueInMode(
  tokensByName: Map<string, any>,
  tokenName: string,
  modeId: string,
  defaultModes: Map<string, string>,
  depth = 0,
): string | null {
  if (depth > 8) return null;
  const token = tokensByName.get(tokenName);
  if (!token || !token.values || typeof token.values !== "object") return null;
  const fallbackMode = defaultModes.get(token.collection);
  const raw = Object.hasOwn(token.values, modeId)
    ? token.values[modeId]
    : (fallbackMode && Object.hasOwn(token.values, fallbackMode) ? token.values[fallbackMode] : Object.values(token.values)[0]);
  if (typeof raw !== "string") return null;
  const match = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/iu.exec(raw.trim());
  if (match) return resolveValueInMode(tokensByName, match[1], modeId, defaultModes, depth + 1);
  return raw;
}

/**
 * Audit a Ninerr document's design system in linear time for duplicate values, unused tokens,
 * hardcoded literal values that match defined tokens, missing mode values, and cross-mode
 * WCAG contrast failures.
 */
export function auditDesignSystem(document: any) {
  const system = designSystemOf(document);
  if (system === null) {
    return {
      hasDesignSystem: false,
      tokenCount: 0,
      collectionCount: 0,
      modeCount: 0,
      hasHighContrastMode: false,
      hasBreakpoints: false,
      findings: [{
        ruleId: "system:missing-design-system",
        kind: "heuristic-observation" as const,
        severity: "info" as const,
        message: "Document has no design-system node yet; create tokens so themes and components stay coherent.",
        evidence: {},
      }],
      summary: { errors: 0, warnings: 0, info: 1, unusedTokens: 0, duplicateGroups: 0, hardcodedMatches: 0, contrastFailures: 0 },
    };
  }

  const findings: DesignSystemAuditFinding[] = [];
  const tokens: any[] = system.props.tokens ?? [];
  const collections: any[] = system.props.collections ?? [];
  const tokensByName = new Map<string, any>(tokens.map((t) => [t.name, t]));
  const defaultModes = new Map<string, string>(collections.map((c) => [c.id, c.defaultMode]));
  const collectionsById = new Map<string, any>(collections.map((c) => [c.id, c]));

  // Single-pass index of every token used by layers (var() refs and local custom-property declarations)
  // AND hardcoded style values matching defined tokens, avoiding O(tokens * nodes * styles).
  const literalToTokens = new Map<string, string[]>();
  for (const token of tokens) {
    const defaultMode = defaultModes.get(token.collection);
    const val = defaultMode && Object.hasOwn(token.values ?? {}, defaultMode) ? token.values[defaultMode] : undefined;
    if (typeof val !== "string" || tokenReferences(val).length > 0) continue;
    const norm = val.trim().toLowerCase();
    const list = literalToTokens.get(norm) ?? [];
    list.push(token.name);
    literalToTokens.set(norm, list);
  }
  for (const list of literalToTokens.values()) list.sort(compareCodeUnits);

  const usedByLayers = new Set<string>();
  let hardcodedMatches = 0;
  const DECL_RE = /(?<![\w-])(--[A-Za-z0-9_-]{1,127})(?=\s*:)/gu;
  for (const [nodeId, node] of Object.entries<any>(document.nodes ?? {})) {
    if (node.type === "design-system") continue;
    for (const { field, value } of styleValuesOf(node)) {
      const refs = tokenReferences(value);
      for (const ref of refs) usedByLayers.add(ref);
      if (field === "stylesheet" && value.includes("--")) {
        const stripped = stripCssStringsAndComments(value);
        for (const match of stripped.matchAll(DECL_RE)) usedByLayers.add(match[1]);
      } else if (field !== "stylesheet" && refs.length === 0) {
        const norm = value.trim().toLowerCase();
        const matched = literalToTokens.get(norm);
        if (matched && matched.length > 0) {
          hardcodedMatches += 1;
          findings.push({
            ruleId: "system:hardcoded-literal-matches-token",
            kind: "heuristic-observation",
            severity: "warning",
            message: `Layer ${nodeId} ${field} hardcodes ${value}, which matches token ${matched[0]}.`,
            evidence: { nodeId, field, value, matchingTokens: [...matched] },
          });
        }
      }
    }
  }

  // 1. Unused tokens (neither referenced/declared by layers nor aliased by another token).
  const aliasedTargets = new Set<string>();
  for (const token of tokens) {
    for (const val of Object.values(token.values ?? {})) {
      for (const ref of tokenReferences(String(val))) aliasedTargets.add(ref);
    }
  }
  let unusedTokens = 0;
  for (const token of tokens) {
    if (!usedByLayers.has(token.name) && !aliasedTargets.has(token.name)) {
      unusedTokens += 1;
      findings.push({
        ruleId: "system:unused-token",
        kind: "heuristic-observation",
        severity: "info",
        message: `Token ${token.name} is defined but not used by any layer or alias.`,
        evidence: { token: token.name, type: token.type },
      });
    }
  }

  // 2. Duplicate literal values within the same collection + type across all modes of that collection.
  const valueGroups = new Map<string, { type: string; value: string; names: string[] }>();
  for (const token of tokens) {
    const col = collectionsById.get(token.collection);
    if (!col) continue;
    const modeIds = (col.modes ?? []).map((m: any) => m.id).sort(compareCodeUnits);
    const modePairs: Array<[string, string]> = [];
    let hasVarRef = false;
    for (const modeId of modeIds) {
      if (!Object.hasOwn(token.values ?? {}, modeId)) continue;
      const rawVal = token.values[modeId];
      if (typeof rawVal !== "string") continue;
      if (tokenReferences(rawVal).length > 0) {
        hasVarRef = true;
        break;
      }
      modePairs.push([modeId, rawVal.trim().toLowerCase()]);
    }
    if (hasVarRef || modePairs.length === 0) continue;
    const defaultMode = defaultModes.get(token.collection);
    const displayVal = (defaultMode && Object.hasOwn(token.values ?? {}, defaultMode)
      ? String(token.values[defaultMode]).trim().toLowerCase()
      : modePairs[0][1]);
    const key = JSON.stringify([token.collection, token.type, modePairs]);
    const group = valueGroups.get(key) ?? { type: token.type, value: displayVal, names: [] };
    group.names.push(token.name);
    valueGroups.set(key, group);
  }
  let duplicateGroups = 0;
  for (const group of valueGroups.values()) {
    if (group.names.length < 2) continue;
    duplicateGroups += 1;
    const sortedNames = [...group.names].sort(compareCodeUnits);
    findings.push({
      ruleId: "system:duplicate-token-value",
      kind: "heuristic-observation",
      severity: "warning",
      message: `${sortedNames.length} ${group.type} tokens (${sortedNames.join(", ")}) duplicate the same literal value ${group.value}.`,
      evidence: { tokens: sortedNames, type: group.type, value: group.value },
    });
  }

  // 3. Missing mode coverage within a token's collection.
  for (const token of tokens) {
    const col = collectionsById.get(token.collection);
    if (!col) continue;
    const missing = (col.modes ?? [])
      .map((m: any) => m.id)
      .filter((id: string) => !Object.hasOwn(token.values ?? {}, id))
      .sort(compareCodeUnits);
    if (missing.length > 0) {
      findings.push({
        ruleId: "system:missing-mode-value",
        kind: "deterministic-defect",
        severity: "warning",
        message: `Token ${token.name} is missing values for mode(s): ${missing.join(", ")}.`,
        evidence: { token: token.name, collection: token.collection, missingModes: missing },
      });
    }
  }

  // 4. Cross-mode WCAG contrast check scoped strictly to the modes of the pair's own collections.
  let contrastFailures = 0;
  for (const pair of CONTRAST_PAIRS) {
    const fgToken = tokensByName.get(pair.fg);
    const bgToken = tokensByName.get(pair.bg);
    if (!fgToken || !bgToken) continue;
    const pairModes = new Set<string>();
    for (const colId of [fgToken.collection, bgToken.collection]) {
      const col = collectionsById.get(colId);
      for (const mode of col?.modes ?? []) pairModes.add(mode.id);
    }
    for (const modeId of [...pairModes].sort(compareCodeUnits)) {
      const fgVal = resolveValueInMode(tokensByName, pair.fg, modeId, defaultModes);
      const bgVal = resolveValueInMode(tokensByName, pair.bg, modeId, defaultModes);
      const fgRgb = parseOpaqueColor(fgVal);
      const bgRgb = parseOpaqueColor(bgVal);
      if (!fgRgb || !bgRgb) continue;
      const ratio = contrastRatio(fgRgb, bgRgb);
      const minRatio = /high[-_]?contrast/iu.test(modeId) ? 7.0 : 4.5;
      if (ratio < minRatio) {
        const floored = Math.floor(ratio * 100) / 100;
        contrastFailures += 1;
        findings.push({
          ruleId: "system:mode-contrast-failure",
          kind: "deterministic-defect",
          severity: "error",
          message: `Mode "${modeId}" ${pair.label} (${pair.fg} ${fgVal} on ${pair.bg} ${bgVal}) achieves ${floored.toFixed(2)}:1, below ${minRatio}:1.`,
          evidence: { mode: modeId, fg: pair.fg, bg: pair.bg, fgVal, bgVal, contrastRatio: floored, required: minRatio },
        });
      }
    }
  }

  const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    || compareCodeUnits(a.ruleId, b.ruleId)
    || compareCodeUnits(a.message, b.message));

  const modeCount = collections.reduce((sum, col) => sum + (col.modes?.length ?? 0), 0);
  return {
    hasDesignSystem: true,
    tokenCount: tokens.length,
    collectionCount: collections.length,
    modeCount,
    hasHighContrastMode: collections.some((col) => (col.modes ?? []).some((m: any) => m.id === "high-contrast")),
    hasBreakpoints: Array.isArray(system.props.breakpoints) && system.props.breakpoints.length > 0,
    findings,
    summary: {
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      info: findings.filter((f) => f.severity === "info").length,
      unusedTokens,
      duplicateGroups,
      hardcodedMatches,
      contrastFailures,
    },
  };
}

const HIGH_CONTRAST_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  "--bg-canvas": "#ffffff",
  "--bg-surface": "#ffffff",
  "--bg-subtle": "#f3f4f6",
  "--text-primary": "#000000",
  "--text-muted": "#1f2937",
  "--border-subtle": "#111827",
  "--accent-primary": "#003d33",
  "--accent-contrast": "#ffffff",
  "--status-success": "#0d5c2a",
  "--status-warning": "#78350f",
  "--status-danger": "#991b1b",
});

/**
 * Build one atomic undoable transaction adding a WCAG AAA (>=7:1) high-contrast mode
 * to the target token collection.
 */
export function generateHighContrastMode(document: any, { collectionId }: { collectionId?: string } = {}) {
  const system = designSystemOf(document);
  if (system === null) throw new StudioError(422, "no-design-system", "the document has no design system yet");
  const props = structuredClone(system.props);
  const collection = collectionId !== undefined
    ? props.collections.find((c: any) => c.id === collectionId)
    : props.collections[0];
  if (!collection) throw new StudioError(404, "unknown-collection", `collection ${String(collectionId)} was not found`);
  if (collection.modes.some((m: any) => m.id === "high-contrast")) {
    throw new StudioError(409, "mode-exists", `collection ${collection.id} already has a high-contrast mode`);
  }
  collection.modes.push({ id: "high-contrast", name: "High Contrast" });
  for (const token of props.tokens) {
    if (token.collection !== collection.id) continue;
    const baseVal = Object.hasOwn(token.values, collection.defaultMode)
      ? token.values[collection.defaultMode]
      : Object.values(token.values)[0];
    if (Object.hasOwn(HIGH_CONTRAST_OVERRIDES, token.name)) {
      token.values["high-contrast"] = HIGH_CONTRAST_OVERRIDES[token.name];
    } else if (token.type === "color" && /text|foreground|fg/iu.test(token.name)) {
      token.values["high-contrast"] = "#000000";
    } else if (token.type === "color" && /bg|surface|canvas/iu.test(token.name)) {
      token.values["high-contrast"] = "#ffffff";
    } else if (token.type === "color" && /border/iu.test(token.name)) {
      token.values["high-contrast"] = "#111827";
    } else if (typeof baseVal === "string") {
      token.values["high-contrast"] = baseVal;
    }
  }
  const problem = designSystemProblem(props);
  if (problem !== null) throw new StudioError(422, "invalid-design-system", problem);
  return {
    collectionId: collection.id,
    modeId: "high-contrast",
    operations: [{ type: "set-props", nodeId: system.id, set: { collections: props.collections, tokens: props.tokens } }],
  };
}

export interface ThemeTokenInput {
  name: string;
  type?: string;
  light?: string;
  dark?: string;
  value?: string;
  description?: string;
}

/**
 * Preview and build a single atomic, undoable whole-app theme migration updating or adding
 * semantic design tokens across light and dark modes.
 */
export function planThemeMigration(document: any, {
  tokens: incoming,
  themeName = "Migrated theme",
  collectionId,
}: {
  tokens: ThemeTokenInput[];
  themeName?: string;
  collectionId?: string;
}) {
  if (!Array.isArray(incoming) || incoming.length === 0 || incoming.length > 500) {
    throw new StudioError(400, "invalid-theme", "tokens must be a list of 1-500 theme token entries");
  }
  const system = designSystemOf(document);
  const props = system === null ? newDesignSystemProps(themeName) : structuredClone(system.props);
  const collection = collectionId !== undefined
    ? props.collections.find((c: any) => c.id === collectionId)
    : props.collections[0];
  if (!collection) throw new StudioError(404, "unknown-collection", `collection ${String(collectionId)} was not found`);

  // Snapshot original token state before any mode-creation mutation so diffs and no-op detection are exact.
  const originalValues = new Map<string, Record<string, string>>();
  const originalDescription = new Map<string, string | undefined>();
  for (const tok of props.tokens) {
    originalValues.set(tok.name, { ...tok.values });
    originalDescription.set(tok.name, tok.description);
  }

  let modesAdded = false;
  const ensureModes = (col: any, needDark: boolean) => {
    let lightMode = col.modes.find((m: any) => m.id === "light" || m.name.toLowerCase() === "light");
    let darkMode = col.modes.find((m: any) => m.id !== lightMode?.id && (m.id === "dark" || m.name.toLowerCase() === "dark"));
    const defaultModeObj = col.modes.find((m: any) => m.id === col.defaultMode) ?? col.modes[0];
    if (!lightMode && !darkMode) {
      lightMode = defaultModeObj;
    } else if (!lightMode && darkMode) {
      if (defaultModeObj.id !== darkMode.id) {
        lightMode = defaultModeObj;
      } else {
        const id = col.modes.some((m: any) => m.id === "light") ? `light-${randomUUID().slice(0, 6)}` : "light";
        lightMode = { id, name: "Light" };
        col.modes.push(lightMode);
        modesAdded = true;
        for (const existingTok of props.tokens) {
          if (existingTok.collection === col.id && !Object.hasOwn(existingTok.values, lightMode.id) && Object.hasOwn(existingTok.values, col.defaultMode)) {
            existingTok.values[lightMode.id] = existingTok.values[col.defaultMode];
          }
        }
      }
    }
    if (needDark && !darkMode) {
      const id = col.modes.some((m: any) => m.id === "dark") ? `dark-${randomUUID().slice(0, 6)}` : "dark";
      darkMode = { id, name: "Dark" };
      col.modes.push(darkMode);
      modesAdded = true;
      for (const existingTok of props.tokens) {
        if (existingTok.collection === col.id && !Object.hasOwn(existingTok.values, darkMode.id) && Object.hasOwn(existingTok.values, col.defaultMode)) {
          existingTok.values[darkMode.id] = existingTok.values[col.defaultMode];
        }
      }
    }
    return { lightModeId: lightMode.id, darkModeId: darkMode?.id ?? null };
  };

  // Validate all incoming entries upfront (reject duplicates & invalid types cleanly).
  const seenNames = new Set<string>();
  const hasNewTokenWithDark = incoming.some((entry) =>
    entry && typeof entry.name === "string"
    && !props.tokens.some((t: any) => t.name === entry.name)
    && typeof entry.dark === "string" && entry.dark.trim() !== "",
  );

  for (const entry of incoming) {
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string" || !TOKEN_NAME.test(entry.name)) {
      throw new StudioError(400, "invalid-token-name", `invalid token name ${JSON.stringify(entry?.name).slice(0, 60)}`);
    }
    if (seenNames.has(entry.name)) {
      throw new StudioError(400, "duplicate-token", `duplicate token ${entry.name} in theme migration`);
    }
    seenNames.add(entry.name);
    if (entry.type !== undefined && (typeof entry.type !== "string" || !TOKEN_TYPES.includes(entry.type as any))) {
      throw new StudioError(400, "invalid-token-type", `${entry.name}: invalid token type ${JSON.stringify(entry.type).slice(0, 40)}`);
    }
    const primaryVal = entry.light ?? entry.value;
    if (typeof primaryVal !== "string" || cssValueProblem(primaryVal) !== null) {
      throw new StudioError(422, "invalid-token-value", `${entry.name}: invalid primary CSS value`);
    }
    if (entry.dark !== undefined && (typeof entry.dark !== "string" || cssValueProblem(entry.dark) !== null)) {
      throw new StudioError(422, "invalid-token-value", `${entry.name}: invalid dark CSS value`);
    }
  }

  const updated: Array<{ name: string; before: Record<string, string>; after: Record<string, string> }> = [];
  const added: Array<{ name: string; type: string; values: Record<string, string> }> = [];
  const unchanged: string[] = [];

  for (const entry of incoming) {
    const primaryVal = (entry.light ?? entry.value) as string;
    const existing = props.tokens.find((t: any) => t.name === entry.name);
    if (existing) {
      const targetCol = props.collections.find((c: any) => c.id === existing.collection) ?? collection;
      const { lightModeId, darkModeId } = ensureModes(targetCol, entry.dark !== undefined);
      const before = originalValues.get(entry.name) ?? { ...existing.values };
      const after = { ...existing.values, [lightModeId]: primaryVal };
      if (darkModeId && entry.dark !== undefined) after[darkModeId] = entry.dark;
      const typeChanged = entry.type !== undefined && existing.type !== entry.type;
      if (typeChanged) existing.type = entry.type;
      const nextDesc = typeof entry.description === "string" && entry.description.trim() !== ""
        ? entry.description.trim().slice(0, 500)
        : undefined;
      const descChanged = nextDesc !== undefined && nextDesc !== originalDescription.get(entry.name);
      if (descChanged) existing.description = nextDesc;
      if (!typeChanged && !descChanged && sameStringRecord(before, after)) {
        unchanged.push(entry.name);
      } else {
        existing.values = after;
        updated.push({ name: entry.name, before, after });
      }
    } else {
      const { lightModeId, darkModeId } = ensureModes(collection, entry.dark !== undefined || hasNewTokenWithDark);
      const tokenType = entry.type ?? "color";
      const values: Record<string, string> = {};
      for (const mode of collection.modes) {
        if (darkModeId && mode.id === darkModeId) values[mode.id] = entry.dark ?? primaryVal;
        else if (mode.id === lightModeId) values[mode.id] = primaryVal;
        else values[mode.id] = primaryVal;
      }
      props.tokens.push({
        name: entry.name,
        type: tokenType,
        collection: collection.id,
        values,
        ...(typeof entry.description === "string" && entry.description.trim() !== "" ? { description: entry.description.trim().slice(0, 500) } : {}),
      });
      added.push({ name: entry.name, type: tokenType, values });
    }
  }

  const problem = designSystemProblem(props);
  if (problem !== null) throw new StudioError(422, "invalid-theme", problem);

  const hash = createHash("sha256").update(JSON.stringify(props)).digest("hex").slice(0, 12);
  let dsId = `design-system-${hash}`;
  for (let suffix = 2; system === null && Object.hasOwn(document.nodes ?? {}, dsId); suffix += 1) {
    dsId = `design-system-${hash}-${suffix}`;
  }

  const hasChanges = updated.length > 0 || added.length > 0 || modesAdded;
  const operations = !hasChanges
    ? []
    : system === null
      ? [{ type: "insert-node", parentId: null, index: (document.rootIds ?? []).length, node: { id: dsId, type: "design-system", props } }]
      : [{ type: "set-props", nodeId: system.id, set: { collections: props.collections, tokens: props.tokens } }];

  return {
    themeName,
    collectionId: collection.id,
    updated,
    added,
    unchanged,
    operations,
  };
}

/**
 * Strict CSS Syntax Level 3 block/string balance verifier for CSS embedded inside `@media` / `@container`.
 * Rejects unescaped newlines in strings (<bad-string-token>), stray escapes, unclosed comments,
 * and mismatched or interleaved `{}`, `()`, `[]` blocks.
 */
function balancedCssBlocks(css: string): boolean {
  const norm = css.replace(/\r\n|[\r\f]/gu, "\n");
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = 0; i < norm.length; i += 1) {
    const ch = norm[i];
    if (quote !== null) {
      if (ch === "\\") {
        if (i + 1 >= norm.length) return false;
        i += 1;
        continue;
      }
      if (ch === "\n") return false;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\\") {
      if (i + 1 >= norm.length || norm[i + 1] === "\n") return false;
      i += 1;
      continue;
    }
    if (ch === "/" && norm[i + 1] === "*") {
      const end = norm.indexOf("*/", i + 2);
      if (end < 0) return false;
      i = end + 1;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") stack.push("}");
    else if (ch === "(") stack.push(")");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === ")" || ch === "]") {
      if (stack.length === 0 || stack.pop() !== ch) return false;
    }
  }
  return quote === null && stack.length === 0;
}

/**
 * Compile responsive breakpoint rules into safe @media or @container CSS rules for a node's
 * props.stylesheet (NEVER emitted into compileTokens()).
 */
export function compileBreakpointsStylesheet(
  breakpoints: Array<{ id: string; minWidth?: number; maxWidth?: number }>,
  rulesByBreakpoint: Record<string, string>,
  { useContainer = false }: { useContainer?: boolean } = {},
): string {
  const byId = new Map(breakpoints.map((bp) => [bp.id, bp]));
  const blocks: string[] = [];
  const keyword = useContainer ? "@container" : "@media";
  for (const [id, cssBody] of Object.entries(rulesByBreakpoint)) {
    const bp = byId.get(id);
    if (!bp) {
      throw new StudioError(400, "unknown-breakpoint", `unknown breakpoint id ${JSON.stringify(id).slice(0, 60)}`);
    }
    if (typeof cssBody !== "string") {
      throw new StudioError(400, "invalid-breakpoint-css", `breakpoint ${id} CSS must be a string`);
    }
    if (cssBody.trim() === "") continue;
    if (RESERVED_MARKER_RE.test(cssBody)) {
      throw new StudioError(422, "unsafe-breakpoint-css", `breakpoint ${id} CSS must not contain Ninerr internal marker comments`);
    }
    if (!balancedCssBlocks(cssBody) || cssClosesUnopenedBlock(cssBody)) {
      throw new StudioError(422, "unsafe-breakpoint-css", `breakpoint ${id} CSS has unbalanced blocks, strings, or escapes`);
    }
    if (cssLoadsOrExecutes(cssBody)) {
      throw new StudioError(422, "unsafe-breakpoint-css", `breakpoint ${id} CSS must not load external resources or execute code`);
    }
    const conds: string[] = [];
    if (bp.minWidth !== undefined) {
      if (!Number.isInteger(bp.minWidth) || bp.minWidth < 0 || bp.minWidth > 10000) {
        throw new StudioError(400, "invalid-breakpoint", `breakpoint ${id} has invalid minWidth (0..10000)`);
      }
      conds.push(`(min-width: ${bp.minWidth}px)`);
    }
    if (bp.maxWidth !== undefined) {
      if (!Number.isInteger(bp.maxWidth) || bp.maxWidth < 0 || bp.maxWidth > 10000) {
        throw new StudioError(400, "invalid-breakpoint", `breakpoint ${id} has invalid maxWidth (0..10000)`);
      }
      conds.push(`(max-width: ${bp.maxWidth}px)`);
    }
    if (bp.minWidth !== undefined && bp.maxWidth !== undefined && bp.minWidth > bp.maxWidth) {
      throw new StudioError(400, "invalid-breakpoint", `breakpoint ${id} minWidth exceeds maxWidth`);
    }
    if (conds.length === 0) continue;
    blocks.push(`${keyword} ${conds.join(" and ")} {\n${cssBody.trim()}\n}`);
  }
  const compiled = blocks.join("\n\n");
  if (compiled !== "") {
    if (cssLoadsOrExecutes(compiled) || cssClosesUnopenedBlock(compiled)) {
      throw new StudioError(422, "unsafe-breakpoint-css", "breakpoint CSS was rejected by the stylesheet security check");
    }
    const planned = planElement({ id: "breakpoint-check", type: "frame", props: { stylesheet: compiled } });
    if (planned.stylesheet === null || planned.dropped > 0) {
      throw new StudioError(422, "unsafe-breakpoint-css", "breakpoint CSS was rejected by the renderer sanitizer");
    }
  }
  return compiled;
}

/**
 * Plan a 3-way merge update for an imported component file using @ninerr/code-ir's threeWayMerge.
 * Preserves local human edits cleanly and fails closed with exact conflict locations on overlap.
 */
export function planRegistryItemUpdate({
  baseContent,
  localContent,
  upstreamContent,
}: {
  baseContent: string;
  localContent: string;
  upstreamContent: string;
}) {
  const result = threeWayMerge(baseContent, localContent, upstreamContent);
  return {
    status: result.conflicts.length === 0 ? (result.merged === localContent ? "unchanged" : "merged") : "conflict",
    mergedContent: result.merged,
    conflicts: result.conflicts,
  };
}
