import { createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, rmdirSync, unlinkSync, writeSync } from "node:fs";
import { join, sep } from "node:path";
import { exportedComponents } from "@ninerr/code-ir";
import {
  DEFAULT_LAYOUT,
  REGISTRY_ITEM_LIMITS,
  RegistryItemError,
  checkLayout,
  importDecision,
  parseRegistryItem,
  primitiveFamily,
  resolveTarget,
  sourceForRegistryUrl,
} from "@ninerr/component-sources";
import { StudioError } from "./errors.ts";

// Bringing a registry item a person chose into their connected codebase (#405). Only the person,
// through the editor's session, plans or applies an import. The host fetches nothing: the item
// is the text the person gave. A plan shows every file, where it goes and whether it is new;
// applying it creates new files only, never replaces one, and writes nothing a plan did not show.

export const MAX_COMPONENT_REQUEST_BYTES = REGISTRY_ITEM_LIMITS.bytes * 6 + 64 * 1024;
const MAX_PROJECT_FILE_BYTES = 256 * 1024;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export interface ComponentImportRequest {
  item?: unknown;
  origin?: { url?: unknown; fileName?: unknown } | unknown;
  freeItemConfirmed?: unknown;
  token?: unknown;
}

type FileStatus = "new" | "same" | "conflict";

export interface ComponentImportPlan {
  token: string;
  item: { name: string; type: string; title: string | null; description: string | null; author: string | null };
  origin: string;
  source: { id: string; name: string; license: string; importPolicy: string } | null;
  decision: { allowed: boolean; reason: string; attribution: string | null };
  primitives: { family: string; evidence: readonly string[] };
  project: { family: string; layout: Record<string, string>; layoutFrom: string };
  files: Array<{ path: string; bytes: number; status: FileStatus }>;
  dependencies: { missing: Array<{ name: string; range: string | null }>; present: string[] };
  devDependencies: { missing: Array<{ name: string; range: string | null }>; present: string[] };
  registryDependencies: readonly string[];
  tokens: { theme: string[]; light: string[]; dark: string[] };
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
    if (typeof fileName !== "string" || fileName.length > 200 || /[\u0000-\u001f\u007f/\\]/u.test(fileName)) throw new StudioError(400, "invalid-origin", "the file name must be a plain name of at most 200 characters");
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
 * The folders an item's files go in. components.json's aliases are read when the connected folder
 * has one: `@/components` is the folder's components directory. Anything that is not a plain
 * relative folder keeps the default, so the plan always shows a path inside the codebase.
 */
function projectLayout(folder: string): { layout: Record<string, string>; from: string } {
  const config = parseJsonObject(readProjectFile(folder, "components.json"));
  const aliases = config?.aliases;
  if (aliases === null || typeof aliases !== "object") return { layout: { ...DEFAULT_LAYOUT }, from: "the default folders" };
  const folderOf = (alias: unknown, fallback: string) => {
    if (typeof alias !== "string") return fallback;
    const path = alias.replace(/^[@~]\//u, "");
    try {
      return checkLayout({ ...DEFAULT_LAYOUT, components: path }).components;
    } catch {
      return fallback;
    }
  };
  const layout = {
    components: folderOf(aliases.components, DEFAULT_LAYOUT.components),
    ui: folderOf(aliases.ui, DEFAULT_LAYOUT.ui),
    lib: folderOf(aliases.lib, DEFAULT_LAYOUT.lib),
    hooks: folderOf(aliases.hooks, DEFAULT_LAYOUT.hooks),
  };
  return { layout, from: "components.json" };
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
  const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\*\//gu, "* /");
  const lines = [`Imported by Ninerr from ${clean(origin)}.`];
  if (source) lines.push(`${clean(source.name)}: ${clean(source.license)}.`);
  if (attribution) lines.push(`Its license requires a visible link to ${clean(attribution)} in any project that ships it.`);
  const header = COMMENT.test(path) ? `/*\n${lines.map((line) => ` * ${line}`).join("\n")}\n */\n` : `${lines.map((line) => `// ${line}`).join("\n")}\n`;
  return header + content;
}

/** What an import would do, without writing anything. */
export function planComponentImport(folder: string, request: ComponentImportRequest): ComponentImportPlan & { writes: Array<{ path: string; content: string }> } {
  const item = readItem(request?.item);
  const origin = readOrigin(request?.origin);
  const catalogSource = origin.url === null ? null : sourceForRegistryUrl(origin.url);
  if (origin.url !== null && catalogSource === null) {
    throw new StudioError(403, "unknown-registry", "Ninerr imports from a URL only when it is one of the catalog's registries; save the item and give it as a file to judge its license yourself");
  }
  const decision = importDecision(catalogSource, { freeItemConfirmed: request?.freeItemConfirmed === true });
  const source = catalogSource ? { id: catalogSource.id, name: catalogSource.name, license: catalogSource.license, importPolicy: catalogSource.importPolicy } : null;

  const { layout, from: layoutFrom } = projectLayout(folder);
  const packages = projectPackages(folder);
  const projectFamily = primitiveFamily({ dependencies: [...packages.all].map((name) => ({ name, range: null })), files: [] }).family;
  const blockers: string[] = [];
  if (!decision.allowed) blockers.push(decision.reason);
  if (item.primitives.family === "mixed") blockers.push("The item uses more than one primitive family (Base UI, Radix, React Aria); one component builds on one.");
  if (projectFamily === "mixed") blockers.push("The project already uses more than one primitive family; choose one before importing.");
  else if (item.primitives.family !== "none" && item.primitives.family !== "mixed" && projectFamily !== "none" && projectFamily !== item.primitives.family) {
    blockers.push(`The project builds on ${projectFamily === "base" ? "Base UI" : projectFamily === "radix" ? "Radix" : "React Aria"}, and this item on ${item.primitives.family === "base" ? "Base UI" : item.primitives.family === "radix" ? "Radix" : "React Aria"}. Choose the item's ${projectFamily} variant.`);
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
  const token = sha256(JSON.stringify([folder, sha256(request.item as string), origin.label, decision, files, layout]));
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
    cssRules: item.cssRules,
    ignored: item.ignored,
    blockers,
    appliable: blockers.length === 0 && writes.length > 0,
    writes,
  };
}

/** A plan as the editor sees it: no file contents. */
export function publicPlan(plan: ReturnType<typeof planComponentImport>): ComponentImportPlan {
  const { writes: _writes, ...shown } = plan;
  return shown;
}

/**
 * Create the plan's new files, if the codebase is still exactly as planned. Each file is created
 * exclusively (an existing one is never replaced); if any write fails, the files and folders this
 * call created are removed again. Returns what was written and the components it exports.
 */
export function applyComponentImport(folder: string, request: ComponentImportRequest) {
  const plan = planComponentImport(folder, request);
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
  return { written: plan.writes.map((write) => write.path), skipped: plan.files.filter((file) => file.status === "same").map((file) => file.path), components, plan: publicPlan(plan) };
}
