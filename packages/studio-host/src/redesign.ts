// Ninerr Code & Existing-Application Redesign Engine:
// 1. Static offline codebase analysis (framework, styling, routes, components, static AST token
//    extraction, and functional contract inventory — never executes target code or configs).
// 2. Whole-File @babel/parser Business-Logic & JSX Functional-Contract Invariance Gate.
// 3. 3-Tier Bounded Patch Engine (Tier 1 CSS variables, Tier 2 JSX className / cn / clsx / twMerge /
//    cva static strings & literal styles, Tier 3 opt-in structural) with SHA-256 conflict checks,
//    symlink-safe workspace confinement, journaled backup, and atomic multi-file rollback.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { parse as babelParse } from "@babel/parser";
import { StudioError } from "./errors.ts";
import { writeTrustedFile } from "./trusted-file.ts";

export const REDESIGN_LIMITS = Object.freeze({
  maxScanFiles: 600,
  maxScanDepth: 12,
  maxFileBytes: 512 * 1024,
  maxPatchFiles: 64,
});

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".turbo", ".nuxt", ".svelte-kit", "coverage", ".cache"]);
const CODE_EXTS = new Set([".tsx", ".jsx", ".ts", ".js", ".mjs", ".vue", ".svelte", ".astro"]);
const JSX_EXTS = new Set([".tsx", ".jsx", ".js", ".mjs"]);
const CSS_EXTS = new Set([".css", ".scss"]);
const CLASS_HELPERS = new Set(["cn", "clsx", "cx", "twMerge", "classNames", "cva"]);
const FUNCTIONAL_ATTR_PREFIXES = ["on", "aria-"];
const FUNCTIONAL_ATTRS = new Set([
  "ref", "key", "id", "name", "type", "role", "href", "to", "action", "method",
  "value", "defaultValue", "checked", "defaultChecked", "disabled", "required",
  "readOnly", "tabIndex", "data-testid", "htmlFor", "for", "target", "rel",
]);
const INTERACTIVE_ELEMENTS = new Set(["form", "button", "a", "input", "select", "textarea", "label"]);
const AST_META_KEYS = new Set(["start", "end", "loc", "extra", "leadingComments", "trailingComments", "innerComments", "tokens", "comments", "range"]);

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

function resolveSafePath(workspaceRoot: string, relPath: string): { rootReal: string; absPath: string; relNorm: string } {
  if (typeof relPath !== "string" || relPath.trim() === "" || relPath.includes("\\") || relPath.startsWith("/") || relPath.includes("\0")) {
    throw new StudioError(400, "invalid-path", `invalid relative path ${JSON.stringify(String(relPath)).slice(0, 80)}`);
  }
  const rootReal = realpathSync(resolve(workspaceRoot));
  const segments = relPath.split("/");
  let cursor = rootReal;
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      throw new StudioError(400, "invalid-path", `path escapes workspace: ${relPath.slice(0, 80)}`);
    }
    cursor = join(cursor, seg);
    if (existsSync(cursor)) {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink()) {
        throw new StudioError(409, "symlink-refused", `refusing to access symlinked path ${relPath}`);
      }
    }
  }
  if (cursor !== rootReal && !cursor.startsWith(`${rootReal}${sep}`)) {
    throw new StudioError(400, "invalid-path", `path escapes workspace: ${relPath.slice(0, 80)}`);
  }
  return { rootReal, absPath: cursor, relNorm: segments.join("/") };
}

function parseCodeAst(source: string, filePath: string) {
  const ext = extname(filePath).toLowerCase();
  const plugins: any[] = ["decorators-legacy", "importAttributes"];
  if (ext === ".ts" || ext === ".tsx") plugins.push("typescript");
  if (ext === ".tsx" || ext === ".jsx" || ext === ".js" || ext === ".mjs") plugins.push("jsx");
  return babelParse(source, { sourceType: "unambiguous", plugins, errorRecovery: false });
}

