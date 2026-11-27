// Ninerr Systems: deterministic Design System Health Audit, High-Contrast mode generation,
// atomic reversible theme migration, responsive breakpoint CSS compilation, and 3-way
// registry component update planning (Issue #405).
import { createHash } from "node:crypto";
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
  tokenUses,
} from "@ninerr/document-model";
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

function resolveValueInMode(tokensByName: Map<string, any>, tokenName: string, modeId: string, defaultModes: Map<string, string>, depth = 0): string | null {
  if (depth > 8) return null;
  const token = tokensByName.get(tokenName);
  if (!token) return null;
  const fallbackMode = defaultModes.get(token.collection);
  const raw = token.values?.[modeId] ?? (fallbackMode ? token.values?.[fallbackMode] : undefined) ?? Object.values(token.values ?? {})[0];
  if (typeof raw !== "string") return null;
  const match = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/iu.exec(raw.trim());
  if (match) return resolveValueInMode(tokensByName, match[1], modeId, defaultModes, depth + 1);
  return raw;
}

/**
 * Audit a Ninerr document's design system for duplicate values, unused tokens, hardcoded
 * literal values that match defined tokens, missing mode values, and cross-mode contrast failures.
 */
export function auditDesignSystem(document: any) {
  const system = designSystemOf(document);
  if (system === null) {
    return {
      hasDesignSystem: false,
      tokenCount: 0,
      collectionCount: 0,
      modeCount: 0,
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

  // 1. Unused tokens (neither referenced by layers nor aliased by another token).
  const aliasedTargets = new Set<string>();
  for (const token of tokens) {
    for (const val of Object.values(token.values ?? {})) {
      for (const ref of tokenReferences(String(val))) aliasedTargets.add(ref);
    }
  }
  let unusedTokens = 0;
  for (const token of tokens) {
    const uses = tokenUses(document, token.name);
    if (uses.length === 0 && !aliasedTargets.has(token.name)) {
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

  // 2. Duplicate literal values within the same collection + type across all modes.
  const valueGroups = new Map<string, string[]>();
  for (const token of tokens) {
    const defaultMode = defaultModes.get(token.collection);
    const val = defaultMode ? token.values?.[defaultMode] : undefined;
    if (typeof val !== "string" || val.includes("var(")) continue;
    const key = `${token.collection}|${token.type}|${val.trim().toLowerCase()}`;
    const list = valueGroups.get(key) ?? [];
    list.push(token.name);
    valueGroups.set(key, list);
  }
  let duplicateGroups = 0;
  for (const [key, names] of valueGroups) {
    if (names.length < 2) continue;
    duplicateGroups += 1;
    const [, type, val] = key.split("|");
    findings.push({
      ruleId: "system:duplicate-token-value",
      kind: "heuristic-observation",
      severity: "warning",
      message: `${names.length} ${type} tokens (${names.join(", ")}) duplicate the same literal value ${val}.`,
      evidence: { tokens: names.sort(), type, value: val },
    });
  }

  // 3. Missing mode coverage within a token's collection.
  for (const token of tokens) {
    const col = collectionsById.get(token.collection);
    if (!col) continue;
    const missing = (col.modes ?? []).map((m: any) => m.id).filter((id: string) => token.values?.[id] === undefined);
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

  // 4. Hardcoded literal layer style values that match an existing token's default value.
  const literalToTokens = new Map<string, string[]>();
  for (const token of tokens) {
    const defaultMode = defaultModes.get(token.collection);
    const val = defaultMode ? token.values?.[defaultMode] : undefined;
    if (typeof val !== "string" || val.includes("var(")) continue;
    const norm = val.trim().toLowerCase();
    const list = literalToTokens.get(norm) ?? [];
    list.push(token.name);
    literalToTokens.set(norm, list);
  }
  let hardcodedMatches = 0;
  for (const [nodeId, node] of Object.entries<any>(document.nodes ?? {})) {
    if (node.type === "design-system") continue;
    for (const { field, value } of styleValuesOf(node)) {
      if (field === "stylesheet" || value.includes("var(")) continue;
      const norm = value.trim().toLowerCase();
      const matched = literalToTokens.get(norm);
      if (matched && matched.length > 0) {
        hardcodedMatches += 1;
        findings.push({
          ruleId: "system:hardcoded-literal-matches-token",
          kind: "heuristic-observation",
          severity: "warning",
          message: `Layer ${nodeId} ${field} hardcodes ${value}, which matches token ${matched[0]}.`,
          evidence: { nodeId, field, value, matchingTokens: matched },
        });
      }
    }
  }

  // 5. Cross-mode WCAG contrast check for canonical semantic pairs.
  let contrastFailures = 0;
  const allModes = new Set<string>();
  for (const col of collections) {
    for (const mode of col.modes ?? []) allModes.add(mode.id);
  }
  for (const modeId of allModes) {
    for (const pair of CONTRAST_PAIRS) {
      if (!tokensByName.has(pair.fg) || !tokensByName.has(pair.bg)) continue;
      const fgVal = resolveValueInMode(tokensByName, pair.fg, modeId, defaultModes);
      const bgVal = resolveValueInMode(tokensByName, pair.bg, modeId, defaultModes);
      const fgRgb = parseOpaqueColor(fgVal);
      const bgRgb = parseOpaqueColor(bgVal);
      if (!fgRgb || !bgRgb) continue;
      const ratio = contrastRatio(fgRgb, bgRgb);
      const minRatio = modeId.includes("high-contrast") ? 7.0 : 4.5;
      if (ratio < minRatio) {
        contrastFailures += 1;
        findings.push({
          ruleId: "system:mode-contrast-failure",
          kind: "deterministic-defect",
          severity: "error",
          message: `Mode "${modeId}" ${pair.label} (${pair.fg} ${fgVal} on ${pair.bg} ${bgVal}) achieves ${ratio.toFixed(2)}:1, below ${minRatio}:1.`,
          evidence: { mode: modeId, fg: pair.fg, bg: pair.bg, fgVal, bgVal, contrastRatio: Number(ratio.toFixed(2)), required: minRatio },
        });
      }
    }
  }

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
  const collection = collectionId
    ? props.collections.find((c: any) => c.id === collectionId)
    : props.collections[0];
  if (!collection) throw new StudioError(404, "unknown-collection", `collection ${String(collectionId)} was not found`);
  if (collection.modes.some((m: any) => m.id === "high-contrast")) {
    throw new StudioError(409, "mode-exists", `collection ${collection.id} already has a high-contrast mode`);
  }
  collection.modes.push({ id: "high-contrast", name: "High Contrast" });
  for (const token of props.tokens) {
    if (token.collection !== collection.id) continue;
    const baseVal = token.values[collection.defaultMode] ?? Object.values(token.values)[0];
    if (Object.hasOwn(HIGH_CONTRAST_OVERRIDES, token.name)) {
      token.values["high-contrast"] = HIGH_CONTRAST_OVERRIDES[token.name];
    } else if (token.type === "color" && /text|foreground|fg/iu.test(token.name)) {
      token.values["high-contrast"] = "#000000";
    } else if (token.type === "color" && /bg|surface|canvas/iu.test(token.name)) {
      token.values["high-contrast"] = "#ffffff";
    } else if (token.type === "color" && /border/iu.test(token.name)) {
      token.values["high-contrast"] = "#111827";
    } else {
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
  const collection = collectionId
    ? props.collections.find((c: any) => c.id === collectionId)
    : props.collections[0];
  if (!collection) throw new StudioError(404, "unknown-collection", `collection ${String(collectionId)} was not found`);

  const hasAnyDark = incoming.some((t) => typeof t?.dark === "string" && t.dark.trim() !== "");
  let darkMode = collection.modes.find((m: any) => m.id === "dark" || m.name.toLowerCase() === "dark");
  if (hasAnyDark && !darkMode) {
    darkMode = { id: "dark", name: "Dark" };
    collection.modes.push(darkMode);
    for (const existing of props.tokens) {
      if (existing.collection === collection.id && existing.values[darkMode.id] === undefined) {
        existing.values[darkMode.id] = existing.values[collection.defaultMode];
      }
    }
  }

  const updated: Array<{ name: string; before: Record<string, string>; after: Record<string, string> }> = [];
  const added: Array<{ name: string; type: string; values: Record<string, string> }> = [];
  const unchanged: string[] = [];

  for (const entry of incoming) {
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string" || !TOKEN_NAME.test(entry.name)) {
      throw new StudioError(400, "invalid-token-name", `invalid token name ${JSON.stringify(entry?.name).slice(0, 60)}`);
    }
    const primaryVal = entry.light ?? entry.value;
    if (typeof primaryVal !== "string" || cssValueProblem(primaryVal) !== null) {
      throw new StudioError(422, "invalid-token-value", `${entry.name}: invalid primary CSS value`);
    }
    if (entry.dark !== undefined && (typeof entry.dark !== "string" || cssValueProblem(entry.dark) !== null)) {
      throw new StudioError(422, "invalid-token-value", `${entry.name}: invalid dark CSS value`);
    }
    const existing = props.tokens.find((t: any) => t.name === entry.name);
    if (existing) {
      const before = { ...existing.values };
      const after = { ...existing.values, [collection.defaultMode]: primaryVal };
      if (darkMode && entry.dark !== undefined) after[darkMode.id] = entry.dark;
      if (JSON.stringify(before) === JSON.stringify(after)) {
        unchanged.push(entry.name);
      } else {
        existing.values = after;
        if (typeof entry.description === "string" && entry.description.trim() !== "") {
          existing.description = entry.description.trim().slice(0, 500);
        }
        updated.push({ name: entry.name, before, after });
      }
    } else {
      const tokenType = typeof entry.type === "string" && TOKEN_TYPES.includes(entry.type as any) ? entry.type : "color";
      const values: Record<string, string> = { [collection.defaultMode]: primaryVal };
      if (darkMode) values[darkMode.id] = entry.dark ?? primaryVal;
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

  const operations = updated.length === 0 && added.length === 0
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
    if (!bp || typeof cssBody !== "string" || cssBody.trim() === "") continue;
    const conds: string[] = [];
    if (bp.minWidth !== undefined) conds.push(`(min-width: ${bp.minWidth}px)`);
    if (bp.maxWidth !== undefined) conds.push(`(max-width: ${bp.maxWidth}px)`);
    if (conds.length === 0) continue;
    blocks.push(`${keyword} ${conds.join(" and ")} {\n${cssBody.trim()}\n}`);
  }
  return blocks.join("\n\n");
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
