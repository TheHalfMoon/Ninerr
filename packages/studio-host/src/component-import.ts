import { createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeSync } from "node:fs";
import { join, sep } from "node:path";
import { exportedComponents } from "@ninerr/code-ir";
import {
  DEFAULT_LAYOUT,
  REGISTRY_ITEM_LIMITS,
  RegistryItemError,
  checkLayout,
  importDecision,
  parseRegistryItem,
  PRIMITIVE_FAMILIES,
  primitiveFamily,
  resolveTarget,
  sourceForRegistryUrl,
} from "@ninerr/component-sources";
import { TOKEN_NAME, cssValueProblem, designSystemOf, designSystemProblem, newDesignSystemProps, tokenReferences } from "@ninerr/document-model";
import { StudioError } from "./errors.ts";

// Bringing a registry item a person chose into their connected codebase (#405). Only the person,
// through the editor's session, plans or applies an import. The host fetches nothing: the item
// is the text the person gave. A plan shows every file, where it goes and whether it is new;
// applying it creates new files only, never replaces one, and writes nothing a plan did not show.

export const MAX_COMPONENT_REQUEST_BYTES = REGISTRY_ITEM_LIMITS.bytes * 6 + 64 * 1024;
const MAX_PROJECT_FILE_BYTES = 256 * 1024;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
// Characters that end a line in JavaScript or CSS, or are not printable: never in a notice.
const LINE_BREAKING = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu;
// The MIT permission notice, which travels with every copy of MIT-licensed code.
const MIT_PERMISSION = [
  "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:",
  "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.",
  "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.",
];

export interface ComponentImportRequest {
  item?: unknown;
  origin?: { url?: unknown; fileName?: unknown } | unknown;
  freeItemConfirmed?: unknown;
  token?: unknown;
  // Add the item's new CSS variables to the project's design system, as one transaction.
  addTokens?: unknown;
}

type TokenStatus = "new" | "same" | "extended" | "conflict" | "refused";
export interface PlannedToken { name: string; type: string; values: Record<string, string>; status: TokenStatus; reason?: string }

type FileStatus = "new" | "same" | "conflict";

export interface ComponentImportPlan {
  token: string;
  item: { name: string; type: string; title: string | null; description: string | null; author: string | null };
  origin: string;
  source: { id: string; name: string; license: string; importPolicy: string; copyright: string | null } | null;
  decision: { allowed: boolean; reason: string; attribution: string | null };
  primitives: { family: string; evidence: readonly string[] };
  project: { family: string; layout: Record<string, string>; layoutFrom: string };
  files: Array<{ path: string; bytes: number; status: FileStatus }>;
  dependencies: { missing: Array<{ name: string; range: string | null }>; present: string[] };
  devDependencies: { missing: Array<{ name: string; range: string | null }>; present: string[] };
  registryDependencies: readonly string[];
  tokens: { theme: string[]; light: string[]; dark: string[] };
  // The item's CSS variables as the project's design tokens: new ones are added with addTokens;
  // one whose name is taken with another value is kept as it is (conflict), never overwritten.
  designTokens: PlannedToken[];
  cssRules: number;
  ignored: readonly string[];
  blockers: string[];
  appliable: boolean;
}

/** The parsed item, or the person is told exactly why it is refused. */
function readItem(text: unknown) {
  if (typeof text !== "string") throw new StudioError(400, "invalid-item", "give the registry item's JSON text");
  try {
    return parseRegistryItem(text);
  } catch (error) {
    if (error instanceof RegistryItemError) throw new StudioError(400, `item-${error.code}`, error.message);
    throw error;
  }
}

/** Where the item came from, as the person stated it: an https URL, a file name, or nothing. */
function readOrigin(origin: unknown): { url: string | null; label: string } {
  if (origin === undefined || origin === null) return { url: null, label: "an item you gave" };
  if (typeof origin !== "object" || Array.isArray(origin)) throw new StudioError(400, "invalid-origin", "origin must be an object");
  const { url, fileName } = origin as { url?: unknown; fileName?: unknown };
  if (url !== undefined && url !== null && url !== "") {
    if (typeof url !== "string" || url.length > 2048) throw new StudioError(400, "invalid-origin", "the item's URL must be text of at most 2048 characters");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new StudioError(400, "invalid-origin", "the item's URL is not a URL");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new StudioError(400, "invalid-origin", "the item's URL must be https, with no credentials");
    return { url: parsed.href, label: parsed.href };
  }
  if (fileName !== undefined && fileName !== null && fileName !== "") {
    if (typeof fileName !== "string" || fileName.length > 200 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029/\\]/u.test(fileName)) throw new StudioError(400, "invalid-origin", "the file name must be a plain name of at most 200 characters");
    return { url: null, label: `the file ${fileName}` };
  }
  return { url: null, label: "an item you gave" };
}

