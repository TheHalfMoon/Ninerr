// Registry items: the shadcn registry-item format that most of the catalog's sources publish
// (https://ui.shadcn.com/schema/registry-item.json). This module only reads and judges an item
// a person has chosen. It runs nothing, fetches nothing and writes nothing: a host that applies
// an item writes only the paths `resolveTarget` returns, after the person has seen the plan.
import { UI_COMPONENT_SOURCES } from "./catalog.mjs";

export { UI_COMPONENT_SOURCES, UI_COMPONENT_SOURCE_GROUPS, UI_IMPORT_POLICIES, searchUiComponentSources } from "./catalog.mjs";

export const REGISTRY_ITEM_LIMITS = Object.freeze({
  bytes: 1024 * 1024,
  files: 64,
  fileBytes: 256 * 1024,
  dependencies: 64,
  registryDependencies: 64,
  cssVars: 512,
  cssRules: 256,
  pathLength: 200,
  closureItems: 64,
  closureDepth: 16,
});

export class RegistryItemError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RegistryItemError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new RegistryItemError(code, message);
};

// Item types a person can bring into a project. A style, base or font item reconfigures the
// whole project rather than adding to it, so it is refused here.
export const IMPORTABLE_ITEM_TYPES = Object.freeze([
  "registry:ui", "registry:component", "registry:block", "registry:lib", "registry:hook",
  "registry:page", "registry:file", "registry:theme", "registry:item",
]);
const PROJECT_ITEM_TYPES = new Set(["registry:style", "registry:base", "registry:font"]);
const FILE_TYPES = new Set(["registry:ui", "registry:component", "registry:block", "registry:lib", "registry:hook", "registry:page", "registry:file", "registry:item", "registry:theme"]);
// Top-level fields this module reads. Anything else is reported, never acted on.
const KNOWN_FIELDS = new Set(["$schema", "name", "type", "title", "description", "author", "dependencies", "devDependencies", "registryDependencies", "files", "cssVars", "css", "tailwind", "envVars", "meta", "docs", "categories", "extends"]);

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
// The file kinds an item may write: component source and stylesheets, nothing a shell or a
// build runs by name.
const WRITABLE_EXTENSION = /\.(?:tsx|ts|jsx|js|mjs|css)$/u;
// Files that change how a project builds, installs or is configured. An item never writes them;
// a dependency is listed for the person to add, not written into package.json.
const BUILD_CONFIG = /^(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|tsconfig(?:\.[^/]+)?\.json|jsconfig\.json|components\.json|(?:next|vite|vitest|webpack|rollup|postcss|tailwind|babel|eslint|prettier|svelte|astro|nuxt|remix|jest|playwright|turbo)\.config\.[a-z]+)$/iu;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/iu;
const PLACEHOLDERS = Object.freeze({ "@components/": "components", "@ui/": "ui", "@lib/": "lib", "@hooks/": "hooks" });

