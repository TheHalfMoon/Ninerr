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
const git = (...args) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== ASTRYX.commit) throw new Error(`the checkout is not at ${ASTRYX.commit}`);
if (git("status", "--porcelain") !== "") throw new Error("the checkout has local changes");

const read = (path) => readFileSync(join(checkout, path), "utf8");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const tracked = git("ls-files", "packages/core/src").split("\n");
const core = JSON.parse(read("packages/core/package.json"));
const themes = git("ls-files", "packages/themes/*/package.json").split("\n")
  .map((path) => JSON.parse(read(path)))
  .filter((pkg) => pkg.private !== true)
  .map((pkg) => pkg.name)
  .sort();

let omitted = 0;
// The literal value of an expression, or undefined (counted) for anything that is not a literal.
const literal = (node) => {
  switch (node?.type) {
    case "ObjectExpression": {
      const object = {};
      for (const property of node.properties) {
        const key = property.type === "ObjectProperty" && !property.computed ? (property.key.type === "Identifier" ? property.key.name : property.key.value) : undefined;
        const value = typeof key === "string" ? literal(property.value) : undefined;
        if (typeof key !== "string") omitted += 1;
        else if (value !== undefined && key !== "__proto__") object[key] = value;
      }
      return object;
    }
    case "ArrayExpression": return node.elements.map((element) => (element ? literal(element) : null)).filter((value) => value !== undefined);
    case "StringLiteral": case "NumericLiteral": case "BooleanLiteral": return node.value;
    case "NullLiteral": return null;
    case "TemplateLiteral":
      if (node.expressions.length === 0) return node.quasis.map((quasi) => quasi.value.cooked).join("");
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

const clientOnly = (code) => /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/u.test(code);
// What a person meets using it from Ninerr, beyond what its docs say.
const limitationsOf = (client, doc) => [
  ...(client ? ["Needs React on the client for its behaviour. Ninerr's script-free canvas can show its markup and styles, not its interaction."] : []),
  "Copied (swizzled) source is StyleX: the project needs @astryxdesign/build or the StyleX compiler. Installing the package and its prebuilt astryx.css needs neither.",
  ...(doc.deprecated ? [`Deprecated upstream: ${typeof doc.deprecated === "string" ? doc.deprecated : "see its docs"}`] : []),
];

const records = [];
for (const docPath of tracked.filter((path) => path.endsWith(".doc.mjs"))) {
  const dir = docPath.split("/").slice(0, -1).join("/");
  const folder = dir.split("/").at(-1);
  const source = read(docPath);
  const ast = parse(source, { sourceType: "module" });
  const declaration = ast.program.body
    .filter((statement) => statement.type === "ExportNamedDeclaration" && statement.declaration?.type === "VariableDeclaration")
    .flatMap((statement) => statement.declaration.declarations)
    .find((item) => item.id.type === "Identifier" && item.id.name === "docs");
  const doc = declaration ? literal(declaration.init) : null;
  // Components only: hooks (useX, with params and returns) and hidden entries are left out.
  if (!doc || typeof doc.name !== "string" || /^use[A-Z]/u.test(doc.name) || doc.hidden === true || !Array.isArray(doc.props) && typeof doc.category !== "string" && typeof doc.subComponentOf !== "string") continue;
  const files = tracked.filter((path) => path.startsWith(`${dir}/`));
  const isTest = (path) => /(\.test\.|\.spec\.|\/__tests__\/|\.stories\.|\.doc\.mjs$|test-violations)/u.test(path);
  const main = `${dir}/${doc.name}.tsx`;
  const exportPath = `./${folder}`;
  const props = (Array.isArray(doc.props) ? doc.props : []).filter((prop) => typeof prop?.name === "string").map((prop) => ({
    name: prop.name,
    type: text(prop.type, 400) ?? "unknown",
    required: prop.required === true,
    default: text(prop.default, 200),
    description: text(prop.description, 600) ?? "",
    values: unionValues(prop.type),
  }));
  const usage = doc.usage ?? {};
  const practices = Array.isArray(usage.bestPractices) ? usage.bestPractices : [];
  records.push({
    id: `${ASTRYX.id}:${doc.name}`,
    source: ASTRYX.id,
    name: doc.name,
    description: text(usage.description) ?? text(doc.description) ?? "",
    category: typeof doc.category === "string" ? doc.category : null,
    subComponentOf: typeof doc.subComponentOf === "string" ? doc.subComponentOf : null,
    keywords: strings(doc.keywords).slice(0, 40),
    framework: `react ${core.peerDependencies.react}`,
    styling: "stylex",
    importPath: typeof doc.importPath === "string" ? doc.importPath : Object.hasOwn(core.exports, exportPath) ? `${core.name}${exportPath.slice(1)}` : null,
    dependencies: Object.fromEntries(Object.entries({ ...core.dependencies, ...core.peerDependencies }).sort()),
    props,
    variants: props.filter((prop) => prop.values !== null).map((prop) => ({ prop: prop.name, values: prop.values, default: prop.default })),
    accessibility: (Array.isArray(usage.accessibility) ? usage.accessibility : []).filter((item) => typeof item?.name === "string").map((item) => ({
      name: item.name, criterion: text(item.criterion, 200), requirement: text(item.requirement, 200), description: text(item.description, 600) ?? "",
    })),
    guidance: practices.filter((item) => typeof item?.description === "string").map((item) => ({ do: item.guidance !== false, text: text(item.description, 600) })),
    themes,
    themingTargets: (Array.isArray(doc.theming?.targets) ? doc.theming.targets : []).map((target) => target?.className).filter((name) => typeof name === "string"),
    examples: (Array.isArray(doc.examples) ? doc.examples : []).filter((item) => typeof item?.code === "string").slice(0, 3).map((item) => ({ label: text(item.label, 200) ?? "", code: item.code.trim().slice(0, 4000) })),
    // A component whose main file starts with 'use client' needs React on the client to work.
    limitations: limitationsOf(files.includes(main) && clientOnly(read(main)), doc),
    rendering: files.includes(main) && clientOnly(read(main)) ? "client" : "server-safe",
    // A part of another component shares its folder: the folder's files are listed on that component.
    sourceFiles: typeof doc.subComponentOf === "string" ? files.filter((path) => path === main) : files.filter((path) => !isTest(path)),
    tests: typeof doc.subComponentOf === "string" ? [] : files.filter((path) => isTest(path) && !path.endsWith(".doc.mjs")),
    doc: { path: docPath, sha256: sha256(source) },
    status: doc.deprecated ? "deprecated" : "stable",
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