/** An existing path inside `folder`, checked segment by segment: no link anywhere on the way. */
function inspect(folder: string, path: string): { kind: "missing" } | { kind: "file"; absolute: string; size: number; links: number } {
  const segments = path.split("/");
  let current = folder;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    let entry;
    try {
      entry = lstatSync(current);
    } catch {
      return { kind: "missing" };
    }
    if (entry.isSymbolicLink()) throw new StudioError(409, "link-in-path", `${segments.slice(0, index + 1).join("/")} is a link; an import never writes through one`);
    const last = index === segments.length - 1;
    if (!last && !entry.isDirectory()) throw new StudioError(409, "not-a-folder", `${segments.slice(0, index + 1).join("/")} is a file, so ${path} cannot be created`);
    if (last) {
      if (!entry.isFile()) throw new StudioError(409, "not-a-file", `${path} exists and is not a regular file`);
      return { kind: "file", absolute: current, size: entry.size, links: entry.nlink };
    }
  }
  return { kind: "missing" };
}

/** A small project file at the folder's top (package.json, components.json), or null. */
function readProjectFile(folder: string, name: string): string | null {
  const found = inspect(folder, name);
  if (found.kind === "missing") return null;
  if (found.size > MAX_PROJECT_FILE_BYTES || found.links > 1) return null;
  try {
    return UTF8.decode(readFileSync(found.absolute));
  } catch {
    return null;
  }
}

function parseJsonObject(text: string | null): Record<string, any> | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Where `@/` points in the codebase, from tsconfig.json or jsconfig.json `paths` (`"@/*":
 * ["./src/*"]` is `src`). Comments in those files are allowed, so the entry is matched, not parsed.
 */
