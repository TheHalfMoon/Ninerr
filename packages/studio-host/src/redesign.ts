// Ninerr Code & Existing-Application Redesign Engine:
// 1. Static offline codebase analysis (framework, styling, routes, components, static AST token
//    extraction, and functional contract inventory — never executes target code or configs).
// 2. Whole-File @babel/parser Business-Logic & JSX Functional-Contract Invariance Gate
//    (including preservation of dynamic className/style expressions).
// 3. 3-Tier Bounded Patch Engine (Tier 1 CSS variables, Tier 2 JSX className / cn / clsx / twMerge /
//    cva static strings, Tier 3 opt-in structural) with SHA-256 conflict checks, symlink-safe
//    workspace confinement, trusted journaled backups, and atomic multi-file rollback.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { parse as babelParse } from "@babel/parser";
import { cssValueProblem } from "@ninerr/document-model";
import { StudioError } from "./errors.ts";
import { readTrustedFile, writeTrustedFile } from "./trusted-file.ts";

export const REDESIGN_LIMITS = Object.freeze({
  maxScanFiles: 600,
  maxScanDepth: 12,
  maxScanEntries: 20_000,
  maxFileBytes: 512 * 1024,
  maxPatchFiles: 64,
  maxTokenUpdates: 512,
  maxClassReplacements: 512,
  maxJournalBytes: 8 * 1024 * 1024,
});

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out",
  ".turbo", ".nuxt", ".svelte-kit", "coverage", ".cache",
]);
const CODE_EXTS = new Set([".tsx", ".jsx", ".ts", ".js", ".mjs", ".vue", ".svelte", ".astro"]);
const JSX_EXTS = new Set([".tsx", ".jsx", ".js", ".mjs"]);
const CSS_EXTS = new Set([".css", ".scss"]);
const CLASS_HELPERS = new Set(["cn", "clsx", "cx", "twMerge", "classNames", "cva"]);
const FUNCTIONAL_ATTR_PREFIXES = ["on", "aria-", "data-"];
const FUNCTIONAL_ATTRS = new Set([
  "ref", "key", "id", "name", "type", "role", "href", "to", "action", "method",
  "value", "defaultValue", "checked", "defaultChecked", "disabled", "required",
  "readOnly", "tabIndex", "data-testid", "htmlFor", "for", "target", "rel",
]);
const PRESERVED_ELEMENTS = new Set([
  "form", "button", "a", "input", "select", "textarea", "label",
  "img", "video", "audio", "canvas", "iframe", "dialog", "details", "summary", "slot",
]);
const INTERACTIVE_ELEMENTS = new Set(["form", "button", "a", "input", "select", "textarea", "label"]);
const AST_META_KEYS = new Set([
  "start", "end", "loc", "extra", "leadingComments", "trailingComments",
  "innerComments", "tokens", "comments", "range",
]);
const CSS_CUSTOM_PROP_NAME = /^--[A-Za-z0-9_-]{1,127}$/u;
const CLASS_TOKEN_KEY = /^[^\s\u0000-\u001f]{1,128}$/u;
const CLASS_TOKEN_VALUE = /^[^\u0000-\u001f"'`\\<>]{0,512}$/u;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const compareCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

function lstatOrNull(targetPath: string) {
  try {
    return lstatSync(targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

function insideFolder(parent: string, child: string): boolean {
  const prefix = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child === parent || child.startsWith(prefix);
}

/** Validate and resolve a workspace folder (existing non-root directory, optional non-overlap with projectsRoot). */
export function assertWorkspaceRoot(workspaceRoot: string, projectsRoot?: string): string {
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim() === "" || workspaceRoot.length > 1024 || /[\u0000-\u001f]/u.test(workspaceRoot)) {
    throw new StudioError(400, "invalid-workspace", "workspaceRoot must be a valid directory path");
  }
  const resolved = resolve(workspaceRoot);
  if (lstatOrNull(resolved) === null) {
    throw new StudioError(404, "workspace-not-found", "workspace directory does not exist");
  }
  let rootReal: string;
  try {
    rootReal = realpathSync.native(resolved);
  } catch {
    throw new StudioError(404, "workspace-not-found", "workspace directory does not exist");
  }
  const stat = lstatOrNull(rootReal);
  if (!stat || !stat.isDirectory()) {
    throw new StudioError(400, "invalid-workspace", "workspaceRoot must be an existing directory");
  }
  if (dirname(rootReal) === rootReal) {
    throw new StudioError(400, "workspace-is-root", "choose an application folder, not the filesystem root");
  }
  if (projectsRoot !== undefined) {
    const projectsReal = realpathSync.native(resolve(projectsRoot));
    if (insideFolder(projectsReal, rootReal) || insideFolder(rootReal, projectsReal)) {
      throw new StudioError(400, "workspace-overlaps-projects", "workspace folder must not overlap Ninerr's projects folder");
    }
  }
  return rootReal;
}

/** Resolve a forward-slash relative path inside `workspaceRoot`, rejecting symlinks, traversal, and non-regular files. */
export function resolveSafeWorkspaceFile(
  workspaceRoot: string,
  relPath: string,
  { mustExist = false }: { mustExist?: boolean } = {},
): { rootReal: string; absPath: string; relNorm: string } {
  if (
    typeof relPath !== "string" ||
    relPath.trim() === "" ||
    relPath.length > 512 ||
    relPath.includes("\\") ||
    relPath.includes(":") ||
    relPath.startsWith("/") ||
    /[\u0000-\u001f]/u.test(relPath)
  ) {
    throw new StudioError(400, "invalid-path", `invalid relative path ${JSON.stringify(String(relPath)).slice(0, 80)}`);
  }
  const rootReal = assertWorkspaceRoot(workspaceRoot);
  const segments = relPath.split("/");
  let cursor = rootReal;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (seg === "" || seg === "." || seg === "..") {
      throw new StudioError(400, "invalid-path", `path escapes workspace: ${relPath.slice(0, 80)}`);
    }
    cursor = join(cursor, seg);
    const stat = lstatOrNull(cursor);
    if (stat !== null) {
      if (stat.isSymbolicLink()) {
        throw new StudioError(409, "symlink-refused", `refusing to access symlinked path ${relPath}`);
      }
      if (i < segments.length - 1 && !stat.isDirectory()) {
        throw new StudioError(400, "invalid-path", `parent component is not a directory: ${relPath.slice(0, 80)}`);
      }
      if (i === segments.length - 1 && !stat.isFile()) {
        throw new StudioError(400, "invalid-path", `${relPath.slice(0, 80)} is not a regular file`);
      }
    }
  }
  const leafStat = lstatOrNull(cursor);
  if (leafStat === null) {
    if (mustExist) {
      throw new StudioError(404, "missing-file", `file not found: ${segments.join("/")}`);
    }
    const parentStat = lstatOrNull(dirname(cursor));
    if (parentStat !== null) {
      const parentReal = realpathSync.native(dirname(cursor));
      if (!insideFolder(rootReal, parentReal)) {
        throw new StudioError(400, "invalid-path", `path escapes workspace: ${relPath.slice(0, 80)}`);
      }
    }
  } else {
    const leafReal = realpathSync.native(cursor);
    if (!leafReal.startsWith(rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`)) {
      throw new StudioError(400, "invalid-path", `path escapes workspace: ${relPath.slice(0, 80)}`);
    }
  }
  return { rootReal, absPath: cursor, relNorm: segments.join("/") };
}

/** Read a bounded UTF-8 regular file inside `workspaceRoot` without following symlinks or blocking on FIFOs. */
export function readBoundedWorkspaceFile(
  workspaceRoot: string,
  relPath: string,
  maxBytes = REDESIGN_LIMITS.maxFileBytes,
): { file: string; absPath: string; content: string; sha256: string; mode: number } {
  const { absPath, relNorm } = resolveSafeWorkspaceFile(workspaceRoot, relPath, { mustExist: true });
  const preStat = lstatOrNull(absPath);
  if (!preStat || preStat.isSymbolicLink() || !preStat.isFile()) {
    throw new StudioError(409, "symlink-refused", `refusing to read non-regular or symlinked file ${relNorm}`);
  }
  const openFlags =
    constants.O_RDONLY |
    (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0) |
    (typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0);
  let fd: number;
  try {
    fd = openSync(absPath, openFlags);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ELOOP") throw new StudioError(409, "symlink-refused", `refusing to read symlinked file ${relNorm}`);
    if (code === "ENOENT") throw new StudioError(404, "missing-file", `file not found: ${relNorm}`);
    throw new StudioError(500, "read-failed", `could not open ${relNorm}: ${code ?? "unknown error"}`);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new StudioError(400, "invalid-path", `${relNorm} is not a regular file`);
    if (stat.size > maxBytes) {
      throw new StudioError(413, "file-too-large", `${relNorm} exceeds maximum allowed size of ${maxBytes} bytes`);
    }
    const buf = Buffer.allocUnsafe(maxBytes + 1);
    let total = 0;
    while (total < buf.length) {
      const n = readSync(fd, buf, total, buf.length - total, null);
      if (n === 0) break;
      total += n;
      if (total > maxBytes) {
        throw new StudioError(413, "file-too-large", `${relNorm} exceeds maximum allowed size of ${maxBytes} bytes`);
      }
    }
    let content: string;
    try {
      content = UTF8.decode(buf.subarray(0, total));
    } catch {
      throw new StudioError(409, "source-not-utf8", `${relNorm} is not valid UTF-8`);
    }
    return { file: relNorm, absPath, content, sha256: sha256(content), mode: stat.mode & 0o777 };
  } finally {
    closeSync(fd);
  }
}

/** Verify a journal directory (or its deepest existing parent) is not a symlink, and create it owner-only (0o700). */
function prepareSafeJournalDir(journalDir: string): string {
  if (typeof journalDir !== "string" || journalDir.trim() === "" || journalDir.length > 1024 || /[\u0000-\u001f]/u.test(journalDir)) {
    throw new StudioError(400, "invalid-journal-dir", "journalDir must be a valid directory path");
  }
  const abs = resolve(journalDir);
  let probe = abs;
  while (true) {
    const stat = lstatOrNull(probe);
    if (stat !== null) {
      if (stat.isSymbolicLink()) {
        throw new StudioError(409, "symlink-refused", "refusing to use a symlinked journal directory");
      }
      if (!stat.isDirectory()) {
        throw new StudioError(400, "invalid-journal-dir", "journalDir path contains a non-directory segment");
      }
      break;
    }
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  mkdirSync(abs, { recursive: true, mode: 0o700 });
  const finalStat = lstatOrNull(abs);
  if (!finalStat || finalStat.isSymbolicLink() || !finalStat.isDirectory()) {
    throw new StudioError(409, "symlink-refused", "journalDir is not a trusted directory");
  }
  return realpathSync.native(abs);
}

/** Atomically replace a workspace file without following symlinks, preserving permissions on POSIX. */
function writeWorkspaceFileAtomic(workspaceRoot: string, relPath: string, content: string, preserveMode?: number): void {
  const { absPath } = resolveSafeWorkspaceFile(workspaceRoot, relPath);
  const buf = Buffer.from(content, "utf8");
  const tmpPath = `${absPath}.${randomBytes(8).toString("hex")}.ninerr-tmp`;
  let created = false;
  try {
    const fd = openSync(tmpPath, "wx", 0o600);
    created = true;
    try {
      let offset = 0;
      while (offset < buf.length) {
        const written = writeSync(fd, buf, offset, buf.length - offset);
        if (written <= 0) throw new Error("short write while replacing workspace file");
        offset += written;
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (process.platform !== "win32" && typeof preserveMode === "number") {
      chmodSync(tmpPath, preserveMode & 0o777);
    }
    // Re-verify target is not a symlink right before rename.
    const targetStat = lstatOrNull(absPath);
    if (targetStat !== null && (targetStat.isSymbolicLink() || !targetStat.isFile())) {
      throw new StudioError(409, "symlink-refused", `refusing to overwrite symlink or non-regular file ${relPath}`);
    }
    renameSync(tmpPath, absPath);
    created = false;
  } finally {
    if (created) {
      try {
        rmSync(tmpPath, { force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
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

/**
 * Extract the dynamic expression skeleton inside a styling attribute (`className`, `class`, `style`).
 * Pure static string/numeric/boolean literals and pure static style objects return `null` (so adding,
 * removing, or editing static styling passes invariance). Any dynamic binding, condition, variable,
 * or non-helper call is preserved canonically so dropping or mutating reactive logic is caught.
 */
function dynamicStylingSkeleton(node: any): unknown | null {
  if (!node || typeof node !== "object") return null;
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "JSXEmptyExpression":
      return null;
    case "JSXExpressionContainer":
      return dynamicStylingSkeleton(node.expression);
    case "TemplateLiteral": {
      const exprs = (node.expressions ?? []).map((e: any) => dynamicStylingSkeleton(e)).filter((v: unknown) => v !== null);
      return exprs.length > 0 ? { t: "tpl", exprs } : null;
    }
    case "ArrayExpression": {
      const elems = (node.elements ?? []).map((e: any) => dynamicStylingSkeleton(e)).filter((v: unknown) => v !== null);
      return elems.length > 0 ? { t: "arr", elems } : null;
    }
    case "ObjectExpression": {
      const entries: unknown[] = [];
      for (const prop of node.properties ?? []) {
        if (prop.type === "SpreadElement") {
          entries.push({ t: "spread", arg: canonicalAstJson(prop.argument, { stripJsxStyling: true }) });
        } else if (prop.type === "ObjectProperty") {
          const keyDyn = prop.computed ? canonicalAstJson(prop.key, { stripJsxStyling: true }) : null;
          const valDyn = dynamicStylingSkeleton(prop.value);
          if (keyDyn !== null || valDyn !== null) {
            entries.push({ t: "prop", ...(keyDyn !== null ? { key: keyDyn } : {}), ...(valDyn !== null ? { val: valDyn } : {}) });
          }
        }
      }
      return entries.length > 0 ? { t: "obj", entries } : null;
    }
    case "CallExpression": {
      if (node.callee?.type === "Identifier" && CLASS_HELPERS.has(node.callee.name)) {
        const args = (node.arguments ?? []).map((a: any) => dynamicStylingSkeleton(a)).filter((v: unknown) => v !== null);
        return args.length > 0 ? { t: "helper", args } : null;
      }
      return canonicalAstJson(node, { stripJsxStyling: true });
    }
    case "ConditionalExpression": {
      const test = canonicalAstJson(node.test, { stripJsxStyling: true });
      const cons = dynamicStylingSkeleton(node.consequent);
      const alt = dynamicStylingSkeleton(node.alternate);
      return { t: "cond", test, ...(cons !== null ? { cons } : {}), ...(alt !== null ? { alt } : {}) };
    }
    case "LogicalExpression": {
      const left = canonicalAstJson(node.left, { stripJsxStyling: true });
      const right = dynamicStylingSkeleton(node.right);
      return { t: "logic", op: node.operator, left, ...(right !== null ? { right } : {}) };
    }
    default:
      return canonicalAstJson(node, { stripJsxStyling: true });
  }
}

/** Canonicalize an AST subtree ignoring source positions and pure-static styling JSX attributes. */
function canonicalAstJson(node: any, { stripJsxStyling = false }: { stripJsxStyling?: boolean } = {}): unknown {
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    const items: unknown[] = [];
    for (const entry of node) {
      if (stripJsxStyling && entry?.type === "JSXAttribute") {
        const name = jsxAttrName(entry);
        if (name === "className" || name === "class" || name === "style") {
          const dynamic = dynamicStylingSkeleton(entry.value);
          if (dynamic !== null) {
            items.push({ type: "DynamicStyleAttr", name, dynamic });
          }
          continue;
        }
      }
      if (stripJsxStyling && entry?.type === "JSXText" && String(entry.value ?? "").trim() === "") continue;
      items.push(canonicalAstJson(entry, { stripJsxStyling }));
    }
    return items;
  }
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(node).sort(compareCodeUnits)) {
    if (AST_META_KEYS.has(key)) continue;
    if (stripJsxStyling && node.type === "JSXElement" && (key === "openingElement" || key === "closingElement")) {
      if (key === "closingElement") continue;
      const opening = node.openingElement;
      const tag = jsxElementName(opening?.name);
      out.openingElement = {
        tag: /^[A-Z]/u.test(tag) || PRESERVED_ELEMENTS.has(tag) ? tag : "container",
        attributes: canonicalAstJson(opening?.attributes ?? [], { stripJsxStyling: true }),
      };
      continue;
    }
    out[key] = canonicalAstJson(node[key], { stripJsxStyling });
  }
  return out;
}

function extractFunctionalContract(ast: any, source: string) {
  const directives = (ast.program?.directives ?? []).map((d: any) => String(d.value?.value ?? "")).sort(compareCodeUnits);
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
      childExpressions.push(JSON.stringify(canonicalAstJson(node.expression)));
    }

    for (const key of Object.keys(node)) {
      if (AST_META_KEYS.has(key)) continue;
      const child = node[key];
      if (node.type === "JSXAttribute" && key === "value") {
        const attrName = jsxAttrName(node);
        if ((attrName === "className" || attrName === "class" || attrName === "style") && child?.type === "JSXExpressionContainer") {
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

  hooks.sort(compareCodeUnits);
  handlers.sort(compareCodeUnits);
  functionalAttrs.sort(compareCodeUnits);
  spreads.sort(compareCodeUnits);
  childExpressions.sort(compareCodeUnits);
  return { directives, hooks, handlers, functionalAttrs, spreads, interactiveTags, childExpressions };
}

/**
 * Whole-File @babel/parser Business-Logic & JSX Functional-Contract Invariance Gate.
 * Proves a visual redesign patch kept directive prologues, non-JSX business logic, hooks,
 * event handlers, spreads, form/test/aria/data attributes, interactive/media elements,
 * and dynamic styling conditions 100% intact.
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
    violations.push("functional JSX attributes (ref, key, id, name, type, href, data-*, aria-*, etc.) changed");
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
    violations.push("non-styling business logic, dynamic styling conditions, or component structure changed");
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
 * Character-level CSS custom-property scanner skipping comments and quoted strings.
 * Handles both `;`-terminated and `}`-terminated declarations without executing anything.
 */
export function extractCssCustomProperties(cssText: string): Array<{ name: string; value: string; start: number; end: number }> {
  const found: Array<{ name: string; value: string; start: number; end: number }> = [];
  const len = cssText.length;
  let i = 0;

  while (i < len) {
    const ch = cssText[i];
    // Skip CSS block comments
    if (ch === "/" && cssText[i + 1] === "*") {
      i += 2;
      while (i < len && !(cssText[i] === "*" && cssText[i + 1] === "/")) i += 1;
      i = Math.min(len, i + 2);
      continue;
    }
    // Skip quoted strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      while (i < len) {
        if (cssText[i] === "\\") { i += 2; continue; }
        if (cssText[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    // Potential custom property declaration (`--name: value;` or `--name: value }`)
    if (ch === "-" && cssText[i + 1] === "-") {
      const prev = i > 0 ? cssText[i - 1] : " ";
      // Must start a declaration token (not inside var(--foo) or middle of an ident).
      if (/[A-Za-z0-9_(-]/u.test(prev)) {
        i += 2;
        continue;
      }
      let nameEnd = i + 2;
      while (nameEnd < len && /[A-Za-z0-9_-]/u.test(cssText[nameEnd])) nameEnd += 1;
      const name = cssText.slice(i, nameEnd);
      if (!CSS_CUSTOM_PROP_NAME.test(name)) {
        i = nameEnd;
        continue;
      }
      // Skip whitespace/comments between property name and ':'
      let colon = nameEnd;
      while (colon < len) {
        if (/\s/u.test(cssText[colon])) { colon += 1; continue; }
        if (cssText[colon] === "/" && cssText[colon + 1] === "*") {
          colon += 2;
          while (colon < len && !(cssText[colon] === "*" && cssText[colon + 1] === "/")) colon += 1;
          colon = Math.min(len, colon + 2);
          continue;
        }
        break;
      }
      if (cssText[colon] !== ":") {
        i = nameEnd;
        continue;
      }
      let valStart = colon + 1;
      while (valStart < len && /[ \t]/u.test(cssText[valStart])) valStart += 1;
      let cursor = valStart;
      let parenDepth = 0;
      let quote: string | null = null;
      while (cursor < len) {
        const c = cssText[cursor];
        if (quote !== null) {
          if (c === "\\") { cursor += 2; continue; }
          if (c === quote) quote = null;
          cursor += 1;
          continue;
        }
        if (c === "/" && cssText[cursor + 1] === "*") {
          cursor += 2;
          while (cursor < len && !(cssText[cursor] === "*" && cssText[cursor + 1] === "/")) cursor += 1;
          cursor = Math.min(len, cursor + 2);
          continue;
        }
        if (c === '"' || c === "'") { quote = c; cursor += 1; continue; }
        if (c === "(") { parenDepth += 1; cursor += 1; continue; }
        if (c === ")") { parenDepth = Math.max(0, parenDepth - 1); cursor += 1; continue; }
        if (parenDepth === 0 && (c === ";" || c === "}" || c === "{")) break;
        cursor += 1;
      }
      if (cssText[cursor] === "{") {
        // Not a declaration (e.g., selector-like construct).
        i = cursor + 1;
        continue;
      }
      let valEnd = cursor;
      while (valEnd > valStart && /\s/u.test(cssText[valEnd - 1])) valEnd -= 1;
      const rawVal = cssText.slice(valStart, valEnd);
      if (rawVal.length > 0 && !rawVal.includes("\n")) {
        found.push({ name, value: rawVal, start: valStart, end: valEnd });
      }
      i = cursor + (cssText[cursor] === ";" ? 1 : 0);
      continue;
    }
    i += 1;
  }
  return found;
}

function scanWorkspacePaths(rootReal: string): string[] {
  const files: string[] = [];
  let entriesSeen = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > REDESIGN_LIMITS.maxScanDepth || files.length >= REDESIGN_LIMITS.maxScanFiles || entriesSeen >= REDESIGN_LIMITS.maxScanEntries) {
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => compareCodeUnits(a.name, b.name));
    } catch {
      return;
    }
    for (const entry of entries) {
      entriesSeen += 1;
      if (files.length >= REDESIGN_LIMITS.maxScanFiles || entriesSeen >= REDESIGN_LIMITS.maxScanEntries) break;
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
  return files;
}

/**
 * Analyze an existing local application workspace offline (never executes any target file).
 */
export function analyzeCodebase(workspaceRoot: string) {
  const rootReal = assertWorkspaceRoot(workspaceRoot);

  let pkgJson: any = null;
  try {
    const pkgFile = readBoundedWorkspaceFile(rootReal, "package.json", 256 * 1024);
    pkgJson = JSON.parse(pkgFile.content);
  } catch {
    pkgJson = null;
  }
  const allDeps = { ...(pkgJson?.dependencies ?? {}), ...(pkgJson?.devDependencies ?? {}) };

  const files = scanWorkspacePaths(rootReal);

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
    let text: string;
    try {
      text = readBoundedWorkspaceFile(rootReal, rel).content;
    } catch {
      continue;
    }
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
    let text: string;
    try {
      text = readBoundedWorkspaceFile(rootReal, rel).content;
    } catch {
      continue;
    }
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
      // skip non-JSX or unsupported syntax files cleanly
    }
  }

  return {
    workspaceRoot: rootReal,
    projectName: typeof pkgJson?.name === "string" ? pkgJson.name : null,
    frameworks,
    styling: [...styling].sort(compareCodeUnits),
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
 * Rejects unsafe CSS values (external loads, scripts, comments, block escapes) via `cssValueProblem`.
 */
export function patchCssTokensSource(cssText: string, updates: Record<string, string>) {
  if (updates === null || typeof updates !== "object" || Array.isArray(updates)) {
    throw new StudioError(400, "invalid-updates", "cssTokenUpdates must be an object mapping --token to value");
  }
  const entries = Object.entries(updates);
  if (entries.length > REDESIGN_LIMITS.maxTokenUpdates) {
    throw new StudioError(400, "too-many-updates", `at most ${REDESIGN_LIMITS.maxTokenUpdates} CSS token updates are allowed`);
  }
  const validated = new Map<string, string>();
  for (const [name, rawVal] of entries) {
    if (!CSS_CUSTOM_PROP_NAME.test(name)) {
      throw new StudioError(422, "invalid-css-token", `invalid CSS custom property name ${JSON.stringify(name.slice(0, 60))}`);
    }
    if (typeof rawVal !== "string") {
      throw new StudioError(422, "invalid-css-value", `CSS value for ${name} must be a string`);
    }
    const trimmed = rawVal.trim();
    const problem = cssValueProblem(trimmed);
    if (problem !== null) {
      throw new StudioError(422, "invalid-css-value", `invalid CSS value for ${name}: ${problem}`);
    }
    validated.set(name, trimmed);
  }

  const decls = extractCssCustomProperties(cssText);
  const replacements: Array<{ start: number; end: number; value: string; name: string; before: string }> = [];
  for (const decl of decls) {
    const nextVal = validated.get(decl.name);
    if (nextVal === undefined) continue;
    if (nextVal !== decl.value) {
      replacements.push({ start: decl.start, end: decl.end, value: nextVal, name: decl.name, before: decl.value });
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
  if (classReplacements === null || typeof classReplacements !== "object" || Array.isArray(classReplacements)) {
    throw new StudioError(400, "invalid-replacements", "jsxClassReplacements must be an object");
  }
  const entries = Object.entries(classReplacements);
  if (entries.length > REDESIGN_LIMITS.maxClassReplacements) {
    throw new StudioError(400, "too-many-replacements", `at most ${REDESIGN_LIMITS.maxClassReplacements} class replacements are allowed`);
  }
  const map = new Map<string, string>();
  for (const [from, to] of entries) {
    if (!CLASS_TOKEN_KEY.test(from)) {
      throw new StudioError(422, "invalid-class-token", `invalid source class token ${JSON.stringify(from.slice(0, 60))}`);
    }
    if (typeof to !== "string" || !CLASS_TOKEN_VALUE.test(to)) {
      throw new StudioError(422, "invalid-class-token", `invalid replacement class value for ${from}`);
    }
    map.set(from, to.trim());
  }

  const ast = parseCodeAst(source, filePath);
  const editByStart = new Map<number, { start: number; end: number; before: string; after: string }>();

  const rewriteClassText = (raw: string): string => {
    const tokens = raw.split(/\s+/u).filter(Boolean);
    let changed = false;
    const next: string[] = [];
    for (const tok of tokens) {
      if (map.has(tok)) {
        changed = true;
        const rep = map.get(tok)!;
        if (rep !== "") next.push(rep);
      } else {
        next.push(tok);
      }
    }
    return changed ? next.join(" ").trim() : raw;
  };

  const inspectStringLiteral = (node: any) => {
    if (!node || node.type !== "StringLiteral" || typeof node.start !== "number" || typeof node.end !== "number") return;
    if (editByStart.has(node.start)) return;
    const nextVal = rewriteClassText(node.value);
    if (nextVal !== node.value) {
      const quote = source[node.start] === "'" ? "'" : '"';
      editByStart.set(node.start, {
        start: node.start,
        end: node.end,
        before: node.value,
        after: `${quote}${nextVal}${quote}`,
      });
    }
  };

  const inspectClassExpr = (expr: any, depth = 0) => {
    if (!expr || depth > 12) return;
    if (expr.type === "StringLiteral") {
      inspectStringLiteral(expr);
    } else if (expr.type === "LogicalExpression") {
      inspectClassExpr(expr.right, depth + 1);
    } else if (expr.type === "ConditionalExpression") {
      inspectClassExpr(expr.consequent, depth + 1);
      inspectClassExpr(expr.alternate, depth + 1);
    } else if (expr.type === "ArrayExpression") {
      for (const el of expr.elements ?? []) inspectClassExpr(el, depth + 1);
    } else if (expr.type === "ObjectExpression") {
      for (const prop of expr.properties ?? []) {
        if (prop?.type === "ObjectProperty" && !prop.computed && prop.key?.type === "StringLiteral") {
          inspectStringLiteral(prop.key);
        }
      }
    } else if (expr.type === "CallExpression" && expr.callee?.type === "Identifier" && CLASS_HELPERS.has(expr.callee.name)) {
      for (const arg of expr.arguments ?? []) {
        inspectClassExpr(arg, depth + 1);
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
        else if (node.value?.type === "JSXExpressionContainer") inspectClassExpr(node.value.expression, 0);
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

  const edits = [...editByStart.values()].sort((a, b) => a.start - b.start);
  for (let i = 1; i < edits.length; i += 1) {
    if (edits[i].start < edits[i - 1].end) {
      throw new StudioError(422, "overlapping-edits", `overlapping class edits detected in ${filePath}`);
    }
  }
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
  const rootReal = assertWorkspaceRoot(workspaceRoot);
  if (!Array.isArray(files) || files.length > REDESIGN_LIMITS.maxPatchFiles * 4) {
    throw new StudioError(400, "invalid-files", `files must be a list of at most ${REDESIGN_LIMITS.maxPatchFiles * 4} relative paths`);
  }
  if (!Array.isArray(explicitPatches) || explicitPatches.length > REDESIGN_LIMITS.maxPatchFiles) {
    throw new StudioError(400, "invalid-patches", `explicitPatches must be a list of at most ${REDESIGN_LIMITS.maxPatchFiles} patches`);
  }

  const patches: PlannedFilePatch[] = [];
  const seen = new Set<string>();
  const targetFiles = files.length > 0 ? files : scanWorkspacePaths(rootReal);

  if (Object.keys(cssTokenUpdates).length > 0) {
    for (const rel of targetFiles) {
      if (patches.length >= REDESIGN_LIMITS.maxPatchFiles) break;
      if (typeof rel !== "string" || !CSS_EXTS.has(extname(rel).toLowerCase())) continue;
      let read;
      try {
        read = readBoundedWorkspaceFile(rootReal, rel);
      } catch (error) {
        if (error instanceof StudioError && (error.code === "missing-file" || error.code === "file-too-large" || error.code === "source-not-utf8") && files.length === 0) {
          continue;
        }
        throw error;
      }
      if (seen.has(read.file)) continue;
      const res = patchCssTokensSource(read.content, cssTokenUpdates);
      if (!res.changed) continue;
      seen.add(read.file);
      patches.push({
        file: read.file,
        tier: 1,
        beforeSha256: read.sha256,
        afterSha256: sha256(res.after),
        afterContent: res.after,
        summary: `Updated ${res.changes.length} CSS custom propert${res.changes.length === 1 ? "y" : "ies"}`,
      });
    }
  }

  if (Object.keys(jsxClassReplacements).length > 0) {
    for (const rel of targetFiles) {
      if (patches.length >= REDESIGN_LIMITS.maxPatchFiles) break;
      if (typeof rel !== "string" || !JSX_EXTS.has(extname(rel).toLowerCase())) continue;
      let read;
      try {
        read = readBoundedWorkspaceFile(rootReal, rel);
      } catch (error) {
        if (error instanceof StudioError && (error.code === "missing-file" || error.code === "file-too-large" || error.code === "source-not-utf8") && files.length === 0) {
          continue;
        }
        throw error;
      }
      if (seen.has(read.file)) continue;
      let res;
      try {
        res = patchJsxClassStrings(read.content, read.file, jsxClassReplacements);
      } catch (error) {
        // When scanning an entire workspace automatically, skip non-JSX parse errors; explicit targets fail closed.
        if (files.length === 0 && !(error instanceof StudioError)) continue;
        throw error;
      }
      if (!res.changed) continue;
      seen.add(read.file);
      patches.push({
        file: read.file,
        tier: 2,
        beforeSha256: read.sha256,
        afterSha256: sha256(res.after),
        afterContent: res.after,
        summary: `Updated ${res.edits} JSX styling expression${res.edits === 1 ? "" : "s"} (AST invariance verified)`,
      });
    }
  }

  for (const explicit of explicitPatches) {
    if (patches.length >= REDESIGN_LIMITS.maxPatchFiles) break;
    if (!explicit || typeof explicit !== "object" || typeof explicit.file !== "string" || typeof explicit.afterContent !== "string") {
      throw new StudioError(400, "invalid-patches", "each explicit patch requires file and afterContent strings");
    }
    if (Buffer.byteLength(explicit.afterContent, "utf8") > REDESIGN_LIMITS.maxFileBytes) {
      throw new StudioError(413, "file-too-large", `explicit patch for ${explicit.file} exceeds ${REDESIGN_LIMITS.maxFileBytes} bytes`);
    }
    const read = readBoundedWorkspaceFile(rootReal, explicit.file);
    if (seen.has(read.file)) throw new StudioError(409, "duplicate-file", `duplicate patch target: ${read.file}`);
    if (JSX_EXTS.has(extname(read.file).toLowerCase())) {
      const check = verifyFunctionalInvariance(read.content, explicit.afterContent, read.file);
      if (!check.ok) {
        throw new StudioError(422, "invariance-violated", `${read.file} failed AST invariance gate: ${check.violations.join("; ")}`);
      }
    }
    if (read.content !== explicit.afterContent) {
      seen.add(read.file);
      patches.push({
        file: read.file,
        tier: 3,
        beforeSha256: read.sha256,
        afterSha256: sha256(explicit.afterContent),
        afterContent: explicit.afterContent,
        summary: typeof explicit.summary === "string" && explicit.summary.trim() !== ""
          ? explicit.summary.trim().slice(0, 200)
          : "Structural visual patch (AST invariance verified)",
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
 * Apply a verified redesign plan atomically with SHA-256 pre-write verification, trusted
 * owner-only journal backups in `journalDir`, and automatic rollback if any write fails.
 */
export function applyRedesignPlan(plan: RedesignPlan, { journalDir, expectedPlanToken }: { journalDir: string; expectedPlanToken?: string }) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.patches) || typeof plan.workspaceRoot !== "string") {
    throw new StudioError(400, "invalid-plan", "redesign plan is malformed");
  }
  const rootReal = assertWorkspaceRoot(plan.workspaceRoot);
  const recomputedToken = sha256(JSON.stringify({
    workspaceRoot: rootReal,
    patches: plan.patches.map(({ file, tier, beforeSha256, afterSha256 }) => ({ file, tier, beforeSha256, afterSha256 })),
  }));
  if (recomputedToken !== plan.planToken) {
    throw new StudioError(409, "plan-tampered", "redesign planToken does not match its patches; re-plan before applying");
  }
  if (expectedPlanToken !== undefined && expectedPlanToken !== plan.planToken) {
    throw new StudioError(409, "plan-mismatch", "planToken does not match this redesign plan; re-plan before applying");
  }
  if (plan.patches.length === 0) {
    throw new StudioError(400, "empty-plan", "redesign plan contains no file changes");
  }
  if (plan.patches.length > REDESIGN_LIMITS.maxPatchFiles) {
    throw new StudioError(400, "too-many-patches", `redesign plan exceeds ${REDESIGN_LIMITS.maxPatchFiles} files`);
  }

  const backups: Array<{ file: string; beforeContent: string; beforeSha256: string; afterSha256: string; mode: number }> = [];
  for (const patch of plan.patches) {
    if (typeof patch.afterContent !== "string" || Buffer.byteLength(patch.afterContent, "utf8") > REDESIGN_LIMITS.maxFileBytes) {
      throw new StudioError(413, "file-too-large", `patch content for ${patch.file} exceeds ${REDESIGN_LIMITS.maxFileBytes} bytes`);
    }
    if (sha256(patch.afterContent) !== patch.afterSha256) {
      throw new StudioError(409, "plan-tampered", `patch digest mismatch for ${patch.file}`);
    }
    let read;
    try {
      read = readBoundedWorkspaceFile(rootReal, patch.file);
    } catch (error) {
      if (error instanceof StudioError && error.code === "missing-file") {
        throw new StudioError(409, "file-missing", `${patch.file} disappeared before apply`);
      }
      throw error;
    }
    if (read.sha256 !== patch.beforeSha256) {
      throw new StudioError(409, "file-changed", `${patch.file} changed on disk since planning; re-plan before applying`);
    }
    if (JSX_EXTS.has(extname(read.file).toLowerCase())) {
      const check = verifyFunctionalInvariance(read.content, patch.afterContent, read.file);
      if (!check.ok) {
        throw new StudioError(422, "invariance-violated", `${read.file} failed AST invariance gate: ${check.violations.join("; ")}`);
      }
    }
    backups.push({
      file: read.file,
      beforeContent: read.content,
      beforeSha256: patch.beforeSha256,
      afterSha256: patch.afterSha256,
      mode: read.mode,
    });
  }

  const safeJournalDir = prepareSafeJournalDir(journalDir);
  const runId = `redesign-${randomUUID().slice(0, 12)}`;
  const journalPath = join(safeJournalDir, `${runId}.json`);
  writeTrustedFile(journalPath, JSON.stringify({
    runId,
    planToken: plan.planToken,
    workspaceRoot: rootReal,
    appliedAt: new Date().toISOString(),
    files: backups.map(({ file, beforeSha256, afterSha256, beforeContent, mode }) => ({
      file,
      beforeSha256,
      afterSha256,
      beforeContent,
      mode,
    })),
  }, null, 2));

  const written: typeof backups = [];
  try {
    for (let i = 0; i < plan.patches.length; i += 1) {
      writeWorkspaceFileAtomic(rootReal, backups[i].file, plan.patches[i].afterContent, backups[i].mode);
      written.push(backups[i]);
    }
  } catch (error) {
    // Roll back already-written files atomically on any partial write failure.
    for (let i = written.length - 1; i >= 0; i -= 1) {
      try {
        writeWorkspaceFileAtomic(rootReal, written[i].file, written[i].beforeContent, written[i].mode);
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
 * Inspect a trusted redesign journal without modifying disk (used for confirmation summaries and CLI inspection).
 */
export function readRedesignJournal({ workspaceRoot, journalDir, runId }: { workspaceRoot: string; journalDir: string; runId: string }) {
  if (typeof runId !== "string" || !/^redesign-[a-f0-9-]{6,36}$/u.test(runId)) {
    throw new StudioError(400, "invalid-run-id", "invalid redesign runId");
  }
  const safeJournalDir = prepareSafeJournalDir(journalDir);
  const journalPath = join(safeJournalDir, `${runId}.json`);
  let bytes: Buffer | null;
  try {
    bytes = readTrustedFile(journalPath, REDESIGN_LIMITS.maxJournalBytes);
  } catch (error) {
    throw new StudioError(409, "untrusted-journal", `refusing to read untrusted redesign journal: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (bytes === null) {
    throw new StudioError(404, "missing-journal", `redesign journal ${runId} not found`);
  }
  let record: any;
  try {
    record = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new StudioError(409, "corrupt-journal", `redesign journal ${runId} is not valid JSON`);
  }
  const rootReal = assertWorkspaceRoot(workspaceRoot);
  if (record?.workspaceRoot !== rootReal || !Array.isArray(record?.files)) {
    throw new StudioError(409, "workspace-mismatch", "redesign journal belongs to a different workspace");
  }
  return { rootReal, record };
}

/**
 * Roll back a previously applied redesign run from its trusted journal backup, verifying disk
 * SHA-256 matches the applied output unless `force: true` is explicitly passed.
 */
export function rollbackRedesign({
  workspaceRoot,
  journalDir,
  runId,
  force = false,
}: {
  workspaceRoot: string;
  journalDir: string;
  runId: string;
  force?: boolean;
}) {
  const { rootReal, record } = readRedesignJournal({ workspaceRoot, journalDir, runId });

  const targets: Array<{ file: string; beforeContent: string; mode?: number }> = [];
  for (const entry of record.files) {
    if (!entry || typeof entry.file !== "string" || typeof entry.beforeContent !== "string") {
      throw new StudioError(409, "corrupt-journal", "redesign journal contains a malformed file entry");
    }
    const { absPath, relNorm } = resolveSafeWorkspaceFile(rootReal, entry.file);
    const stat = lstatOrNull(absPath);
    if (!force && stat !== null) {
      const read = readBoundedWorkspaceFile(rootReal, relNorm);
      if (read.sha256 !== entry.afterSha256) {
        throw new StudioError(409, "file-modified-after-redesign", `${relNorm} was edited after redesign; pass force: true to overwrite`);
      }
    }
    targets.push({ file: relNorm, beforeContent: entry.beforeContent, mode: typeof entry.mode === "number" ? entry.mode : undefined });
  }

  for (const target of targets) {
    writeWorkspaceFileAtomic(rootReal, target.file, target.beforeContent, target.mode);
  }
  return {
    runId,
    restoredFiles: targets.map((t) => t.file),
  };
}