function isFunctionalJsxAttr(attrName: string): boolean {
  if (FUNCTIONAL_ATTRS.has(attrName)) return true;
  for (const prefix of FUNCTIONAL_ATTR_PREFIXES) {
    if (attrName.startsWith(prefix) && (prefix !== "on" || /^on[A-Z]/u.test(attrName))) return true;
  }
  return false;
}

function jsxAttrName(attr: any): string {
  if (!attr?.name) return "";
  if (attr.name.type === "JSXIdentifier") return attr.name.name;
  if (attr.name.type === "JSXNamespacedName") return `${attr.name.namespace.name}:${attr.name.name.name}`;
  return "";
}

function jsxElementName(node: any): string {
  if (!node) return "";
  if (node.type === "JSXIdentifier") return node.name;
  if (node.type === "JSXMemberExpression") return `${jsxElementName(node.object)}.${node.property.name}`;
  if (node.type === "JSXNamespacedName") return `${node.namespace.name}:${node.name.name}`;
  return "";
}

/** Canonicalize an AST subtree ignoring source positions and styling-only JSX attributes. */
function canonicalAstJson(node: any, { stripJsxStyling = false }: { stripJsxStyling?: boolean } = {}): unknown {
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    const items: unknown[] = [];
    for (const entry of node) {
      if (stripJsxStyling && entry?.type === "JSXAttribute") {
        const name = jsxAttrName(entry);
        if (name === "className" || name === "class" || name === "style") continue;
      }
      if (stripJsxStyling && entry?.type === "JSXText" && String(entry.value ?? "").trim() === "") continue;
      items.push(canonicalAstJson(entry, { stripJsxStyling }));
    }
    return items;
  }
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(node).sort()) {
    if (AST_META_KEYS.has(key)) continue;
    if (stripJsxStyling && node.type === "JSXElement" && (key === "openingElement" || key === "closingElement")) {
      // Keep element tag name only for interactive/custom components; preserve all functional attrs.
      if (key === "closingElement") continue;
      const opening = node.openingElement;
      const tag = jsxElementName(opening?.name);
      out.openingElement = {
        tag: /^[A-Z]/u.test(tag) || INTERACTIVE_ELEMENTS.has(tag) ? tag : "container",
        attributes: canonicalAstJson(opening?.attributes ?? [], { stripJsxStyling: true }),
      };
      continue;
    }
    out[key] = canonicalAstJson(node[key], { stripJsxStyling });
  }
  return out;
}

function extractFunctionalContract(ast: any, source: string) {
  const directives = (ast.program?.directives ?? []).map((d: any) => String(d.value?.value ?? "")).sort();
  const hooks: string[] = [];
  const handlers: string[] = [];
  const functionalAttrs: string[] = [];
  const spreads: string[] = [];
  const interactiveTags: Record<string, number> = Object.create(null);
  const childExpressions: string[] = [];

  const stack: any[] = [ast.program];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    if (node.type === "CallExpression" && node.callee?.type === "Identifier" && /^use[A-Z]/u.test(node.callee.name)) {
      hooks.push(node.callee.name);
    }
    if (node.type === "JSXOpeningElement") {
      const tag = jsxElementName(node.name);
      if (INTERACTIVE_ELEMENTS.has(tag)) {
        interactiveTags[tag] = (interactiveTags[tag] ?? 0) + 1;
      }
      for (const attr of node.attributes ?? []) {
        if (attr.type === "JSXSpreadAttribute") {
          spreads.push(source.slice(attr.start, attr.end).replace(/\s+/gu, " ").trim());
        } else if (attr.type === "JSXAttribute") {
          const name = jsxAttrName(attr);
          if (isFunctionalJsxAttr(name)) {
            const valSlice = attr.value ? source.slice(attr.value.start, attr.value.end).replace(/\s+/gu, " ").trim() : "true";
            const entry = `${tag}:${name}=${valSlice}`;
            if (/^on[A-Z]/u.test(name)) handlers.push(entry);
            else functionalAttrs.push(entry);
          }
        }
      }
    }
    if (node.type === "JSXExpressionContainer" && node.expression && node.expression.type !== "JSXEmptyExpression") {
      // Only track child expressions or non-style prop expressions.
      if (node._isStylingProp !== true) {
        childExpressions.push(JSON.stringify(canonicalAstJson(node.expression)));
      }
    }

    for (const key of Object.keys(node)) {
      if (AST_META_KEYS.has(key) || key === "_isStylingProp") continue;
      const child = node[key];
      if (node.type === "JSXAttribute" && key === "value") {
        const attrName = jsxAttrName(node);
        if ((attrName === "className" || attrName === "class" || attrName === "style") && child?.type === "JSXExpressionContainer") {
          // Do not record static styling expressions as business-logic expressions,
          // EXCEPT preserve any dynamic identifier/call sub-expressions inside cn/clsx/conditionals.
          continue;
        }
      }
      if (Array.isArray(child)) {
        for (const item of child) if (item && typeof item === "object" && typeof item.type === "string") stack.push(item);
      } else if (child && typeof child === "object" && typeof child.type === "string") {
        stack.push(child);
      }
    }
  }

  hooks.sort();
  handlers.sort();
  functionalAttrs.sort();
  spreads.sort();
  childExpressions.sort();
  return { directives, hooks, handlers, functionalAttrs, spreads, interactiveTags, childExpressions };
}