/** Why a registry path is unsafe to write, or null. Paths use `/` and stay inside the project. */
export function unsafePathReason(path) {
  if (typeof path !== "string" || path.length === 0) return "it is empty";
  if (path.length > REGISTRY_ITEM_LIMITS.pathLength) return `it is longer than ${REGISTRY_ITEM_LIMITS.pathLength} characters`;
  // Every decoding a tool on the way might apply, so an encoded `..` cannot slip through.
  const forms = [path];
  for (let index = 0; index < 3; index += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(forms[forms.length - 1]);
    } catch {
      return "it is not valid percent-encoding";
    }
    if (decoded === forms[forms.length - 1]) break;
    forms.push(decoded);
  }
  for (const form of forms) {
    if (/[\u0000-\u001f\u007f]/u.test(form)) return "it contains a control character";
    if (form.includes("\\")) return "it contains a backslash";
    if (form.includes(":")) return "it contains a colon";
    if (form.startsWith("/")) return "it is absolute";
    const body = form.startsWith("~/") ? form.slice(2) : form;
    const segments = body.split("/");
    for (const segment of segments) {
      if (segment === "" ) return "it has an empty segment";
      if (segment === "." || segment === "..") return "it leaves its folder";
      if (segment.startsWith(".")) return `it names a hidden file or folder (${segment})`;
      if (segment === "node_modules") return "it writes into node_modules";
      if (WINDOWS_RESERVED.test(segment)) return `it names a reserved device (${segment})`;
      if (/[ .]$/u.test(segment)) return "a segment ends in a space or a dot";
      if (/[<>"|?*]/u.test(segment)) return "it contains a character Windows refuses";
    }
  }
  return null;
}

/** Why an item may not write this file, or null: a safe path, a source file, not build config. */
export function unwritableReason(path) {
  const unsafe = unsafePathReason(path);
  if (unsafe) return unsafe;
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (BUILD_CONFIG.test(name)) return `${name} configures how the project builds`;
  if (!WRITABLE_EXTENSION.test(name)) return `${name} is not a component source or stylesheet`;
  return null;
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const utf8Length = (text) => new TextEncoder().encode(text).length;

function optionalText(item, key, max) {
  if (!Object.hasOwn(item, key)) return null;
  const value = item[key];
  if (typeof value !== "string" || value.length > max) fail("invalid-field", `${key} must be text of at most ${max} characters`);
  return value;
}

// npm names, and the plain version ranges an item may ask for. A URL, git, file, link,
// workspace or alias spec is refused: it would install something the person cannot see here.
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;
const NPM_RANGE = /^[0-9A-Za-z.^~<>=|* +-]{1,64}$/u;

export function parseDependency(spec) {
  if (typeof spec !== "string" || spec.length === 0 || spec.length > 214) fail("invalid-dependency", "a dependency must be a package name of at most 214 characters");
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  const name = at === -1 ? spec : spec.slice(0, at);
  const range = at === -1 ? null : spec.slice(at + 1);
  if (!NPM_NAME.test(name)) fail("invalid-dependency", `${spec} is not an npm package name`);
  if (range !== null && (!NPM_RANGE.test(range) || /^(?:file|git|http|https|link|workspace|npm|github)\b/iu.test(range))) {
    fail("invalid-dependency", `${spec} asks for something other than a version range`);
  }
  return Object.freeze({ name, range });
}

// A registry dependency is another item: a bare name, a namespaced name (@magicui/marquee), an
// owner/repo/name shorthand, or an https URL with no credentials.
function parseRegistryDependency(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) fail("invalid-registry-dependency", "a registry dependency must be a name or an https URL");
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      fail("invalid-registry-dependency", `${value} is not a URL`);
    }
    if (url.protocol !== "https:") fail("invalid-registry-dependency", `${value} is not an https URL`);
    if (url.username || url.password) fail("invalid-registry-dependency", `${value} carries credentials`);
    return value;
  }
  if (!/^@?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*){0,2}$/u.test(value)) fail("invalid-registry-dependency", `${value} is not an item name`);
  return value;
}

