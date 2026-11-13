// Build Ninerr's normalized component records for Meta Astryx from a local checkout pinned at
// ASTRYX_COMMIT. Nothing from the checkout runs: each component's *.doc.mjs is parsed with
// @babel/parser and only literal values (objects, arrays, strings, numbers, booleans, null and
// template strings without expressions) are read. Any other value is left out and counted.
//
//   git clone https://github.com/meta/astryx.git <dir> && git -C <dir> checkout <ASTRYX_COMMIT>
//   node scripts/component-sources/astryx-snapshot.mjs <dir>
//
// It writes packages/component-sources/src/astryx-records.mjs; tests/astryx-source.test.mjs checks it.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

import { ASTRYX } from "../../packages/component-sources/src/records.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = join(ROOT, "packages/component-sources/src/astryx-records.mjs");
const checkout = process.argv[2];
if (!checkout) throw new Error("usage: node scripts/component-sources/astryx-snapshot.mjs <astryx checkout>");
// Use a fresh clone: git honours the checkout's own .git/config.
const git = (...args) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (git("rev-parse", "HEAD").trim() !== ASTRYX.commit) throw new Error(`the checkout is not at ${ASTRYX.commit}`);
// Files are read from the commit itself, so line-ending settings cannot change their text or hash.
const read = (path) => git("show", `${ASTRYX.commit}:${path}`);
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const tracked = git("ls-tree", "-r", "--name-only", ASTRYX.commit, "packages/core/src").trim().split("\n");
const core = JSON.parse(read("packages/core/package.json"));
const themes = git("ls-tree", "-r", "--name-only", ASTRYX.commit, "packages/themes").trim().split("\n")
  .filter((path) => /^packages\/themes\/[^/]+\/package\.json$/u.test(path))
  .map((path) => JSON.parse(read(path)))
  .filter((pkg) => pkg.private !== true)
  .map((pkg) => pkg.name)
  .sort();

let omitted = 0;
// The literal value of an expression, or undefined (counted) for anything that is not a literal.
// A name refers to a top-level const of the same file whose value is a literal.
const literal = (node, consts, seen = new Set()) => {
  switch (node?.type) {
    case "ObjectExpression": {
      const object = {};
      for (const property of node.properties) {
        const key = property.type === "ObjectProperty" && !property.computed ? (property.key.type === "Identifier" ? property.key.name : property.key.value) : undefined;
        const value = typeof key === "string" ? literal(property.value, consts, seen) : undefined;
        if (typeof key !== "string") omitted += 1;
        else if (value !== undefined && key !== "__proto__") object[key] = value;
      }
      return object;
    }
    case "ArrayExpression": return node.elements.map((element) => (element ? literal(element, consts, seen) : null)).filter((value) => value !== undefined);
    case "StringLiteral": case "NumericLiteral": case "BooleanLiteral": return node.value;
    case "NullLiteral": return null;
    case "TemplateLiteral":
      if (node.expressions.length === 0) return node.quasis.map((quasi) => quasi.value.cooked).join("");
      omitted += 1;
      return undefined;
    case "Identifier":
      if (consts.has(node.name) && !seen.has(node.name)) return literal(consts.get(node.name), consts, new Set(seen).add(node.name));
      omitted += 1;
      return undefined;
    default:
      omitted += 1;
      return undefined;
  }
};

const text = (value, max = 2000) => (typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : null);
const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
// The values of a union of single-quoted string literals, such as "'sm' | 'md' | 'lg'"; else null.
const unionValues = (type) => {
  const parts = String(type).split("|").map((part) => part.trim());
  return parts.length > 1 && parts.every((part) => /^'[^']*'$/u.test(part)) ? parts.map((part) => part.slice(1, -1)) : null;
};
const propsOf = (list) => (Array.isArray(list) ? list : []).filter((prop) => typeof prop?.name === "string").map((prop) => ({
  name: prop.name,
  type: text(prop.type, 400) ?? "unknown",
  required: prop.required === true,
  default: text(prop.default, 200),
  description: text(prop.description, 600) ?? "",
  values: unionValues(prop.type),
}));