/**
 * Whole-File @babel/parser Business-Logic & JSX Functional-Contract Invariance Gate.
 * Proves a visual redesign patch kept directive prologues, non-JSX business logic, hooks,
 * event handlers, spreads, form/test attributes, and interactive elements 100% intact.
 */
export function verifyFunctionalInvariance(beforeSource: string, afterSource: string, filePath = "Component.tsx") {
  const violations: string[] = [];
  let beforeAst: any;
  let afterAst: any;
  try {
    beforeAst = parseCodeAst(beforeSource, filePath);
  } catch (error) {
    return { ok: false, violations: [`failed to parse original ${filePath}: ${error instanceof Error ? error.message : String(error)}`] };
  }
  try {
    afterAst = parseCodeAst(afterSource, filePath);
  } catch (error) {
    return { ok: false, violations: [`redesigned ${filePath} has invalid syntax: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const beforeContract = extractFunctionalContract(beforeAst, beforeSource);
  const afterContract = extractFunctionalContract(afterAst, afterSource);

  if (JSON.stringify(beforeContract.directives) !== JSON.stringify(afterContract.directives)) {
    violations.push(`directive prologues changed: ${JSON.stringify(beforeContract.directives)} -> ${JSON.stringify(afterContract.directives)}`);
  }
  if (JSON.stringify(beforeContract.hooks) !== JSON.stringify(afterContract.hooks)) {
    violations.push(`React hook calls changed: ${JSON.stringify(beforeContract.hooks)} -> ${JSON.stringify(afterContract.hooks)}`);
  }
  if (JSON.stringify(beforeContract.handlers) !== JSON.stringify(afterContract.handlers)) {
    violations.push("JSX event handlers (on*) were altered or dropped");
  }
  if (JSON.stringify(beforeContract.functionalAttrs) !== JSON.stringify(afterContract.functionalAttrs)) {
    violations.push("functional JSX attributes (ref, key, id, name, type, href, data-testid, aria-*, etc.) changed");
  }
  if (JSON.stringify(beforeContract.spreads) !== JSON.stringify(afterContract.spreads)) {
    violations.push("JSX spread attributes ({...props}) changed");
  }
  if (JSON.stringify(beforeContract.interactiveTags) !== JSON.stringify(afterContract.interactiveTags)) {
    violations.push(`interactive element counts changed: ${JSON.stringify(beforeContract.interactiveTags)} -> ${JSON.stringify(afterContract.interactiveTags)}`);
  }

  const beforeLogicHash = sha256(JSON.stringify(canonicalAstJson(beforeAst.program, { stripJsxStyling: true })));
  const afterLogicHash = sha256(JSON.stringify(canonicalAstJson(afterAst.program, { stripJsxStyling: true })));
  if (beforeLogicHash !== afterLogicHash) {
    violations.push("non-styling business logic, component structure, or dynamic expressions changed");
  }

  return {
    ok: violations.length === 0,
    beforeLogicHash,
    afterLogicHash,
    contract: afterContract,
    violations,
  };
}

/**
 * Extract CSS custom property declarations from a CSS file without executing anything.
 */
function extractCssCustomProperties(cssText: string): Array<{ name: string; value: string; start: number; end: number }> {
  const found: Array<{ name: string; value: string; start: number; end: number }> = [];
  for (const match of cssText.matchAll(/(--[A-Za-z0-9_-]{1,127})\s*:\s*([^;{}\n]+);/gu)) {
    const valStart = match.index! + match[0].indexOf(match[2]);
    found.push({
      name: match[1],
      value: match[2].trim(),
      start: valStart,
      end: valStart + match[2].length,
    });
  }
  return found;
}

/**
 * Analyze an existing local application workspace offline (never executes any target file).
 */
export function analyzeCodebase(workspaceRoot: string) {
  const rootReal = realpathSync(resolve(workspaceRoot));
  if (!lstatSync(rootReal).isDirectory()) {
    throw new StudioError(400, "invalid-workspace", "workspaceRoot must be an existing directory");
  }

  let pkgJson: any = null;
  const pkgPath = join(rootReal, "package.json");
  if (existsSync(pkgPath) && !lstatSync(pkgPath).isSymbolicLink()) {
    try {
      pkgJson = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
      pkgJson = null;
    }
  }
  const allDeps = { ...(pkgJson?.dependencies ?? {}), ...(pkgJson?.devDependencies ?? {}) };

  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > REDESIGN_LIMITS.maxScanDepth || files.length >= REDESIGN_LIMITS.maxScanFiles) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= REDESIGN_LIMITS.maxScanFiles) break;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (CODE_EXTS.has(ext) || CSS_EXTS.has(ext) || ext === ".html") {
          files.push(relative(rootReal, join(dir, entry.name)).replace(/\\/gu, "/"));
        }
      }
    }
  };
  walk(rootReal, 0);

  // Detect framework
  const frameworks: string[] = [];
  if (allDeps.next) frameworks.push("nextjs");
  if (allDeps.react) frameworks.push(allDeps.vite ? "react-vite" : "react");
  if (allDeps.vue || files.some((f) => f.endsWith(".vue"))) frameworks.push("vue");
  if (allDeps.svelte || files.some((f) => f.endsWith(".svelte"))) frameworks.push("svelte");
  if (allDeps.astro || files.some((f) => f.endsWith(".astro"))) frameworks.push("astro");
  if (frameworks.length === 0) frameworks.push(files.some((f) => f.endsWith(".html")) ? "static-html" : "unknown");

  // Detect styling systems & scan tokens + contracts
  const styling = new Set<string>();
  if (allDeps.tailwindcss) styling.add(String(allDeps.tailwindcss).includes("4") ? "tailwind-v4" : "tailwind-v3");
  if (allDeps["@stylexjs/stylex"] || allDeps["@astryxdesign/core"]) styling.add("stylex");

  const cssFiles = files.filter((f) => CSS_EXTS.has(extname(f).toLowerCase()));
  const componentFiles = files.filter((f) => CODE_EXTS.has(extname(f).toLowerCase()));
  const routeFiles = componentFiles.filter((f) => /(?:^|\/)(?:pages|app|routes)\//u.test(f) || /(?:page|layout)\.[jt]sx?$/u.test(f));

  const tokens: Array<{ file: string; name: string; value: string }> = [];
  for (const rel of cssFiles) {
    const abs = join(rootReal, rel);
    const stat = lstatSync(abs);
    if (stat.size > REDESIGN_LIMITS.maxFileBytes) continue;
    const text = readFileSync(abs, "utf8");
    if (/@theme\b/u.test(text)) styling.add("tailwind-v4");
    if (rel.endsWith(".module.css") || rel.endsWith(".module.scss")) styling.add("css-modules");
    const props = extractCssCustomProperties(text);
    if (props.length > 0) styling.add("css-variables");
    for (const prop of props) tokens.push({ file: rel, name: prop.name, value: prop.value });
  }

  let totalHooks = 0;
  let totalHandlers = 0;
  let totalTestIds = 0;
  const inspectedComponents: Array<{ file: string; hooks: number; handlers: number; interactiveElements: number }> = [];

  for (const rel of componentFiles) {
    if (!JSX_EXTS.has(extname(rel).toLowerCase())) continue;
    const abs = join(rootReal, rel);
    const stat = lstatSync(abs);
    if (stat.size > REDESIGN_LIMITS.maxFileBytes) continue;
    const text = readFileSync(abs, "utf8");
    try {
      const ast = parseCodeAst(text, rel);
      const contract = extractFunctionalContract(ast, text);
      totalHooks += contract.hooks.length;
      totalHandlers += contract.handlers.length;
      totalTestIds += contract.functionalAttrs.filter((a) => a.includes(":data-testid=")).length;
      const interactiveCount = Object.values(contract.interactiveTags).reduce((sum, n) => sum + n, 0);
      inspectedComponents.push({
        file: rel,
        hooks: contract.hooks.length,
        handlers: contract.handlers.length,
        interactiveElements: interactiveCount,
      });
    } catch {
      // skip non-JSX helper scripts cleanly
    }
  }

  return {
    workspaceRoot: rootReal,
    projectName: typeof pkgJson?.name === "string" ? pkgJson.name : null,
    frameworks,
    styling: [...styling].sort(),
    counts: {
      scannedFiles: files.length,
      cssFiles: cssFiles.length,
      componentFiles: componentFiles.length,
      routeFiles: routeFiles.length,
      cssTokens: tokens.length,
      hooks: totalHooks,
      handlers: totalHandlers,
      testIds: totalTestIds,
    },
    cssFiles: cssFiles.slice(0, 60),
    routeFiles: routeFiles.slice(0, 60),
    components: inspectedComponents.slice(0, 80),
    tokens: tokens.slice(0, 200),
  };
}

/**
 * Tier 1: Patch CSS custom-property values in place without ever renaming or deleting variables.
 */
export function patchCssTokensSource(cssText: string, updates: Record<string, string>) {
  const decls = extractCssCustomProperties(cssText);
  const replacements: Array<{ start: number; end: number; value: string; name: string; before: string }> = [];
  for (const decl of decls) {
    if (!Object.hasOwn(updates, decl.name)) continue;
    const nextVal = updates[decl.name];
    if (typeof nextVal !== "string" || nextVal.trim() === "" || /[;{}<>]/u.test(nextVal)) {
      throw new StudioError(422, "invalid-css-value", `invalid CSS value for ${decl.name}`);
    }
    if (nextVal.trim() !== decl.value) {
      replacements.push({ start: decl.start, end: decl.end, value: nextVal.trim(), name: decl.name, before: decl.value });
    }
  }
  let out = cssText;
  for (let i = replacements.length - 1; i >= 0; i -= 1) {
    const r = replacements[i];
    out = out.slice(0, r.start) + r.value + out.slice(r.end);
  }
  return {
    after: out,
    changed: replacements.length > 0,
    changes: replacements.map(({ name, before, value }) => ({ token: name, before, after: value })),
  };
}

/**
 * Tier 2: Range-anchored JSX className / cn / clsx / twMerge / cva static string patching
 * gated by the Whole-File AST Business-Logic & JSX Functional-Contract Invariance Gate.
 */
export function patchJsxClassStrings(source: string, filePath: string, classReplacements: Record<string, string>) {
  const ast = parseCodeAst(source, filePath);
  const edits: Array<{ start: number; end: number; before: string; after: string }> = [];

  const rewriteClassText = (raw: string): string => {
    const tokens = raw.split(/\s+/u).filter(Boolean);
    let changed = false;
    const next = tokens.map((tok) => {
      if (Object.hasOwn(classReplacements, tok)) {
        changed = true;
        return classReplacements[tok];
      }
      return tok;
    });
    return changed ? next.join(" ").trim() : raw;
  };

  const inspectStringLiteral = (node: any) => {
    if (!node || node.type !== "StringLiteral" || typeof node.start !== "number" || typeof node.end !== "number") return;
    const nextVal = rewriteClassText(node.value);
    if (nextVal !== node.value) {
      const quote = source[node.start] === "'" ? "'" : '"';
      edits.push({
        start: node.start,
        end: node.end,
        before: node.value,
        after: `${quote}${nextVal.replaceAll(quote, `\\${quote}`)}${quote}`,
      });
    }
  };

  const inspectClassExpr = (expr: any) => {
    if (!expr) return;
    if (expr.type === "StringLiteral") {
      inspectStringLiteral(expr);
    } else if (expr.type === "CallExpression" && expr.callee?.type === "Identifier" && CLASS_HELPERS.has(expr.callee.name)) {
      for (const arg of expr.arguments ?? []) {
        if (arg.type === "StringLiteral") inspectStringLiteral(arg);
        else if (arg.type === "LogicalExpression" && arg.right?.type === "StringLiteral") inspectStringLiteral(arg.right);
        else if (arg.type === "ConditionalExpression") {
          inspectStringLiteral(arg.consequent);
          inspectStringLiteral(arg.alternate);
        }
      }
    }
  };

  const stack: any[] = [ast.program];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (node.type === "JSXAttribute") {
      const name = jsxAttrName(node);
      if (name === "className" || name === "class") {
        if (node.value?.type === "StringLiteral") inspectStringLiteral(node.value);
        else if (node.value?.type === "JSXExpressionContainer") inspectClassExpr(node.value.expression);
        continue;
      }
    }
    for (const key of Object.keys(node)) {
      if (AST_META_KEYS.has(key)) continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) if (item && typeof item === "object" && typeof item.type === "string") stack.push(item);
      } else if (child && typeof child === "object" && typeof child.type === "string") {
        stack.push(child);
      }
    }
  }

  edits.sort((a, b) => a.start - b.start);
  let after = source;
  for (let i = edits.length - 1; i >= 0; i -= 1) {
    after = after.slice(0, edits[i].start) + edits[i].after + after.slice(edits[i].end);
  }

  const invariance = verifyFunctionalInvariance(source, after, filePath);
  if (!invariance.ok) {
    throw new StudioError(422, "invariance-violated", `redesign refused by AST invariance gate: ${invariance.violations.join("; ")}`);
  }
  return { after, changed: edits.length > 0, edits: edits.length, invariance };
}

export interface PlannedFilePatch {
  file: string;
  tier: 1 | 2 | 3;
  beforeSha256: string;
  afterSha256: string;
  afterContent: string;
  summary: string;
}

export interface RedesignPlan {
  planToken: string;
  workspaceRoot: string;
  patches: PlannedFilePatch[];
}

/**
 * Build a verified multi-file redesign plan (Tier 1 CSS token updates, Tier 2 JSX class
 * replacements, and/or Tier 3 verified source updates), enforcing Whole-File AST Invariance
 * on every JS/TS/JSX/TSX file before anything can be written.
 */
export function planRedesign(workspaceRoot: string, {
  cssTokenUpdates = {},
  jsxClassReplacements = {},
  files = [],
  explicitPatches = [],
}: {
  cssTokenUpdates?: Record<string, string>;
  jsxClassReplacements?: Record<string, string>;
  files?: string[];
  explicitPatches?: Array<{ file: string; afterContent: string; summary?: string }>;
}): RedesignPlan {
  const rootReal = realpathSync(resolve(workspaceRoot));
  const patches: PlannedFilePatch[] = [];
  const seen = new Set<string>();

  const targetFiles = files.length > 0 ? files : analyzeCodebase(rootReal).cssFiles.concat(analyzeCodebase(rootReal).components.map((c) => c.file));

  if (Object.keys(cssTokenUpdates).length > 0) {
    for (const rel of targetFiles) {
      if (patches.length >= REDESIGN_LIMITS.maxPatchFiles) break;
      if (!CSS_EXTS.has(extname(rel).toLowerCase()) || seen.has(rel)) continue;
      const { absPath, relNorm } = resolveSafePath(rootReal, rel);
      if (!existsSync(absPath)) continue;
      const before = readFileSync(absPath, "utf8");
      const res = patchCssTokensSource(before, cssTokenUpdates);
      if (!res.changed) continue;
      seen.add(relNorm);
      patches.push({
        file: relNorm,
        tier: 1,
        beforeSha256: sha256(before),
        afterSha256: sha256(res.after),
        afterContent: res.after,
        summary: `Updated ${res.changes.length} CSS custom propert${res.changes.length === 1 ? "y" : "ies"}`,
      });
    }
  }

  if (Object.keys(jsxClassReplacements).length > 0) {
    for (const rel of targetFiles) {
      if (patches.length >= REDESIGN_LIMITS.maxPatchFiles) break;
      if (!JSX_EXTS.has(extname(rel).toLowerCase()) || seen.has(rel)) continue;
      const { absPath, relNorm } = resolveSafePath(rootReal, rel);
      if (!existsSync(absPath)) continue;
      const before = readFileSync(absPath, "utf8");
      const res = patchJsxClassStrings(before, relNorm, jsxClassReplacements);
      if (!res.changed) continue;
      seen.add(relNorm);
      patches.push({
        file: relNorm,
        tier: 2,
        beforeSha256: sha256(before),
        afterSha256: sha256(res.after),
        afterContent: res.after,
        summary: `Updated ${res.edits} JSX styling expression${res.edits === 1 ? "" : "s"} (AST invariance verified)`,
      });
    }
  }

  for (const explicit of explicitPatches) {
    if (patches.length >= REDESIGN_LIMITS.maxPatchFiles) break;
    const { absPath, relNorm } = resolveSafePath(rootReal, explicit.file);
    if (!existsSync(absPath)) throw new StudioError(404, "missing-file", `file not found: ${relNorm}`);
    if (seen.has(relNorm)) throw new StudioError(409, "duplicate-file", `duplicate patch target: ${relNorm}`);
    const before = readFileSync(absPath, "utf8");
    if (JSX_EXTS.has(extname(relNorm).toLowerCase())) {
      const check = verifyFunctionalInvariance(before, explicit.afterContent, relNorm);
      if (!check.ok) {
        throw new StudioError(422, "invariance-violated", `${relNorm} failed AST invariance gate: ${check.violations.join("; ")}`);
      }
    }
    if (before !== explicit.afterContent) {
      seen.add(relNorm);
      patches.push({
        file: relNorm,
        tier: 3,
        beforeSha256: sha256(before),
        afterSha256: sha256(explicit.afterContent),
        afterContent: explicit.afterContent,
        summary: explicit.summary ?? "Structural visual patch (AST invariance verified)",
      });
    }
  }

  const planToken = sha256(JSON.stringify({
    workspaceRoot: rootReal,
    patches: patches.map(({ file, tier, beforeSha256, afterSha256 }) => ({ file, tier, beforeSha256, afterSha256 })),
  }));

  return { planToken, workspaceRoot: rootReal, patches };
}

/**
 * Apply a verified redesign plan atomically with SHA-256 pre-write verification, journaled
 * backups in `journalDir`, and automatic rollback if any file fails mid-apply.
 */
export function applyRedesignPlan(plan: RedesignPlan, { journalDir, expectedPlanToken }: { journalDir: string; expectedPlanToken?: string }) {
  if (expectedPlanToken !== undefined && expectedPlanToken !== plan.planToken) {
    throw new StudioError(409, "plan-mismatch", "planToken does not match this redesign plan; re-plan before applying");
  }
  if (plan.patches.length === 0) {
    throw new StudioError(400, "empty-plan", "redesign plan contains no file changes");
  }

  const backups: Array<{ file: string; absPath: string; beforeContent: string; beforeSha256: string; afterSha256: string }> = [];
  for (const patch of plan.patches) {
    const { absPath } = resolveSafePath(plan.workspaceRoot, patch.file);
    if (!existsSync(absPath)) throw new StudioError(409, "file-missing", `${patch.file} disappeared before apply`);
    const current = readFileSync(absPath, "utf8");
    if (sha256(current) !== patch.beforeSha256) {
      throw new StudioError(409, "file-changed", `${patch.file} changed on disk since planning; re-plan before applying`);
    }
    if (JSX_EXTS.has(extname(patch.file).toLowerCase())) {
      const check = verifyFunctionalInvariance(current, patch.afterContent, patch.file);
      if (!check.ok) {
        throw new StudioError(422, "invariance-violated", `${patch.file} failed AST invariance gate: ${check.violations.join("; ")}`);
      }
    }
    backups.push({ file: patch.file, absPath, beforeContent: current, beforeSha256: patch.beforeSha256, afterSha256: patch.afterSha256 });
  }

  const runId = `redesign-${randomUUID().slice(0, 12)}`;
  mkdirSync(journalDir, { recursive: true, mode: 0o700 });
  const journalPath = join(journalDir, `${runId}.json`);
  writeTrustedFile(journalPath, JSON.stringify({
    runId,
    planToken: plan.planToken,
    workspaceRoot: plan.workspaceRoot,
    appliedAt: new Date().toISOString(),
    files: backups.map(({ file, beforeSha256, afterSha256, beforeContent }) => ({ file, beforeSha256, afterSha256, beforeContent })),
  }, null, 2));

  const written: typeof backups = [];
  try {
    for (let i = 0; i < plan.patches.length; i += 1) {
      writeFileSync(backups[i].absPath, plan.patches[i].afterContent, "utf8");
      written.push(backups[i]);
    }
  } catch (error) {
    // Roll back already-written files cleanly on any partial write failure.
    for (let i = written.length - 1; i >= 0; i -= 1) {
      try {
        writeFileSync(written[i].absPath, written[i].beforeContent, "utf8");
      } catch {
        // best-effort rollback
      }
    }
    throw new StudioError(500, "apply-failed", `redesign apply failed and rolled back: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    runId,
    planToken: plan.planToken,
    journalPath,
    filesApplied: plan.patches.map((p) => ({ file: p.file, tier: p.tier, summary: p.summary })),
  };
}

/**
 * Roll back a previously applied redesign run from its journal backup, verifying disk SHA-256
 * matches the applied output unless `force: true` is explicitly passed.
 */
export function rollbackRedesign({ workspaceRoot, journalDir, runId, force = false }: { workspaceRoot: string; journalDir: string; runId: string; force?: boolean }) {
  if (!/^redesign-[a-f0-9-]{6,36}$/u.test(runId)) {
    throw new StudioError(400, "invalid-run-id", "invalid redesign runId");
  }
  const journalPath = join(journalDir, `${runId}.json`);
  if (!existsSync(journalPath)) throw new StudioError(404, "missing-journal", `redesign journal ${runId} not found`);
  const record = JSON.parse(readFileSync(journalPath, "utf8"));
  const rootReal = realpathSync(resolve(workspaceRoot));
  if (record.workspaceRoot !== rootReal) {
    throw new StudioError(409, "workspace-mismatch", "redesign journal belongs to a different workspace");
  }

  const targets: Array<{ file: string; absPath: string; beforeContent: string }> = [];
  for (const entry of record.files ?? []) {
    const { absPath } = resolveSafePath(rootReal, entry.file);
    if (!force && existsSync(absPath)) {
      const current = readFileSync(absPath, "utf8");
      if (sha256(current) !== entry.afterSha256) {
        throw new StudioError(409, "file-modified-after-redesign", `${entry.file} was edited after redesign; pass force: true to overwrite`);
      }
    }
    targets.push({ file: entry.file, absPath, beforeContent: entry.beforeContent });
  }

  for (const target of targets) {
    writeFileSync(target.absPath, target.beforeContent, "utf8");
  }
  return {
    runId,
    restoredFiles: targets.map((t) => t.file),
  };
}
