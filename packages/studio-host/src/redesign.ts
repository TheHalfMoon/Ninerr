// Ninerr Code & Existing-Application Redesign Engine:
// 1. Static offline codebase analysis (framework, styling, routes, components, static AST token
//    extraction, and functional contract inventory — never executes target code or configs).
// 2. Whole-File @babel/parser Business-Logic & JSX Functional-Contract Invariance Gate
//    (strict container allowlist, TS generic preservation, fail-closed dynamic styling skeletons).
// 3. 3-Tier Bounded Patch Engine (Tier 1 CSS variables, Tier 2 JSX className / cn / clsx / twMerge
//    static strings, Tier 3 opt-in structural JSX/TS) with SHA-256 conflict checks, symlink-safe
//    workspace confinement, trusted owner-only rollback journals, and atomic multi-file rollback.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
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
import { dirname, extname, join, parse as parsePath, relative, resolve, sep } from "node:path";
import { parse as babelParse } from "@babel/parser";
import { cssValueProblem } from "@ninerr/document-model";
import { StudioError } from "./errors.ts";
import { readTrustedFile, writeTrustedFile } from "./trusted-file.ts";
import { readWithSecurity } from "./windows-security.ts";

export const REDESIGN_LIMITS = Object.freeze({
  maxScanFiles: 600,
  maxScanCssFiles: 120,
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
const CODE_EXTS = new Set([".tsx", ".jsx", ".ts", ".js", ".mjs", ".mts", ".cts", ".cjs", ".vue", ".svelte", ".astro"]);
const JSX_EXTS = new Set([".tsx", ".jsx", ".js", ".mjs"]);
/** Every file extension permitted for Tier 3 explicitPatches — all MUST pass Whole-File AST Invariance. */
const INVARIANCE_GATED_EXTS = new Set([".tsx", ".jsx", ".js", ".mjs", ".ts", ".mts", ".cts", ".cjs"]);
const CSS_EXTS = new Set([".css", ".scss"]);
const CLASS_HELPERS = new Set(["cn", "clsx", "cx", "twMerge", "classNames"]);
const FUNCTIONAL_ATTR_PREFIXES = ["on", "aria-", "data-"];
const FUNCTIONAL_ATTRS = new Set([
  "ref", "key", "id", "name", "type", "role", "href", "to", "action", "method",
  "value", "defaultValue", "checked", "defaultChecked", "disabled", "required",
  "readOnly", "tabIndex", "data-testid", "htmlFor", "for", "target", "rel",
]);
/** Explicit allowlist of interchangeable HTML layout container tags; EVERY other tag stays verbatim. */
const INTERCHANGEABLE_CONTAINERS = new Set(["div", "section", "article", "aside", "header", "footer", "main", "nav"]);
const INTERACTIVE_ELEMENTS = new Set(["form", "button", "a", "input", "select", "textarea", "label"]);
const AST_META_KEYS = new Set([
  "start", "end", "loc", "extra", "leadingComments", "trailingComments",
  "innerComments", "tokens", "comments", "range",
]);
const CSS_CUSTOM_PROP_NAME = /^--[A-Za-z0-9_-]{1,127}$/u;
const CLASS_TOKEN_KEY = /^[^\s\u0000-\u001f]{1,128}$/u;
const CLASS_TOKEN_VALUE = /^[^\u0000-\u001f"'`\\<>]{0,512}$/u;
const UNSAFE_STYLING_PATTERN = /(?:^|[^\w-])(?:url|src|image-set|-webkit-image-set|image|cross-fade|-webkit-cross-fade|element|-moz-element|-webkit-canvas|-moz-image-rect|paint|expression|attr|env)\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding/iu;
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

/**
 * Walk every component of an absolute path and reject any symlink (existing or dangling),
 * permitting only macOS top-level OS symlinks (`/var`, `/tmp`, `/etc` -> `/private/*`).
 */
export function assertNoSymlinkPath(absPath: string, label: string): string {
  const abs = resolve(absPath);
  const parsed = parsePath(abs);
  const tail = abs.slice(parsed.root.length).split(sep).filter(Boolean);
  let cursor = parsed.root;
  for (const part of tail) {
    cursor = join(cursor, part);
    const stat = lstatOrNull(cursor);
    if (stat !== null && stat.isSymbolicLink()) {
      if (process.platform === "darwin" && (cursor === "/var" || cursor === "/tmp" || cursor === "/etc")) {
        const target = realpathSync.native(cursor);
        if (target === `/private${cursor}`) {
          cursor = target;
          continue;
        }
      }
      throw new StudioError(409, "symlink-refused", `refusing to use symlinked ${label}`);
    }
  }
  return cursor;
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
    const projectsResolved = resolve(projectsRoot);
    let projectsCmp = projectsResolved;
    try {
      projectsCmp = realpathSync.native(projectsResolved);
    } catch {
      // Projects folder may not exist yet on first CLI invocation; compare resolved paths.
    }
    const caseInsensitive = process.platform === "win32" || process.platform === "darwin";
    const cmpA = caseInsensitive ? projectsCmp.toLowerCase() : projectsCmp;
    const cmpB = caseInsensitive ? rootReal.toLowerCase() : rootReal;
    if (insideFolder(cmpA, cmpB) || insideFolder(cmpB, cmpA)) {
      throw new StudioError(400, "workspace-overlaps-projects", "workspace folder must not overlap Ninerr's projects folder");
    }
  }
  return rootReal;
}

/**
 * Resolve a forward-slash relative path inside `workspaceRoot`, rejecting symlinks, traversal,
 * forbidden directories (`.git`, `node_modules`, build caches), and non-regular files.
 * Canonicalizes case on Windows/macOS via `realpathSync.native` when the file exists.
 */
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
    const lower = seg.toLowerCase();
    if (i < segments.length - 1 && SKIP_DIRS.has(lower)) {
      throw new StudioError(400, "forbidden-path", `refusing to access restricted directory ${seg} in ${relPath.slice(0, 80)}`);
    }
    if (i === segments.length - 1 && (lower === ".git" || lower === "node_modules")) {
      throw new StudioError(400, "forbidden-path", `refusing to access restricted path ${relPath.slice(0, 80)}`);
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
    return { rootReal, absPath: cursor, relNorm: segments.join("/") };
  }
  const leafReal = realpathSync.native(cursor);
  if (!leafReal.startsWith(rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`)) {
    throw new StudioError(400, "invalid-path", `path escapes workspace: ${relPath.slice(0, 80)}`);
  }
  const relNorm = relative(rootReal, leafReal).split(sep).join("/");
  const normParts = relNorm.split("/");
  for (let i = 0; i < normParts.length; i += 1) {
    const lower = normParts[i].toLowerCase();
    if ((i < normParts.length - 1 && SKIP_DIRS.has(lower)) || (i === normParts.length - 1 && (lower === ".git" || lower === "node_modules"))) {
      throw new StudioError(400, "forbidden-path", `refusing to access restricted path ${relNorm.slice(0, 80)}`);
    }
  }
  return { rootReal, absPath: leafReal, relNorm };
}

/** Read a bounded UTF-8 regular file inside `workspaceRoot` without following symlinks or blocking on FIFOs. */
export function readBoundedWorkspaceFile(
  workspaceRoot: string,
  relPath: string,
  maxBytes = REDESIGN_LIMITS.maxFileBytes,
): { file: string; absPath: string; content: string; sha256: string; mode: number } {
  const { absPath, relNorm } = resolveSafeWorkspaceFile(workspaceRoot, relPath, { mustExist: true });

  if (process.platform === "win32") {
    let winRead;
    try {
      winRead = readWithSecurity(absPath, maxBytes);
    } catch (error) {
      throw new StudioError(500, "read-failed", `could not open ${relNorm}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (winRead === null) throw new StudioError(404, "missing-file", `file not found: ${relNorm}`);
    if (!winRead.regularFile) {
      throw new StudioError(409, "symlink-refused", `refusing to read non-regular or symlinked file ${relNorm}`);
    }
    if (winRead.size > maxBytes || winRead.bytes === null) {
      throw new StudioError(413, "file-too-large", `${relNorm} exceeds maximum allowed size of ${maxBytes} bytes`);
    }
    let content: string;
    try {
      content = UTF8.decode(winRead.bytes);
    } catch {
      throw new StudioError(409, "source-not-utf8", `${relNorm} is not valid UTF-8`);
    }
    return { file: relNorm, absPath, content, sha256: sha256(content), mode: 0o644 };
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
    const allocBytes = Math.min(maxBytes + 1, Math.max(4096, stat.size + 1));
    let buf = Buffer.allocUnsafe(allocBytes);
    let total = 0;
    while (true) {
      if (total >= buf.length) {
        if (total > maxBytes) {
          throw new StudioError(413, "file-too-large", `${relNorm} exceeds maximum allowed size of ${maxBytes} bytes`);
        }
        const grown = Buffer.allocUnsafe(Math.min(maxBytes + 1, buf.length * 2));
        buf.copy(grown, 0, 0, total);
        buf = grown;
      }
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

/** Read-only resolution of an existing journal directory (never creates directories on disk). */
function resolveExistingJournalDir(journalDir: string): string | null {
  if (typeof journalDir !== "string" || journalDir.trim() === "" || journalDir.length > 1024 || /[\u0000-\u001f]/u.test(journalDir)) {
    throw new StudioError(400, "invalid-journal-dir", "journalDir must be a valid directory path");
  }
  const checked = assertNoSymlinkPath(journalDir, "journal directory");
  const stat = lstatOrNull(checked);
  if (stat === null) return null;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new StudioError(409, "symlink-refused", "journalDir is not a trusted directory");
  }
  return realpathSync.native(checked);
}

/** Verify a journal directory has no user symlinks anywhere in its path and create it owner-only (0o700). */
function prepareSafeJournalDir(journalDir: string): string {
  if (typeof journalDir !== "string" || journalDir.trim() === "" || journalDir.length > 1024 || /[\u0000-\u001f]/u.test(journalDir)) {
    throw new StudioError(400, "invalid-journal-dir", "journalDir must be a valid directory path");
  }
  const checked = assertNoSymlinkPath(journalDir, "journal directory");
  const existing = lstatOrNull(checked);
  if (existing !== null && !existing.isDirectory()) {
    throw new StudioError(400, "invalid-journal-dir", "journalDir path is not a directory");
  }
  mkdirSync(checked, { recursive: true, mode: 0o700 });
  const finalStat = lstatOrNull(checked);
  if (!finalStat || finalStat.isSymbolicLink() || !finalStat.isDirectory()) {
    throw new StudioError(409, "symlink-refused", "journalDir is not a trusted directory");
  }
  return realpathSync.native(checked);
}

/** Atomically replace a workspace file without following symlinks, preserving permissions via `fchmodSync`. */
function writeWorkspaceFileAtomic(
  workspaceRoot: string,
  relPath: string,
  content: string,
  { preserveMode, expectedBeforeSha256 }: { preserveMode?: number; expectedBeforeSha256?: string } = {},
): void {
  const { absPath } = resolveSafeWorkspaceFile(workspaceRoot, relPath);
  const parentDir = dirname(absPath);
  const parentStat = lstatOrNull(parentDir);
  if (!parentStat || parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new StudioError(409, "missing-parent", `parent directory for ${relPath} is missing or untrusted`);
  }
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
      if (process.platform !== "win32" && typeof preserveMode === "number") {
        fchmodSync(fd, preserveMode & 0o777);
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // Re-verify full workspace path chain & optional disk SHA-256 immediately before rename.
    const verified = resolveSafeWorkspaceFile(workspaceRoot, relPath);
    if (expectedBeforeSha256 !== undefined) {
      const current = readBoundedWorkspaceFile(workspaceRoot, relPath);
      if (current.sha256 !== expectedBeforeSha256) {
        throw new StudioError(409, "file-changed", `${relPath} changed on disk during apply; re-plan before applying`);
      }
    }
    renameSync(tmpPath, verified.absPath);
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
  if (ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts") plugins.push("typescript");
  if (ext === ".tsx" || ext === ".jsx" || ext === ".js" || ext === ".mjs" || ext === ".cjs") plugins.push("jsx");
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

/** Normalize ONLY explicitly interchangeable layout container identifiers; keep EVERY other tag verbatim. */
function canonicalJsxTag(nameNode: any): string {
  if (nameNode?.type === "JSXIdentifier" && INTERCHANGEABLE_CONTAINERS.has(nameNode.name)) {
    return "container";
  }
  return jsxElementName(nameNode);
}

/**
 * Extract the dynamic expression skeleton inside a styling attribute (`className`, `class`, `style`).
 * Pure static literals and pure static style objects return `null` (so adding, removing, or editing
 * pure static styling passes invariance). Any dynamic binding, condition, helper callee, variable,
 * computed key, ObjectMethod, or unknown AST node fails closed into a canonicalized representation.
 */
function dynamicStylingSkeleton(node: any, isStyleAttr: boolean): unknown | null {
  if (!node || typeof node !== "object") return null;
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "JSXEmptyExpression":
      return null;
    case "UnaryExpression":
      if ((node.operator === "-" || node.operator === "+") && node.argument?.type === "NumericLiteral") {
        return null;
      }
      return canonicalAstJson(node, { stripJsxStyling: true });
    case "ParenthesizedExpression":
      return dynamicStylingSkeleton(node.expression, isStyleAttr);
    case "TSAsExpression":
    case "TSSatisfiesExpression": {
      const inner = dynamicStylingSkeleton(node.expression, isStyleAttr);
      return inner === null ? null : canonicalAstJson(node, { stripJsxStyling: true });
    }
    case "JSXExpressionContainer":
      return dynamicStylingSkeleton(node.expression, isStyleAttr);
    case "TemplateLiteral": {
      const exprs = (node.expressions ?? []).map((e: any) => dynamicStylingSkeleton(e, isStyleAttr)).filter((v: unknown) => v !== null);
      return exprs.length > 0 ? { t: "tpl", exprs } : null;
    }
    case "ArrayExpression": {
      const elems = (node.elements ?? [])
        .map((e: any) => (e === null ? null : dynamicStylingSkeleton(e, isStyleAttr)))
        .filter((v: unknown) => v !== null);
      return elems.length > 0 ? { t: "arr", elems } : null;
    }
    case "ObjectExpression": {
      const entries: unknown[] = [];
      for (const prop of node.properties ?? []) {
        if (prop?.type === "SpreadElement") {
          entries.push({ t: "spread", arg: canonicalAstJson(prop.argument, { stripJsxStyling: true }) });
        } else if (prop?.type === "ObjectProperty") {
          const keyDyn = prop.computed ? canonicalAstJson(prop.key, { stripJsxStyling: true }) : null;
          const valDyn = dynamicStylingSkeleton(prop.value, isStyleAttr);
          if (keyDyn !== null || valDyn !== null) {
            const propKey = prop.computed
              ? keyDyn
              : (isStyleAttr ? (prop.key?.name ?? prop.key?.value ?? canonicalAstJson(prop.key, { stripJsxStyling: true })) : null);
            entries.push({ t: "prop", ...(propKey !== null ? { key: propKey } : {}), ...(valDyn !== null ? { val: valDyn } : {}) });
          }
        } else {
          // Fail closed for ObjectMethod (getters/setters/methods) or any unexpected AST node!
          entries.push({ t: "raw", node: canonicalAstJson(prop, { stripJsxStyling: true }) });
        }
      }
      return entries.length > 0 ? { t: "obj", entries } : null;
    }
    case "CallExpression": {
      if (!isStyleAttr && node.callee?.type === "Identifier" && CLASS_HELPERS.has(node.callee.name)) {
        const args = (node.arguments ?? [])
          .map((a: any) => (a?.type === "SpreadElement" ? { t: "spread", arg: canonicalAstJson(a.argument, { stripJsxStyling: true }) } : dynamicStylingSkeleton(a, false)))
          .filter((v: unknown) => v !== null);
        // Preserve helper callee identity so unimported helpers cannot be introduced or swapped.
        return { t: "helper", callee: node.callee.name, args };
      }
      return canonicalAstJson(node, { stripJsxStyling: true });
    }
    case "ConditionalExpression": {
      const test = canonicalAstJson(node.test, { stripJsxStyling: true });
      const cons = dynamicStylingSkeleton(node.consequent, isStyleAttr);
      const alt = dynamicStylingSkeleton(node.alternate, isStyleAttr);
      return { t: "cond", test, ...(cons !== null ? { cons } : {}), ...(alt !== null ? { alt } : {}) };
    }
    case "LogicalExpression": {
      const left = canonicalAstJson(node.left, { stripJsxStyling: true });
      const right = dynamicStylingSkeleton(node.right, isStyleAttr);
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
          const dynamic = dynamicStylingSkeleton(entry.value, name === "style");
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
      const openRecord: Record<string, unknown> = {
        tag: canonicalJsxTag(opening?.name),
        attributes: canonicalAstJson(opening?.attributes ?? [], { stripJsxStyling: true }),
      };
      if (opening?.typeParameters) {
        openRecord.typeParameters = canonicalAstJson(opening.typeParameters, { stripJsxStyling: true });
      }
      if (opening?.typeArguments) {
        openRecord.typeArguments = canonicalAstJson(opening.typeArguments, { stripJsxStyling: true });
      }
      out.openingElement = openRecord;
      continue;
    }
    out[key] = canonicalAstJson(node[key], { stripJsxStyling });
  }
  return out;
}

function hookNameOfCall(node: any): string | null {
  if (node?.type !== "CallExpression") return null;
  if (node.callee?.type === "Identifier" && /^use[A-Z]/u.test(node.callee.name)) {
    return node.callee.name;
  }
  if (
    node.callee?.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property?.type === "Identifier" &&
    /^use[A-Z]/u.test(node.callee.property.name)
  ) {
    return node.callee.property.name;
  }
  return null;
}

function extractFunctionalContract(ast: any, source: string) {
  const directives = (ast.program?.directives ?? []).map((d: any) => String(d.value?.value ?? "")).sort(compareCodeUnits);
  const hooks: string[] = [];
  const handlers: string[] = [];
  const functionalAttrs: string[] = [];
  const spreads: string[] = [];
  const interactiveTags: Record<string, number> = Object.create(null);

  const stack: any[] = [ast.program];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    const hookName = hookNameOfCall(node);
    if (hookName !== null) hooks.push(hookName);

    if (node.type === "JSXOpeningElement") {
      const rawTag = jsxElementName(node.name);
      const normTag = canonicalJsxTag(node.name);
      if (INTERACTIVE_ELEMENTS.has(rawTag)) {
        interactiveTags[rawTag] = (interactiveTags[rawTag] ?? 0) + 1;
      }
      for (const attr of node.attributes ?? []) {
        if (attr.type === "JSXSpreadAttribute") {
          spreads.push(source.slice(attr.start, attr.end).replace(/\s+/gu, " ").trim());
        } else if (attr.type === "JSXAttribute") {
          const name = jsxAttrName(attr);
          if (isFunctionalJsxAttr(name)) {
            const valSlice = attr.value ? source.slice(attr.value.start, attr.value.end).replace(/\s+/gu, " ").trim() : "true";
            const entry = `${normTag}:${name}=${valSlice}`;
            if (/^on[A-Z]/u.test(name)) handlers.push(entry);
            else functionalAttrs.push(entry);
          }
        }
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

  hooks.sort(compareCodeUnits);
  handlers.sort(compareCodeUnits);
  functionalAttrs.sort(compareCodeUnits);
  spreads.sort(compareCodeUnits);
  return { directives, hooks, handlers, functionalAttrs, spreads, interactiveTags };
}

/**
 * Collect unsafe styling string/template-quasi occurrences inside `className`, `class`, and `style`
 * attributes so `verifyFunctionalInvariance` blocks newly introduced external CSS loads (`url(...)`,
 * `image-set(...)`, `expression(...)`, `javascript:`, etc.) and invalid static style values.
 */
function collectUnsafeStylingOccurrences(ast: any): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);

  const staticFragment = (expr: any, depth = 0): string | null => {
    if (!expr || typeof expr !== "object") return null;
    if (depth > 8) return "__DEPTH_EXCEEDED__";
    if (expr.type === "StringLiteral") return expr.value;
    if (expr.type === "NumericLiteral") return String(expr.value);
    if (expr.type === "BooleanLiteral") return String(expr.value);
    if (expr.type === "NullLiteral") return "null";
    if (expr.type === "UnaryExpression" && (expr.operator === "-" || expr.operator === "+") && expr.argument?.type === "NumericLiteral") {
      return `${expr.operator}${expr.argument.value}`;
    }
    if (expr.type === "ParenthesizedExpression" || expr.type === "TSAsExpression" || expr.type === "TSSatisfiesExpression") {
      return staticFragment(expr.expression, depth + 1);
    }
    if (expr.type === "TemplateLiteral") {
      let joined = "";
      const quasis = expr.quasis ?? [];
      const exprs = expr.expressions ?? [];
      for (let i = 0; i < quasis.length; i += 1) {
        joined += String(quasis[i]?.value?.cooked ?? quasis[i]?.value?.raw ?? "");
        if (i < exprs.length) {
          const part = staticFragment(exprs[i], depth + 1);
          if (part === null) return null;
          joined += part;
        }
      }
      return joined;
    }
    return null;
  };

  const inspectStylingValue = (node: any, isStyleAttr: boolean) => {
    const stack: any[] = [node];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (cur.type === "StringLiteral" && typeof cur.value === "string") {
        if (UNSAFE_STYLING_PATTERN.test(cur.value)) {
          bump(`unsafe:${cur.value}`);
        } else if (isStyleAttr && cssValueProblem(cur.value) !== null) {
          bump(`invalid-style:${cur.value}`);
        }
        continue;
      }
    if (cur.type === "TemplateLiteral") {
      let folded = "";
      let allStatic = true;
      let depthExceeded = false;
      const quasis = cur.quasis ?? [];
      const exprs = cur.expressions ?? [];
      for (let i = 0; i < quasis.length; i += 1) {
        folded += String(quasis[i]?.value?.cooked ?? quasis[i]?.value?.raw ?? "");
        if (i < exprs.length) {
          const part = staticFragment(exprs[i], 0);
          if (part === "__DEPTH_EXCEEDED__") {
            depthExceeded = true;
          } else if (part !== null) {
            folded += part;
          } else {
            allStatic = false;
            folded += " __dyn__ ";
            stack.push(exprs[i]);
          }
        }
      }
      if (depthExceeded || UNSAFE_STYLING_PATTERN.test(folded)) {
        bump(`unsafe-tpl:${depthExceeded ? "depth-exceeded" : folded}`);
      } else if (isStyleAttr && allStatic && cssValueProblem(folded) !== null) {
        bump(`invalid-style:${folded}`);
      }
      continue;
    }
      if (cur.type === "TemplateElement") {
        const text = String(cur.value?.cooked ?? cur.value?.raw ?? "");
        if (UNSAFE_STYLING_PATTERN.test(text)) {
          bump(`unsafe-tpl:${text}`);
        }
        continue;
      }
      for (const key of Object.keys(cur)) {
        if (AST_META_KEYS.has(key)) continue;
        // Skip non-computed object property keys inside `style={{ backgroundImage: ... }}`
        if (isStyleAttr && cur.type === "ObjectProperty" && key === "key" && !cur.computed) continue;
        const child = cur[key];
        if (Array.isArray(child)) {
          for (const item of child) if (item && typeof item === "object" && typeof item.type === "string") stack.push(item);
        } else if (child && typeof child === "object" && typeof child.type === "string") {
          stack.push(child);
        }
      }
    }
  };

  const walkStack: any[] = [ast.program];
  while (walkStack.length > 0) {
    const node = walkStack.pop();
    if (!node || typeof node !== "object") continue;
    if (node.type === "JSXAttribute") {
      const name = jsxAttrName(node);
      if (name === "className" || name === "class" || name === "style") {
        if (node.value) inspectStylingValue(node.value, name === "style");
        continue;
      }
    }
    for (const key of Object.keys(node)) {
      if (AST_META_KEYS.has(key)) continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) if (item && typeof item === "object" && typeof item.type === "string") walkStack.push(item);
      } else if (child && typeof child === "object" && typeof child.type === "string") {
        walkStack.push(child);
      }
    }
  }
  return counts;
}

/**
 * Whole-File @babel/parser Business-Logic & JSX Functional-Contract Invariance Gate.
 * Proves a visual redesign patch kept directive prologues, non-JSX business logic, hooks,
 * event handlers, spreads, form/test/aria/data attributes, non-container tags, TS generics,
 * dynamic styling expressions, and zero-egress styling safety 100% intact.
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

  const beforeUnsafe = collectUnsafeStylingOccurrences(beforeAst);
  const afterUnsafe = collectUnsafeStylingOccurrences(afterAst);
  for (const [key, afterCount] of afterUnsafe.entries()) {
    const beforeCount = beforeUnsafe.get(key) ?? 0;
    if (afterCount > beforeCount) {
      violations.push("styling patch introduced unsafe CSS external resource loading, script scheme, or invalid CSS value");
      break;
    }
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
 * Declaration-context-aware CSS/SCSS custom-property scanner skipping comments (`/* ... *\/` and
 * SCSS `// ...`), quoted strings, and `url(...)` arguments. Recognizes `--name: value` ONLY at
 * declaration start inside `{ ... }` blocks.
 */
export function extractCssCustomProperties(
  cssText: string,
  { scss = false }: { scss?: boolean } = {},
): Array<{ name: string; value: string; start: number; end: number }> {
  const found: Array<{ name: string; value: string; start: number; end: number }> = [];
  const len = cssText.length;
  let i = 0;
  let blockDepth = 0;
  let expectDeclStart = false;

  while (i < len) {
    const ch = cssText[i];
    // Skip CSS block comments
    if (ch === "/" && cssText[i + 1] === "*") {
      i += 2;
      while (i < len && !(cssText[i] === "*" && cssText[i + 1] === "/")) i += 1;
      i = Math.min(len, i + 2);
      continue;
    }
    // Skip SCSS single-line comments
    if (scss && ch === "/" && cssText[i + 1] === "/") {
      i += 2;
      while (i < len && cssText[i] !== "\n") i += 1;
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
      expectDeclStart = false;
      continue;
    }
    // Skip url(...) arguments (including unquoted URLs containing -- or ;)
    if (
      (ch === "u" || ch === "U") &&
      /^url\s*\(/iu.test(cssText.slice(i, i + 16)) &&
      (i === 0 || !/[A-Za-z0-9_-]/u.test(cssText[i - 1]))
    ) {
      let cursor = cssText.indexOf("(", i) + 1;
      let quote: string | null = null;
      while (cursor < len) {
        const c = cssText[cursor];
        if (quote !== null) {
          if (c === "\\") { cursor += 2; continue; }
          if (c === quote) quote = null;
          cursor += 1;
          continue;
        }
        if (c === '"' || c === "'") { quote = c; cursor += 1; continue; }
        if (c === ")") { cursor += 1; break; }
        cursor += 1;
      }
      i = cursor;
      expectDeclStart = false;
      continue;
    }
    if (/\s/u.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "{") {
      blockDepth += 1;
      expectDeclStart = true;
      i += 1;
      continue;
    }
    if (ch === "}") {
      blockDepth = Math.max(0, blockDepth - 1);
      expectDeclStart = blockDepth > 0;
      i += 1;
      continue;
    }
    if (ch === ";") {
      expectDeclStart = blockDepth > 0;
      i += 1;
      continue;
    }

    // Match custom property declaration ONLY at declaration start inside a block.
    if (blockDepth > 0 && expectDeclStart && ch === "-" && cssText[i + 1] === "-") {
      let nameEnd = i + 2;
      while (nameEnd < len && /[A-Za-z0-9_-]/u.test(cssText[nameEnd])) nameEnd += 1;
      const name = cssText.slice(i, nameEnd);
      if (CSS_CUSTOM_PROP_NAME.test(name)) {
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
        if (cssText[colon] === ":") {
          let valStart = colon + 1;
          while (valStart < len && /[ \t]/u.test(cssText[valStart])) valStart += 1;
          let cursor = valStart;
          let parenDepth = 0;
          let bracketDepth = 0;
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
            if (scss && c === "/" && cssText[cursor + 1] === "/") {
              break;
            }
            if (c === '"' || c === "'") { quote = c; cursor += 1; continue; }
            if (c === "(") { parenDepth += 1; cursor += 1; continue; }
            if (c === ")") { parenDepth = Math.max(0, parenDepth - 1); cursor += 1; continue; }
            if (c === "[") { bracketDepth += 1; cursor += 1; continue; }
            if (c === "]") { bracketDepth = Math.max(0, bracketDepth - 1); cursor += 1; continue; }
            if (parenDepth === 0 && bracketDepth === 0 && (c === ";" || c === "}" || c === "{")) break;
            cursor += 1;
          }
          if (cssText[cursor] !== "{") {
            let valEnd = cursor;
            while (valEnd > valStart && /\s/u.test(cssText[valEnd - 1])) valEnd -= 1;
            const rawVal = cssText.slice(valStart, valEnd);
            if (rawVal.length > 0 && !rawVal.includes("\n")) {
              found.push({ name, value: rawVal, start: valStart, end: valEnd });
            }
            if (cssText[cursor] === ";") {
              expectDeclStart = true;
              i = cursor + 1;
            } else {
              expectDeclStart = false;
              i = cursor;
            }
            continue;
          }
        }
      }
    }

    expectDeclStart = false;
    i += 1;
  }
  return found;
}

function scanWorkspacePaths(rootReal: string): string[] {
  // Breadth-first scan with a dedicated stylesheet reservation so large >600-file codebases
  // never starve top-level CSS token stylesheets (e.g. `styles/globals.css`, `src/index.css`).
  const cssFound: string[] = [];
  const otherFound: string[] = [];
  const maxOther = Math.max(1, REDESIGN_LIMITS.maxScanFiles - REDESIGN_LIMITS.maxScanCssFiles);
  let entriesSeen = 0;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootReal, depth: 0 }];

  while (queue.length > 0 && entriesSeen < REDESIGN_LIMITS.maxScanEntries) {
    if (cssFound.length >= REDESIGN_LIMITS.maxScanCssFiles && otherFound.length >= maxOther) break;
    const { dir, depth } = queue.shift()!;
    if (depth > REDESIGN_LIMITS.maxScanDepth) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => compareCodeUnits(a.name, b.name));
    } catch {
      continue;
    }
    for (const entry of entries) {
      entriesSeen += 1;
      if (entriesSeen > REDESIGN_LIMITS.maxScanEntries) break;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name.toLowerCase()) && depth + 1 <= REDESIGN_LIMITS.maxScanDepth) {
          queue.push({ dir: join(dir, entry.name), depth: depth + 1 });
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        const rel = relative(rootReal, join(dir, entry.name)).replace(/\\/gu, "/");
        if (CSS_EXTS.has(ext)) {
          if (cssFound.length < REDESIGN_LIMITS.maxScanCssFiles) cssFound.push(rel);
        } else if (CODE_EXTS.has(ext) || ext === ".html") {
          if (otherFound.length < maxOther) otherFound.push(rel);
        }
      }
    }
  }
  return [...cssFound, ...otherFound].slice(0, REDESIGN_LIMITS.maxScanFiles);
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
  if (typeof allDeps.tailwindcss === "string") {
    const isV4 = /(?:^|[\^~>=<\s])4(?:\.|$)/u.test(allDeps.tailwindcss);
    styling.add(isV4 ? "tailwind-v4" : "tailwind-v3");
  }
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
    const props = extractCssCustomProperties(text, { scss: rel.toLowerCase().endsWith(".scss") });
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
 * Verify that a Tier 1 CSS/SCSS patch ONLY modifies custom-property values in place (exact same
 * declaration count, names, and surrounding bytes) and every changed value satisfies `cssValueProblem`.
 */