// A CSS variable's value is data for a token: no rule, block, markup, URL or import may hide in it.
const CSS_VALUE_REFUSED = /[;{}<>\\]|url\s*\(|expression\s*\(|@import|javascript:/iu;

function parseCssVars(value) {
  if (!isPlainObject(value)) fail("invalid-css-vars", "cssVars must be an object");
  const result = {};
  let count = 0;
  for (const [scope, vars] of Object.entries(value)) {
    if (!["theme", "light", "dark"].includes(scope)) fail("invalid-css-vars", `cssVars has an unknown scope ${scope}`);
    if (!isPlainObject(vars)) fail("invalid-css-vars", `cssVars.${scope} must be an object`);
    const entries = [];
    for (const [name, raw] of Object.entries(vars)) {
      count += 1;
      if (count > REGISTRY_ITEM_LIMITS.cssVars) fail("invalid-css-vars", `cssVars has more than ${REGISTRY_ITEM_LIMITS.cssVars} variables`);
      if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/u.test(name)) fail("invalid-css-vars", `${name} is not a CSS variable name`);
      if (typeof raw !== "string" || raw.length > 256 || CSS_VALUE_REFUSED.test(raw)) fail("invalid-css-vars", `--${name} has a value a token cannot hold`);
      entries.push([name, raw]);
    }
    result[scope] = Object.freeze(Object.fromEntries(entries));
  }
  return Object.freeze(result);
}

// Global CSS an item adds (keyframes, layers, utilities) is kept as data for review: it is
// bounded, and holds no import, URL or script.
function measureCss(value, depth = 0, counter = { rules: 0 }) {
  if (depth > 6) fail("invalid-css", "css is nested too deeply");
  if (!isPlainObject(value)) fail("invalid-css", "css must be an object of rules");
  for (const [selector, body] of Object.entries(value)) {
    counter.rules += 1;
    if (counter.rules > REGISTRY_ITEM_LIMITS.cssRules) fail("invalid-css", `css has more than ${REGISTRY_ITEM_LIMITS.cssRules} rules`);
    if (selector.length > 256 || /url\s*\(|@import|[<>\\]/iu.test(selector)) fail("invalid-css", `the css rule ${selector.slice(0, 40)} is refused`);
    if (typeof body === "string") {
      if (body.length > 512 || CSS_VALUE_REFUSED.test(body)) fail("invalid-css", `the css value under ${selector.slice(0, 40)} is refused`);
    } else measureCss(body, depth + 1, counter);
  }
  return counter.rules;
}

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"'\n]{1,214})["']/gu;

/**
 * Which accessible primitive family an item builds on, from its dependencies and the modules its
 * files import: Base UI, Radix, React Aria, none, or mixed (refused: one component, one family).
 */
export function primitiveFamily({ dependencies = [], files = [] }) {
  const evidence = new Set();
  const note = (name) => {
    if (name === "@base-ui/react" || name.startsWith("@base-ui/react/") || name === "@base-ui-components/react" || name.startsWith("@base-ui-components/react/")) evidence.add("base:" + name);
    else if (name === "radix-ui" || name.startsWith("@radix-ui/")) evidence.add("radix:" + name);
    else if (name === "react-aria-components" || name.startsWith("react-aria")) evidence.add("aria:" + name);
  };
  for (const dependency of dependencies) note(dependency.name);
  for (const file of files) {
    for (const match of file.content.matchAll(IMPORT_SPECIFIER)) note(match[1]);
  }
  const families = new Set([...evidence].map((entry) => entry.slice(0, entry.indexOf(":"))));
  const family = families.size === 0 ? "none" : families.size === 1 ? [...families][0] : "mixed";
  return Object.freeze({ family, evidence: Object.freeze([...evidence].sort()) });
}

/** Read one registry item, refusing anything unsafe or out of bounds. Returns a frozen copy. */
export function parseRegistryItem(text) {
  if (typeof text !== "string") fail("not-text", "a registry item must be JSON text");
  if (utf8Length(text) > REGISTRY_ITEM_LIMITS.bytes) fail("too-large", `a registry item is limited to ${REGISTRY_ITEM_LIMITS.bytes / 1024 / 1024} MiB`);
  let item;
  try {
    item = JSON.parse(text, (key, value) => {
      if (key === "__proto__" || key === "constructor" || key === "prototype") fail("invalid-field", `the key ${key} is refused`);
      return value;
    });
  } catch (error) {
    if (error instanceof RegistryItemError) throw error;
    fail("not-json", "a registry item must be valid JSON");
  }
  if (!isPlainObject(item)) fail("not-an-item", "a registry item must be a JSON object");
  if (typeof item.name !== "string" || !NAME.test(item.name)) fail("invalid-name", "a registry item needs a name of letters, digits, dots, dashes and underscores");
  if (typeof item.type !== "string") fail("invalid-type", "a registry item needs a type");
  if (PROJECT_ITEM_TYPES.has(item.type)) fail("project-item", `${item.type} reconfigures a whole project and is not imported as a component`);
  if (!IMPORTABLE_ITEM_TYPES.includes(item.type)) fail("invalid-type", `${item.type} is not a registry item type`);

  const list = (key, max) => {
    if (!Object.hasOwn(item, key)) return [];
    if (!Array.isArray(item[key]) || item[key].length > max) fail("invalid-field", `${key} must be a list of at most ${max} entries`);
    return item[key];
  };
  const dependencies = Object.freeze(list("dependencies", REGISTRY_ITEM_LIMITS.dependencies).map(parseDependency));
  const devDependencies = Object.freeze(list("devDependencies", REGISTRY_ITEM_LIMITS.dependencies).map(parseDependency));
  const registryDependencies = Object.freeze(list("registryDependencies", REGISTRY_ITEM_LIMITS.registryDependencies).map(parseRegistryDependency));

  const files = Object.freeze(list("files", REGISTRY_ITEM_LIMITS.files).map((file, index) => {
    if (!isPlainObject(file)) fail("invalid-file", `file ${index + 1} must be an object`);
    if (typeof file.path !== "string") fail("invalid-file", `file ${index + 1} needs a path`);
    const pathProblem = unsafePathReason(file.path);
    if (pathProblem) fail("unsafe-path", `file ${file.path.slice(0, 80)}: ${pathProblem}`);
    if (typeof file.content !== "string") fail("invalid-file", `${file.path} has no content`);
    const bytes = utf8Length(file.content);
    if (bytes > REGISTRY_ITEM_LIMITS.fileBytes) fail("invalid-file", `${file.path} is larger than ${REGISTRY_ITEM_LIMITS.fileBytes / 1024} KiB`);
    const type = file.type ?? item.type;
    if (typeof type !== "string" || !FILE_TYPES.has(type)) fail("invalid-file", `${file.path} has an unknown type`);
    let target = null;
    if (Object.hasOwn(file, "target") && file.target !== "") {
      if (typeof file.target !== "string") fail("invalid-file", `${file.path} has a target that is not text`);
      const placeholder = Object.keys(PLACEHOLDERS).find((prefix) => file.target.startsWith(prefix));
      if (!placeholder && file.target.includes("@")) fail("unsafe-path", `${file.target.slice(0, 80)}: a placeholder may only begin a target`);
      const targetProblem = unsafePathReason(placeholder ? file.target.slice(placeholder.length) : file.target);
      if (targetProblem) fail("unsafe-path", `target ${file.target.slice(0, 80)}: ${targetProblem}`);
      target = file.target;
    } else if (type === "registry:file" || type === "registry:page") fail("invalid-file", `${file.path} is a ${type} and needs a target`);
    return Object.freeze({ path: file.path, type, target, content: file.content, bytes });
  }));
  if (files.length === 0 && item.type !== "registry:theme" && !Object.hasOwn(item, "cssVars")) fail("empty-item", "the item has no files and no tokens");

  const cssVars = Object.hasOwn(item, "cssVars") ? parseCssVars(item.cssVars) : Object.freeze({});
  const cssRules = Object.hasOwn(item, "css") ? measureCss(item.css) : 0;
  const css = Object.hasOwn(item, "css") ? item.css : null;
  // An item asking to write environment variables is refused: secrets and configuration are the
  // person's own, never a registry's.
  if (Object.hasOwn(item, "envVars")) fail("env-vars", "the item asks to write environment variables, which an import never does");

  const ignored = Object.keys(item).filter((key) => !KNOWN_FIELDS.has(key) || key === "tailwind" || key === "meta" || key === "extends").sort();
  return Object.freeze({
    name: item.name,
    type: item.type,
    title: optionalText(item, "title", 200),
    description: optionalText(item, "description", 2000),
    author: optionalText(item, "author", 200),
    dependencies,
    devDependencies,
    registryDependencies,
    files,
    cssVars,
    css,
    cssRules,
    ignored: Object.freeze(ignored),
    primitives: primitiveFamily({ dependencies, files }),
  });
}

/** The project folders an item's placeholders and file types map to, from components.json. */
export const DEFAULT_LAYOUT = Object.freeze({ components: "components", ui: ["components", "ui"].join("/"), lib: "lib", hooks: "hooks" });

export function checkLayout(layout) {
  if (!isPlainObject(layout)) fail("invalid-layout", "a project layout must be an object");
  const result = {};
  for (const key of ["components", "ui", "lib", "hooks"]) {
    const value = layout[key] ?? DEFAULT_LAYOUT[key];
    const problem = unsafePathReason(value);
    if (problem) fail("invalid-layout", `the ${key} folder ${String(value).slice(0, 80)}: ${problem}`);
    result[key] = value;
  }
  return Object.freeze(result);
}

const basename = (path) => path.slice(path.lastIndexOf("/") + 1);
const TYPE_FOLDER = { "registry:ui": "ui", "registry:component": "components", "registry:block": "components", "registry:lib": "lib", "registry:hook": "hooks", "registry:item": "components", "registry:theme": "lib" };

/**
 * Where in the project one of an item's files goes, as a project-relative path with `/`, and
 * whether it may be written. A file with no target goes in its type's folder.
 */
export function resolveTarget(file, layout = DEFAULT_LAYOUT) {
  const folders = checkLayout(layout);
  let path;
  if (file.target === null) path = `${folders[TYPE_FOLDER[file.type] ?? "components"]}/${basename(file.path)}`;
  else if (file.target.startsWith("~/")) path = file.target.slice(2);
  else {
    const placeholder = Object.keys(PLACEHOLDERS).find((prefix) => file.target.startsWith(prefix));
    path = placeholder ? `${folders[PLACEHOLDERS[placeholder]]}/${file.target.slice(placeholder.length)}` : file.target;
  }
  return Object.freeze({ path, refused: unwritableReason(path) });
}

/**
 * Every item an item needs, dependencies first, from items the caller already holds. `lookup`
 * returns a parsed item or null; nothing is fetched. A cycle or an unknown item is reported.
 */
export function registryClosure(root, lookup) {
  const order = [];
  const missing = new Set();
  const state = new Map();
  const visit = (item, depth) => {
    if (depth > REGISTRY_ITEM_LIMITS.closureDepth) fail("closure-too-deep", `the items ${root.name} needs nest more than ${REGISTRY_ITEM_LIMITS.closureDepth} deep`);
    state.set(item.name, "visiting");
    for (const name of item.registryDependencies) {
      if (state.get(name) === "visiting") fail("closure-cycle", `${name} depends on itself through ${item.name}`);
      if (state.get(name) === "done") continue;
      const next = lookup(name);
      if (next === null || next === undefined) {
        missing.add(name);
        continue;
      }
      if (next.name !== name && !/^https:/u.test(name) && !name.includes("/")) fail("closure-mismatch", `${name} was answered by an item named ${next.name}`);
      visit(next, depth + 1);
      state.set(name, "done");
    }
    order.push(item);
    if (order.length > REGISTRY_ITEM_LIMITS.closureItems) fail("closure-too-large", `${root.name} needs more than ${REGISTRY_ITEM_LIMITS.closureItems} items`);
    state.set(item.name, "done");
  };
  visit(root, 0);
  return Object.freeze({ order: Object.freeze(order), missing: Object.freeze([...missing].sort()) });
}

/**
 * The catalog source an https URL belongs to, or null: the source whose registry serves it, or a
 * source with no usable registry whose site it is on, so that source's import policy still holds
 * (an Aceternity UI or 21st.dev URL is that source's, and refused, not an unknown file).
 */
export function sourceForRegistryUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  for (const source of UI_COMPONENT_SOURCES) {
    if (source.registry === null) continue;
    const pattern = new URL(source.registry.replace("{style}", "s").replace("{name}", "n"));
    const prefix = source.registry.slice(0, source.registry.search(/\{(?:style|name)\}/u));
    if (parsed.host === pattern.host && url.startsWith(prefix) && parsed.pathname.endsWith(".json")) return source;
  }
  const host = parsed.hostname.replace(/^www\./u, "");
  for (const source of UI_COMPONENT_SOURCES) {
    if (source.importPolicy !== "permission-required") continue;
    const site = new URL(source.website).hostname.replace(/^www\./u, "");
    if (host === site || host.endsWith("." + site)) return source;
  }
  return null;
}

/**
 * Whether a person may import an item from a catalog source, from its import policy. A free-only
 * source needs the person's word that the item is a free one; an attribution source says what
 * credit their project must show.
 */
export function importDecision(source, { freeItemConfirmed = false } = {}) {
  if (source === null || source === undefined) return Object.freeze({ allowed: true, reason: "The item is from a file you chose, not a catalog source: its license is yours to check.", attribution: null });
  switch (source.importPolicy) {
    case "allowed":
      return Object.freeze({ allowed: true, reason: `${source.name}: ${source.license}. Keep its license notice.`, attribution: null });
    case "allowed-with-attribution":
      return Object.freeze({ allowed: true, reason: `${source.name}: ${source.license}.`, attribution: source.id === "rareui-swami" ? "https://rareui.com" : source.website });
    case "free-items-only":
      return freeItemConfirmed
        ? Object.freeze({ allowed: true, reason: `${source.name}: a free item, under the MIT license.`, attribution: null })
        : Object.freeze({ allowed: false, reason: `${source.name} licenses only its free items for import; confirm this is one.`, attribution: null });
    default:
      return Object.freeze({ allowed: false, reason: `${source.name}: ${source.rights}`, attribution: null });
  }
}