function aliasRoot(folder: string): string {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const text = readProjectFile(folder, name);
    if (text === null) continue;
    const match = /"@\/\*"\s*:\s*\[\s*"(?:\.\/)?([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)\/\*"/u.exec(text);
    if (match) return match[1];
    if (/"@\/\*"\s*:\s*\[\s*"(?:\.\/)?\*"/u.test(text)) return "";
  }
  return "";
}

/**
 * The folders an item's files go in. components.json's aliases are read when the connected folder
 * has one: `@/components` is the components folder under wherever `@/` points (tsconfig `paths`,
 * so the src folder's components folder in a src project). An alias of any other form keeps the default folder, and
 * the plan says so: the plan always shows a path inside the codebase.
 */
function projectLayout(folder: string): { layout: Record<string, string>; from: string } {
  const config = parseJsonObject(readProjectFile(folder, "components.json"));
  const aliases = config?.aliases;
  if (aliases === null || typeof aliases !== "object") return { layout: { ...DEFAULT_LAYOUT }, from: "the default folders" };
  const root = aliasRoot(folder);
  let defaulted = false;
  const folderOf = (alias: unknown, fallback: string) => {
    if (typeof alias !== "string" || !/^[@~]\//u.test(alias)) {
      if (alias !== undefined) defaulted = true;
      return root === "" ? fallback : `${root}/${fallback}`;
    }
    const path = (root === "" ? "" : `${root}/`) + alias.slice(2);
    try {
      return checkLayout({ ...DEFAULT_LAYOUT, components: path }).components;
    } catch {
      defaulted = true;
      return fallback;
    }
  };
  const layout = {
    components: folderOf(aliases.components, DEFAULT_LAYOUT.components),
    ui: folderOf(aliases.ui, DEFAULT_LAYOUT.ui),
    lib: folderOf(aliases.lib, DEFAULT_LAYOUT.lib),
    hooks: folderOf(aliases.hooks, DEFAULT_LAYOUT.hooks),
  };
  return { layout, from: defaulted ? "components.json, with the default folder for aliases that are not @/ or ~/ paths" : "components.json" };
}

/** The project's declared packages, by section. */
function projectPackages(folder: string): { dependencies: Set<string>; all: Set<string> } {
  const manifest = parseJsonObject(readProjectFile(folder, "package.json"));
  const section = (name: string) => {
    const value = manifest?.[name];
    return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  };
  const dependencies = new Set(section("dependencies"));
  return { dependencies, all: new Set([...dependencies, ...section("devDependencies"), ...section("peerDependencies")]) };
}

const COMMENT = /\.css$/u;

/**
 * The notice an imported file starts with: where it came from, its source's license and any
 * credit the license asks for. The upstream text follows unchanged.
 */
function withNotice(path: string, content: string, origin: string, source: ComponentImportPlan["source"], attribution: string | null): string {
  const clean = (text: string) => text.replace(LINE_BREAKING, " ").replace(/\*\//gu, "* /");
  const lines = [`Imported by Ninerr from ${clean(origin)}.`];
  if (source) {
    lines.push(`${clean(source.name)}: ${clean(source.license)}.`);
    if (source.copyright) lines.push(clean(source.copyright));
    // MIT code carries its permission notice with every copy, here at the top of the file.
    if (source.license.startsWith("MIT")) lines.push(...MIT_PERMISSION);
  }
  if (attribution) lines.push(`Its license requires a visible link to ${clean(attribution)} in any project that ships it.`);
  const header = COMMENT.test(path) ? `/*\n${lines.map((line) => ` * ${line}`).join("\n")}\n */\n` : `${lines.map((line) => `// ${line}`).join("\n")}\n`;
  return header + content;
}

// A registry item's CSS variable as a token type, by its name (shadcn names them so): what the
// Tokens dialog lists it under. A colour is the default, as most of an item's variables are.
function tokenTypeOf(name: string): string {
  if (/radius/iu.test(name)) return "radius";
  if (/font|family/iu.test(name)) return "fontFamily";
  if (/shadow/iu.test(name)) return "shadow";
  if (/opacity/iu.test(name)) return "opacity";
  if (/space|spacing|gap|padding|margin/iu.test(name)) return "spacing";
  return "color";
}

/**
 * The item's CSS variables against the project's design system. Its theme and light values go to
 * the first collection's default mode and its dark values to that collection's Dark mode (added
 * if it has none). Each token is judged on its own:
 * - new: added;
 * - same: already there with these values;
 * - extended: already there with the same values, and the item gives modes it lacks, which are
 *   added (nothing it has is changed);
 * - conflict: its name is taken with another value, and it is kept as it is;
 * - refused: not a custom property name, not one safe CSS value, or an alias to a token that will
 *   not be there.
 * Returns the operations that make it so in one transaction, or why the whole set cannot be added
 * (a limit or a cycle), which blocks only an import that adds tokens.
 */
export function planItemTokens(document: any, cssVars: any): { tokens: PlannedToken[]; operations: unknown[]; problem: string | null } {
  const system = document === null ? null : designSystemOf(document);
  const props = system === null ? newDesignSystemProps() : structuredClone(system.props);
  const collection = props.collections[0];
  const darkMode = collection.modes.find((mode: any) => mode.id === "dark" || mode.name.toLowerCase() === "dark");
  const darkId = darkMode?.id ?? "dark";
  const byName = new Map<string, PlannedToken>();
  for (const [scope, mode] of [["theme", collection.defaultMode], ["light", collection.defaultMode], ["dark", darkId]] as const) {
    for (const [key, value] of Object.entries(cssVars?.[scope] ?? {})) {
      const name = `--${key}`;
      const planned = byName.get(name) ?? { name, type: tokenTypeOf(key), values: {}, status: "new" as TokenStatus };
      planned.values[mode] = value as string;
      byName.set(name, planned);
    }
  }
  const tokens = [...byName.values()];
  // A design system whose default mode is its Dark one has no mode for an item's light values.
  if (darkId === collection.defaultMode && Object.keys(cssVars?.dark ?? {}).length > 0 && (Object.keys(cssVars?.light ?? {}).length > 0 || Object.keys(cssVars?.theme ?? {}).length > 0)) {
    for (const token of tokens) {
      token.status = "refused";
      token.reason = "the design system's default mode is its Dark one, so the item's light values have no mode to go in";
    }
    return { tokens, operations: [], problem: null };
  }
  for (const planned of tokens) {
    // A dark-only variable takes its dark value in the default mode too, so it is always defined.
    if (planned.values[collection.defaultMode] === undefined && planned.values[darkId] !== undefined) planned.values[collection.defaultMode] = planned.values[darkId];
    const problem = !TOKEN_NAME.test(planned.name) ? "it is not a CSS custom property name" : Object.values(planned.values).map((value) => cssValueProblem(value)).find((entry) => entry !== null) ?? null;
    const existing = props.tokens.find((token: any) => token.name === planned.name);
    if (problem !== null) {
      planned.status = "refused";
      planned.reason = problem;
    } else if (existing) {
      const shared = Object.keys(planned.values).filter((mode) => existing.values[mode] !== undefined);
      const agrees = shared.every((mode) => existing.values[mode] === planned.values[mode]);
      const lacking = Object.keys(planned.values).filter((mode) => existing.values[mode] === undefined);
      planned.status = !agrees ? "conflict" : lacking.length === 0 ? "same" : "extended";
      if (!agrees) planned.reason = `${planned.name} is already a token with another value; it is kept as it is`;
    }
  }
  // An alias must name a token that will be there: the design system's own, or one this import
  // adds. One that does not is refused, and so is anything that leans on it.
  const present = new Set<string>(props.tokens.map((token: any) => token.name));
  for (;;) {
    const adding = new Set(tokens.filter((token) => token.status === "new").map((token) => token.name));
    const missing = tokens.find((token) => (token.status === "new" || token.status === "extended") && Object.values(token.values).some((value) => tokenReferences(value).some((name) => !present.has(name) && !adding.has(name))));
    if (missing === undefined) break;
    const name = Object.values(missing.values).flatMap((value) => tokenReferences(value)).find((reference) => !present.has(reference) && !adding.has(reference));
    missing.status = "refused";
    missing.reason = `it refers to ${name}, which is not a token and is not one this import adds`;
  }
  const added = tokens.filter((token) => token.status === "new");
  const extended = tokens.filter((token) => token.status === "extended");
  // With no document (a plan made apart from a project) there is no design system to add to.
  if ((added.length === 0 && extended.length === 0) || document === null) return { tokens, operations: [], problem: null };
  const needsDark = [...added, ...extended].some((token) => token.values[darkId] !== undefined) && !darkMode;
  if (needsDark) {
    collection.modes.push({ id: darkId, name: "Dark" });
    // A token already there takes the item's dark value when the item agrees with it, and its own
    // default value otherwise, until the person changes it.
    for (const token of props.tokens) {
      if (token.collection !== collection.id || token.values[collection.defaultMode] === undefined) continue;
      const fromItem = byName.get(token.name);
      token.values[darkId] = fromItem && (fromItem.status === "extended" || fromItem.status === "same") && fromItem.values[darkId] !== undefined ? fromItem.values[darkId] : token.values[collection.defaultMode];
    }
  }
  for (const token of extended) {
    const target = props.tokens.find((entry: any) => entry.name === token.name);
    for (const [mode, value] of Object.entries(token.values)) if (target.values[mode] === undefined && collection.modes.some((entry: any) => entry.id === mode)) target.values[mode] = value;
  }
  for (const token of added) {
    const values = { ...token.values };
    if (collection.modes.some((mode: any) => mode.id === darkId) && values[darkId] === undefined && values[collection.defaultMode] !== undefined) values[darkId] = values[collection.defaultMode];
    props.tokens.push({ name: token.name, type: token.type, collection: collection.id, values });
  }
  const problem = designSystemProblem(props);
  if (problem !== null) return { tokens, operations: [], problem };
  let id = `design-system-${sha256(JSON.stringify(props)).slice(0, 12)}`;
  for (let suffix = 2; system === null && Object.hasOwn(document.nodes, id); suffix += 1) id = `design-system-${sha256(JSON.stringify(props)).slice(0, 12)}-${suffix}`;
  const operations = system === null
    ? [{ type: "insert-node", parentId: null, index: document.rootIds.length, node: { id, type: "design-system", props } }]
    : [{ type: "set-props", nodeId: system.id, set: { collections: props.collections, tokens: props.tokens } }];
  return { tokens, operations, problem: null };
}

/** What an import would do, without writing anything. */
export function planComponentImport(folder: string, request: ComponentImportRequest, document: any = null): ComponentImportPlan & { writes: Array<{ path: string; content: string }>; tokenOperations: unknown[] } {
  const item = readItem(request?.item);
  const origin = readOrigin(request?.origin);
  const catalogSource = origin.url === null ? null : sourceForRegistryUrl(origin.url);
  if (origin.url !== null && catalogSource === null) {
    throw new StudioError(403, "unknown-registry", "Ninerr imports from a URL only when it is one of the catalog's registries; save the item and give it as a file to judge its license yourself");
  }
  const decision = importDecision(catalogSource, { freeItemConfirmed: request?.freeItemConfirmed === true });
  const source = catalogSource ? { id: catalogSource.id, name: catalogSource.name, license: catalogSource.license, importPolicy: catalogSource.importPolicy, copyright: catalogSource.copyright } : null;

  const { layout, from: layoutFrom } = projectLayout(folder);
  const packages = projectPackages(folder);
  const projectFamily = primitiveFamily({ dependencies: [...packages.all].map((name) => ({ name, range: null })), files: [] }).family;
  const blockers: string[] = [];
  if (!decision.allowed) blockers.push(decision.reason);
  // An item's own dependencies on a source Ninerr may not import from block it, however the item
  // itself was given.
  for (const reference of item.registryDependencies) {
    const from = /^https:/u.test(reference) ? sourceForRegistryUrl(reference) : null;
    if (from !== null && from.importPolicy === "permission-required") blockers.push(`It needs ${reference}, from ${from.name}, which Ninerr may not import: ${from.rights}`);
  }
  if (item.primitives.family === "mixed") blockers.push("The item uses more than one primitive family (Base UI, Radix, React Aria, Astryx); one component builds on one.");
  if (projectFamily === "mixed") blockers.push("The project already uses more than one primitive family; choose one before importing.");
  else if (item.primitives.family !== "none" && item.primitives.family !== "mixed" && projectFamily !== "none" && projectFamily !== item.primitives.family) {
    const name = (family: string) => (PRIMITIVE_FAMILIES as Record<string, string>)[family] ?? family;
    // Astryx is a whole design system: another family's item does not become an Astryx one.
    blockers.push(projectFamily === "astryx" || item.primitives.family === "astryx"
      ? `The project builds on ${name(projectFamily)}, and this item on ${name(item.primitives.family)}. Astryx brings its own components: use one system for a project.`
      : `The project builds on ${name(projectFamily)}, and this item on ${name(item.primitives.family)}. Choose the item's ${projectFamily} variant.`);
  }

  const seen = new Set<string>();
  const files: ComponentImportPlan["files"] = [];
  const writes: Array<{ path: string; content: string }> = [];
  for (const file of item.files) {
    const { path, refused } = resolveTarget(file, layout);
    if (refused) throw new StudioError(400, "item-unwritable", `${path}: ${refused}`);
    const key = path.toLowerCase();
    if (seen.has(key)) throw new StudioError(400, "item-duplicate-target", `two of the item's files go to ${path}`);
    seen.add(key);
    const content = withNotice(path, file.content, origin.label, source, decision.attribution);
    const found = inspect(folder, path);
    let status: FileStatus = "new";
    if (found.kind === "file") {
      let existing: string | null = null;
      if (found.links === 1 && found.size <= REGISTRY_ITEM_LIMITS.fileBytes + 4096) {
        try {
          existing = UTF8.decode(readFileSync(found.absolute));
        } catch {
          existing = null;
        }
      }
      status = existing === content ? "same" : "conflict";
    }
    if (status === "conflict") blockers.push(`${path} already exists with other content. An import never replaces a file; rename or move it first.`);
    files.push({ path, bytes: Buffer.byteLength(content, "utf8"), status });
    if (status === "new") writes.push({ path, content });
  }

  const split = (list: readonly { name: string; range: string | null }[]) => ({
    missing: list.filter((dependency) => !packages.all.has(dependency.name)).map(({ name, range }) => ({ name, range })),
    present: list.filter((dependency) => packages.all.has(dependency.name)).map(({ name }) => name),
  });
  const tokens = { theme: Object.keys(item.cssVars.theme ?? {}), light: Object.keys(item.cssVars.light ?? {}), dark: Object.keys(item.cssVars.dark ?? {}) };
  const itemTokens = planItemTokens(document, item.cssVars);
  // The tokens block only an import that adds them: without, the files come in alone.
  if (itemTokens.problem !== null && request?.addTokens === true) blockers.push(`Its tokens cannot be added to the design system: ${itemTokens.problem}. Import without adding its tokens, or add them in Tokens.`);
  const addingTokens = request?.addTokens === true && itemTokens.operations.length > 0;
  // The plan covers the tokens too: a design system that changed since is a changed plan.
  const token = sha256(JSON.stringify([folder, sha256(request.item as string), origin.label, decision, files, layout, itemTokens.tokens, addingTokens]));
  return {
    token,
    item: { name: item.name, type: item.type, title: item.title, description: item.description, author: item.author },
    origin: origin.label,
    source,
    decision,
    primitives: item.primitives,
    project: { family: projectFamily, layout, layoutFrom },
    files,
    dependencies: split(item.dependencies),
    devDependencies: split(item.devDependencies),
    registryDependencies: item.registryDependencies,
    tokens,
    designTokens: itemTokens.tokens,
    cssRules: item.cssRules,
    ignored: item.ignored,
    blockers,
    appliable: blockers.length === 0 && (writes.length > 0 || addingTokens),
    writes,
    tokenOperations: addingTokens ? itemTokens.operations : [],
  };
}

// Windows and macOS compare paths without case; a link or junction changes the whole path.
const samePath = (a: string, b: string) => (process.platform === "linux" ? a === b : a.toLowerCase() === b.toLowerCase());

/** A plan as the editor sees it: no file contents. */
export function publicPlan(plan: ReturnType<typeof planComponentImport>): ComponentImportPlan {
  const { writes: _writes, tokenOperations: _tokenOperations, ...shown } = plan;
  return shown;
}

/**
 * Create the plan's new files, if the codebase is still exactly as planned. Each file is created
 * exclusively (an existing one is never replaced); if any write fails, the files and folders this
 * call created are removed again. Returns what was written and the components it exports.
 */
export function applyComponentImport(folder: string, request: ComponentImportRequest, hooks: { beforeWrite?: (path: string) => void } = {}, document: any = null) {
  const plan = planComponentImport(folder, request, document);
  if (typeof request?.token !== "string" || request.token !== plan.token) throw new StudioError(409, "plan-changed", "the item or the codebase changed since the plan; review it again");
  if (!plan.appliable) throw new StudioError(409, "import-blocked", plan.blockers[0] ?? "the import writes no new file");
  const createdFiles: string[] = [];
  const createdFolders: string[] = [];
  const undo = () => {
    for (const path of createdFiles.reverse()) {
      try {
        unlinkSync(path);
      } catch {
        // Left in place; the person is told the import failed.
      }
    }
    for (const path of createdFolders.reverse()) {
      try {
        rmdirSync(path);
      } catch {
        // Not empty, or already gone.
      }
    }
  };
  try {
    for (const write of plan.writes) {
      const segments = write.path.split("/");
      let current = folder;
      for (const segment of segments.slice(0, -1)) {
        current = join(current, segment);
        try {
          mkdirSync(current);
          createdFolders.push(current);
        } catch (error: any) {
          if (error?.code !== "EEXIST") throw error;
        }
        const entry = lstatSync(current);
        if (entry.isSymbolicLink() || !entry.isDirectory()) throw new StudioError(409, "plan-changed", `${current.slice(folder.length + 1).split(sep).join("/")} changed while the import ran`);
      }
      hooks.beforeWrite?.(write.path);
      // The folder about to hold the file is, on disk, the one planned: no folder on the way was
      // replaced by a link or junction since it was checked.
      const parent = join(folder, ...segments.slice(0, -1));
      if (!samePath(realpathSync.native(parent), parent)) throw new StudioError(409, "plan-changed", `${segments.slice(0, -1).join("/") || "the codebase folder"} changed while the import ran`);
      const absolute = join(folder, ...segments);
      const fd = openSync(absolute, "wx", 0o644);
      createdFiles.push(absolute);
      try {
        writeSync(fd, write.content);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
  } catch (error) {
    undo();
    if (error instanceof StudioError) throw error;
    if ((error as any)?.code === "EEXIST") throw new StudioError(409, "plan-changed", "a file the plan creates appeared while the import ran; nothing was kept");
    throw new StudioError(500, "import-write-failed", "the item's files could not be written; nothing was kept");
  }
  const components: Array<{ file: string; component: string }> = [];
  for (const write of plan.writes) {
    if (!/\.(?:jsx|tsx|js)$/u.test(write.path)) continue;
    let names: string[] = [];
    try {
      names = exportedComponents(write.path, write.content);
    } catch {
      names = [];
    }
    for (const component of names) components.push({ file: write.path, component });
  }
  return { written: plan.writes.map((write) => write.path), skipped: plan.files.filter((file) => file.status === "same").map((file) => file.path), components, plan: publicPlan(plan), tokenOperations: plan.tokenOperations };
}