export function verifyCssTokenPatchInvariance(beforeCss: string, afterCss: string, { scss = false }: { scss?: boolean } = {}) {
  const beforeDecls = extractCssCustomProperties(beforeCss, { scss });
  const afterDecls = extractCssCustomProperties(afterCss, { scss });
  if (beforeDecls.length !== afterDecls.length) {
    return { ok: false, reason: "CSS custom property count changed; Tier 1 patches may only update existing token values in place" };
  }
  let reconstructed = beforeCss;
  for (let i = beforeDecls.length - 1; i >= 0; i -= 1) {
    const b = beforeDecls[i];
    const a = afterDecls[i];
    if (b.name !== a.name) {
      return { ok: false, reason: `CSS custom property ${b.name} was renamed or reordered` };
    }
    if (b.value !== a.value) {
      const problem = cssValueProblem(a.value);
      if (problem !== null) {
        return { ok: false, reason: `invalid CSS value for ${a.name}: ${problem}` };
      }
      reconstructed = reconstructed.slice(0, b.start) + a.value + reconstructed.slice(b.end);
    }
  }
  if (reconstructed !== afterCss) {
    return { ok: false, reason: "Tier 1 CSS patch modified bytes outside CSS custom property values" };
  }
  return { ok: true as const };
}

/**
 * Tier 1: Patch CSS custom-property values in place without ever renaming or deleting variables.
 * Rejects unsafe CSS values (external loads, scripts, comments, unbalanced brackets/blocks) via `cssValueProblem`.
 */