const clientOnly = (code) => /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/u.test(code);
const isTest = (path) => /(\.test\.|\.spec\.|\/__tests__\/|\.stories\.|\.doc\.mjs$|test-violations)/u.test(path);
// A component's own file: <name>.tsx in its doc's folder, else anywhere in core's source.
const mainFileOf = (name, dir) => tracked.find((path) => path === `${dir}/${name}.tsx`) ?? tracked.find((path) => path.endsWith(`/${name}.tsx`) && !isTest(path)) ?? null;
// It needs React on the client when its own file or its folder's entry says 'use client'; a
// component whose file cannot be found is taken to need it.
const needsClient = (main, dir) => {
  if (main === null) return true;
  const entries = [main, `${main.split("/").slice(0, -1).join("/")}/index.ts`, `${dir}/index.ts`].filter((path, at, all) => tracked.includes(path) && all.indexOf(path) === at);
  return entries.some((path) => clientOnly(read(path)));
};
// What a person meets using it from Ninerr, beyond what its docs say.
const limitationsOf = (client, deprecated) => [
  ...(client ? ["Needs React on the client for its behaviour. Ninerr's script-free canvas can show its markup and styles, not its interaction."] : []),
  "Copied (swizzled) source is StyleX: the project needs @astryxdesign/build or the StyleX compiler. Installing the package and its prebuilt astryx.css needs neither.",
  ...(deprecated ? [`Deprecated upstream: ${typeof deprecated === "string" ? deprecated : "see its docs"}`] : []),
];
// Components only: hooks (useX) and factory functions (createX) are not.
const isComponentName = (name) => typeof name === "string" && /^[A-Z][A-Za-z0-9]*$/u.test(name);

// Each documented component: a doc's own entry, and the parts its `components` list documents.
const entries = new Map();
for (const docPath of tracked.filter((path) => path.endsWith(".doc.mjs"))) {
  const dir = docPath.split("/").slice(0, -1).join("/");
  const source = read(docPath);
  const ast = parse(source, { sourceType: "module" });
  const consts = new Map(ast.program.body
    .flatMap((statement) => (statement.type === "VariableDeclaration" ? statement.declarations : statement.type === "ExportNamedDeclaration" && statement.declaration?.type === "VariableDeclaration" ? statement.declaration.declarations : []))
    .filter((item) => item.id.type === "Identifier" && item.init)
    .map((item) => [item.id.name, item.init]));
  const doc = consts.has("docs") ? literal(consts.get("docs"), consts) : null;
  if (!doc || !isComponentName(doc.name) || doc.hidden === true) continue;
  const parts = (Array.isArray(doc.components) ? doc.components : []).filter((part) => isComponentName(part?.name));
  const own = parts.find((part) => part.name === doc.name);
  const at = { path: docPath, sha256: sha256(source) };
  entries.set(doc.name, { doc, part: own ?? null, dir, at, partOf: typeof doc.subComponentOf === "string" ? doc.subComponentOf : null });
  // A part documented only in this doc's list: a part of this component.
  for (const part of parts) if (part.name !== doc.name && !entries.has(part.name)) entries.set(part.name, { doc: null, part, dir, at, partOf: typeof part.subComponentOf === "string" ? part.subComponentOf : doc.name, parent: doc });
}
// A part listed by a parent and also documented in its own doc keeps its own doc.
for (const [name, entry] of entries) if (entry.doc === null && tracked.some((path) => path.endsWith(`/${name}.doc.mjs`))) entries.delete(name);