export function patchCssTokensSource(cssText: string, updates: Record<string, string>, { scss = false }: { scss?: boolean } = {}) {
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

  const decls = extractCssCustomProperties(cssText, { scss });
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

function formatStringLiteral(value: string, quote: "'" | '"', isJsxAttr: boolean): string {
  if (isJsxAttr) {
    const escaped = quote === '"'
      ? value.replaceAll('"', "&quot;")
      : value.replaceAll("'", "&apos;");
    return `${quote}${escaped}${quote}`;
  }
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll(quote, `\\${quote}`)
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return `${quote}${escaped}${quote}`;
}

/**
 * Tier 2: Range-anchored JSX className / cn / clsx / twMerge static string patching
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
    if (typeof to !== "string" || !CLASS_TOKEN_VALUE.test(to) || UNSAFE_STYLING_PATTERN.test(to)) {
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

  const inspectStringLiteral = (node: any, isJsxAttr: boolean) => {
    if (!node || node.type !== "StringLiteral" || typeof node.start !== "number" || typeof node.end !== "number") return;
    if (editByStart.has(node.start)) return;
    const nextVal = rewriteClassText(node.value);
    if (nextVal !== node.value) {
      const quote: "'" | '"' = source[node.start] === "'" ? "'" : '"';
      editByStart.set(node.start, {
        start: node.start,
        end: node.end,
        before: node.value,
        after: formatStringLiteral(nextVal, quote, isJsxAttr),
      });
    }
  };

  const inspectClassExpr = (expr: any, depth = 0) => {
    if (!expr || depth > 12) return;
    if (expr.type === "StringLiteral") {
      inspectStringLiteral(expr, false);
    } else if (expr.type === "LogicalExpression") {
      inspectClassExpr(expr.right, depth + 1);
    } else if (expr.type === "ConditionalExpression") {
      inspectClassExpr(expr.consequent, depth + 1);
      inspectClassExpr(expr.alternate, depth + 1);
    } else if (expr.type === "ArrayExpression") {
      for (const el of expr.elements ?? []) inspectClassExpr(el, depth + 1);
    } else if (expr.type === "ObjectExpression") {
      // Detect duplicate post-replacement keys so we never clobber a conditional branch or break TS.
      const resultingKeys = new Set<string>();
      for (const prop of expr.properties ?? []) {
        if (prop?.type !== "ObjectProperty" || prop.computed) continue;
        if (prop.key?.type === "StringLiteral") {
          const nextKey = rewriteClassText(prop.key.value);
          if (resultingKeys.has(nextKey)) {
            throw new StudioError(422, "duplicate-class-key", `class replacement in ${filePath} produces duplicate object key ${JSON.stringify(nextKey)}`);
          }
          resultingKeys.add(nextKey);
          inspectStringLiteral(prop.key, false);
        } else if (prop.key?.type === "Identifier") {
          if (resultingKeys.has(prop.key.name)) {
            throw new StudioError(422, "duplicate-class-key", `class replacement in ${filePath} collides with existing object key ${JSON.stringify(prop.key.name)}`);
          }
          resultingKeys.add(prop.key.name);
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
        if (node.value?.type === "StringLiteral") inspectStringLiteral(node.value, true);
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
 * replacements, and/or Tier 3 verified JS/TS/JSX/TSX visual patches), enforcing Whole-File AST
 * Invariance on every Tier 2 and Tier 3 file before anything can be written.
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

  // Validate every caller-supplied relative path up front (never silently skip invalid/traversal entries).
  const validatedFiles: string[] = [];
  for (const rel of files) {
    if (typeof rel !== "string") throw new StudioError(400, "invalid-files", "each entry in files must be a relative path string");
    const resolved = resolveSafeWorkspaceFile(rootReal, rel, { mustExist: true });
    validatedFiles.push(resolved.relNorm);
  }

  const patches: PlannedFilePatch[] = [];
  const seen = new Set<string>();
  const targetFiles = validatedFiles.length > 0 ? validatedFiles : scanWorkspacePaths(rootReal);

  if (Object.keys(cssTokenUpdates).length > 0) {
    for (const rel of targetFiles) {
      if (patches.length >= REDESIGN_LIMITS.maxPatchFiles) break;
      const ext = extname(rel).toLowerCase();
      if (!CSS_EXTS.has(ext)) continue;
      let read;
      try {
        read = readBoundedWorkspaceFile(rootReal, rel);
      } catch (error) {
        if (error instanceof StudioError && (error.code === "missing-file" || error.code === "file-too-large" || error.code === "source-not-utf8") && validatedFiles.length === 0) {
          continue;
        }
        throw error;
      }
      if (seen.has(read.file)) continue;
      const res = patchCssTokensSource(read.content, cssTokenUpdates, { scss: ext === ".scss" });
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
      if (!JSX_EXTS.has(extname(rel).toLowerCase())) continue;
      let read;
      try {
        read = readBoundedWorkspaceFile(rootReal, rel);
      } catch (error) {
        if (error instanceof StudioError && (error.code === "missing-file" || error.code === "file-too-large" || error.code === "source-not-utf8") && validatedFiles.length === 0) {
          continue;
        }
        throw error;
      }
      if (seen.has(read.file)) continue;
      let res;
      try {
        res = patchJsxClassStrings(read.content, read.file, jsxClassReplacements);
      } catch (error) {
        if (validatedFiles.length === 0 && !(error instanceof StudioError)) continue;
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
    if (!explicit || typeof explicit !== "object" || typeof explicit.file !== "string" || typeof explicit.afterContent !== "string") {
      throw new StudioError(400, "invalid-patches", "each explicit patch requires file and afterContent strings");
    }
    if (Buffer.byteLength(explicit.afterContent, "utf8") > REDESIGN_LIMITS.maxFileBytes) {
      throw new StudioError(413, "file-too-large", `explicit patch for ${explicit.file} exceeds ${REDESIGN_LIMITS.maxFileBytes} bytes`);
    }
    const read = readBoundedWorkspaceFile(rootReal, explicit.file);
    const ext = extname(read.file).toLowerCase();
    if (!INVARIANCE_GATED_EXTS.has(ext)) {
      throw new StudioError(422, "unsupported-tier3-file", `Tier 3 explicitPatches only supports JS/TS/JSX/TSX component files (got ${read.file}); update CSS tokens via Tier 1 cssTokenUpdates`);
    }
    if (seen.has(read.file)) throw new StudioError(409, "duplicate-file", `duplicate patch target: ${read.file}`);
    const check = verifyFunctionalInvariance(read.content, explicit.afterContent, read.file);
    if (!check.ok) {
      throw new StudioError(422, "invariance-violated", `${read.file} failed AST invariance gate: ${check.violations.join("; ")}`);
    }
    if (read.content !== explicit.afterContent) {
      if (patches.length >= REDESIGN_LIMITS.maxPatchFiles) {
        throw new StudioError(400, "too-many-patches", `redesign plan exceeds maximum of ${REDESIGN_LIMITS.maxPatchFiles} files`);
      }
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

  const seen = new Set<string>();
  const backups: Array<{ file: string; beforeContent: string; beforeSha256: string; afterSha256: string; mode: number }> = [];
  for (const patch of plan.patches) {
    if (patch.tier !== 1 && patch.tier !== 2 && patch.tier !== 3) {
      throw new StudioError(400, "invalid-plan", `invalid patch tier for ${String(patch.file)}`);
    }
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
    if (seen.has(read.file)) {
      throw new StudioError(409, "duplicate-file", `redesign plan targets ${read.file} more than once`);
    }
    seen.add(read.file);
    if (read.sha256 !== patch.beforeSha256) {
      throw new StudioError(409, "file-changed", `${read.file} changed on disk since planning; re-plan before applying`);
    }
    const ext = extname(read.file).toLowerCase();
    if (patch.tier === 1) {
      if (!CSS_EXTS.has(ext)) {
        throw new StudioError(422, "unsupported-tier1-file", `Tier 1 patches may only target .css/.scss files (got ${read.file})`);
      }
      const cssCheck = verifyCssTokenPatchInvariance(read.content, patch.afterContent, { scss: ext === ".scss" });
      if (!cssCheck.ok) {
        throw new StudioError(422, "invariance-violated", `${read.file} failed Tier 1 CSS invariance gate: ${cssCheck.reason}`);
      }
    } else if (patch.tier === 2 || patch.tier === 3) {
      if (!INVARIANCE_GATED_EXTS.has(ext)) {
        throw new StudioError(422, "unsupported-tier3-file", `Tier ${patch.tier} patches only support JS/TS/JSX/TSX files (got ${read.file})`);
      }
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

  const runId = `redesign-${randomUUID().slice(0, 12)}`;
  const journalJson = JSON.stringify({
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
  }, null, 2);
  if (Buffer.byteLength(journalJson, "utf8") > REDESIGN_LIMITS.maxJournalBytes) {
    throw new StudioError(413, "journal-too-large", `redesign backup journal exceeds ${REDESIGN_LIMITS.maxJournalBytes} bytes; split into smaller batches`);
  }

  const safeJournalDir = prepareSafeJournalDir(journalDir);
  const journalPath = join(safeJournalDir, `${runId}.json`);
  writeTrustedFile(journalPath, journalJson);

  const written: typeof backups = [];
  try {
    for (let i = 0; i < plan.patches.length; i += 1) {
      writeWorkspaceFileAtomic(rootReal, backups[i].file, plan.patches[i].afterContent, {
        preserveMode: backups[i].mode,
        expectedBeforeSha256: backups[i].beforeSha256,
      });
      written.push(backups[i]);
    }
  } catch (error) {
    // Roll back already-written files atomically on any partial write failure.
    for (let i = written.length - 1; i >= 0; i -= 1) {
      try {
        writeWorkspaceFileAtomic(rootReal, written[i].file, written[i].beforeContent, { preserveMode: written[i].mode });
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
    filesApplied: plan.patches.map((p, idx) => ({ file: backups[idx].file, tier: p.tier, summary: p.summary })),
  };
}

export interface ValidatedJournalEntry {
  file: string;
  beforeSha256: string;
  afterSha256: string;
  beforeContent: string;
  mode?: number;
}

/**
 * Inspect a trusted redesign journal without modifying disk (never creates directories).
 */
export function readRedesignJournal({ workspaceRoot, journalDir, runId }: { workspaceRoot: string; journalDir: string; runId: string }) {
  if (typeof runId !== "string" || !/^redesign-[a-f0-9-]{6,36}$/u.test(runId)) {
    throw new StudioError(400, "invalid-run-id", "invalid redesign runId");
  }
  const safeJournalDir = resolveExistingJournalDir(journalDir);
  if (safeJournalDir === null) {
    throw new StudioError(404, "missing-journal", `redesign journal ${runId} not found`);
  }
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
  const journalSha256 = createHash("sha256").update(bytes).digest("hex");
  let record: any;
  try {
    record = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new StudioError(409, "corrupt-journal", `redesign journal ${runId} is not valid JSON`);
  }
  const rootReal = assertWorkspaceRoot(workspaceRoot);
  if (record?.workspaceRoot !== rootReal || !Array.isArray(record?.files) || record.files.length === 0) {
    throw new StudioError(409, "workspace-mismatch", "redesign journal belongs to a different workspace or is malformed");
  }
  const entries: ValidatedJournalEntry[] = [];
  for (const entry of record.files) {
    if (
      !entry ||
      typeof entry.file !== "string" ||
      typeof entry.beforeContent !== "string" ||
      typeof entry.beforeSha256 !== "string" ||
      typeof entry.afterSha256 !== "string"
    ) {
      throw new StudioError(409, "corrupt-journal", "redesign journal contains a malformed file entry");
    }
    entries.push({
      file: entry.file,
      beforeSha256: entry.beforeSha256,
      afterSha256: entry.afterSha256,
      beforeContent: entry.beforeContent,
      mode: typeof entry.mode === "number" ? entry.mode : undefined,
    });
  }
  return { rootReal, journalSha256, record: { ...record, files: entries } };
}

/**
 * Validate rollback preconditions (workspace confinement, journal integrity, and conflict checks
 * when `force !== true`) without modifying disk.
 */
export function validateRollbackTargets({
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
  const { rootReal, journalSha256, record } = readRedesignJournal({ workspaceRoot, journalDir, runId });
  const targets: Array<{
    file: string;
    absPath: string;
    beforeContent: string;
    mode?: number;
    preRollback: { missing: true } | { missing: false; content: string; sha256: string; mode: number };
  }> = [];

  for (const entry of record.files) {
    const { absPath, relNorm } = resolveSafeWorkspaceFile(rootReal, entry.file);
    const stat = lstatOrNull(absPath);
    if (stat === null) {
      if (!force) {
        throw new StudioError(409, "file-deleted-after-redesign", `${relNorm} was deleted after redesign; pass force: true to recreate it`);
      }
      targets.push({ file: relNorm, absPath, beforeContent: entry.beforeContent, mode: entry.mode, preRollback: { missing: true } });
    } else {
      const read = readBoundedWorkspaceFile(rootReal, relNorm);
      if (!force && read.sha256 !== entry.afterSha256) {
        throw new StudioError(409, "file-modified-after-redesign", `${relNorm} was edited after redesign; pass force: true to overwrite`);
      }
      targets.push({
        file: relNorm,
        absPath: read.absPath,
        beforeContent: entry.beforeContent,
        mode: entry.mode,
        preRollback: { missing: false, content: read.content, sha256: read.sha256, mode: read.mode },
      });
    }
  }
  return { rootReal, journalSha256, targets };
}

/**
 * Roll back a previously applied redesign run from its trusted journal backup, verifying disk
 * SHA-256 matches the applied output unless `force: true` is explicitly passed.
 * Atomically reverts any partial restore if a later file fails.
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
  const { rootReal, targets } = validateRollbackTargets({ workspaceRoot, journalDir, runId, force });

  const restored: typeof targets = [];
  try {
    for (const target of targets) {
      writeWorkspaceFileAtomic(rootReal, target.file, target.beforeContent, {
        preserveMode: target.mode,
        ...(target.preRollback.missing === false ? { expectedBeforeSha256: target.preRollback.sha256 } : {}),
      });
      restored.push(target);
    }
  } catch (error) {
    for (let i = restored.length - 1; i >= 0; i -= 1) {
      const t = restored[i];
      try {
        if (t.preRollback.missing) {
          rmSync(t.absPath, { force: true });
        } else {
          writeWorkspaceFileAtomic(rootReal, t.file, t.preRollback.content, { preserveMode: t.preRollback.mode });
        }
      } catch {
        // best-effort recovery
      }
    }
    throw new StudioError(500, "rollback-failed", `redesign rollback failed and reverted: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    runId,
    restoredFiles: targets.map((t) => t.file),
  };
}