const records = [];
for (const [name, { doc, part, dir, at, partOf, parent }] of entries) {
  const folder = dir.split("/").at(-1);
  const main = mainFileOf(name, dir);
  const client = needsClient(main, dir);
  const exportPath = `./${folder}`;
  const props = propsOf(doc?.props ?? part?.props);
  const usage = doc?.usage ?? {};
  const practices = Array.isArray(usage.bestPractices) ? usage.bestPractices : [];
  const files = tracked.filter((path) => path.startsWith(`${dir}/`));
  const deprecated = doc?.deprecated ?? part?.deprecated;
  records.push({
    id: `${ASTRYX.id}:${name}`,
    source: ASTRYX.id,
    name,
    description: text(usage.description) ?? text(doc?.description) ?? text(part?.description) ?? "",
    category: typeof (doc ?? parent)?.category === "string" ? (doc ?? parent).category : null,
    subComponentOf: partOf,
    keywords: strings(doc?.keywords).slice(0, 40),
    framework: `react ${core.peerDependencies.react}`,
    styling: "stylex",
    importPath: typeof (doc ?? part)?.importPath === "string" ? (doc ?? part).importPath : Object.hasOwn(core.exports, exportPath) ? `${core.name}${exportPath.slice(1)}` : null,
    dependencies: Object.fromEntries(Object.entries({ ...core.dependencies, ...core.peerDependencies }).sort()),
    props,
    variants: props.filter((prop) => prop.values !== null).map((prop) => ({ prop: prop.name, values: prop.values, default: prop.default })),
    accessibility: (Array.isArray(usage.accessibility) ? usage.accessibility : []).filter((item) => typeof item?.name === "string").map((item) => ({
      name: item.name, criterion: text(item.criterion, 200), requirement: text(item.requirement, 200), description: text(item.description, 600) ?? "",
    })),
    guidance: practices.filter((item) => typeof item?.description === "string").map((item) => ({ do: item.guidance !== false, text: text(item.description, 600) })),
    themes,
    themingTargets: (Array.isArray(doc?.theming?.targets) ? doc.theming.targets : []).map((target) => target?.className).filter((value) => typeof value === "string"),
    examples: (Array.isArray(doc?.examples) ? doc.examples : []).filter((item) => typeof item?.code === "string").slice(0, 3).map((item) => ({ label: text(item.label, 200) ?? "", code: item.code.trim().slice(0, 4000) })),
    limitations: limitationsOf(client, deprecated),
    rendering: client ? "client" : "server-safe",
    // A part of another component shares its folder: the folder's files are listed on that component.
    sourceFiles: partOf !== null ? (main === null ? [] : [main]) : files.filter((path) => !isTest(path)),
    tests: partOf !== null ? [] : files.filter((path) => isTest(path) && !path.endsWith(".doc.mjs")),
    doc: at,
    status: deprecated ? "deprecated" : "stable",
  });
}
records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const snapshot = {
  source: ASTRYX.id,
  repository: ASTRYX.repository,
  commit: ASTRYX.commit,
  package: { name: core.name, version: core.version },
  license: { spdx: core.license, copyright: read("LICENSE").split("\n").find((line) => line.startsWith("Copyright")) },
  generatedBy: "scripts/component-sources/astryx-snapshot.mjs",
  omittedValues: omitted,
  components: records,
};
// One component per line, so a regenerated snapshot diffs by component.
const { components, ...head } = snapshot;
const body = `${JSON.stringify(head).slice(0, -1)},"components":[\n${components.map((record) => JSON.stringify(record)).join(",\n")}\n]}`;
writeFileSync(OUT, `// Generated by scripts/component-sources/astryx-snapshot.mjs from ${ASTRYX.repository} at ${ASTRYX.commit}.\n// Component metadata from Meta Astryx, MIT License, ${snapshot.license.copyright}; see ./ASTRYX_LICENSE.\n// Do not edit by hand: regenerate it.\nexport default ${body};\n`);
console.log(`${records.length} components, ${omitted} non-literal values left out, ${Buffer.byteLength(readFileSync(OUT))} bytes`);
