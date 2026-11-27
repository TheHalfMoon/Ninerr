#!/usr/bin/env node
// Build the Ninerr Engine package: the `ninerr` command and its headless MCP server, as an npm
// package that installs with `npm install -g <tarball>` and runs on Node.js with no build step
// and no TypeScript loader (docs/HEADLESS.md).
//
//   node scripts/build-engine.mjs [--out <folder>] [--pack]
//
// Each workspace package but the desktop app is copied under the engine's own
// node_modules/@ninerr/ as a bundled dependency, with its TypeScript stripped to JavaScript by
// Node.js itself (node:module stripTypeScriptTypes): Node.js runs no TypeScript from inside
// node_modules, so an installed engine carries none. The third-party packages are dependencies
// at the exact versions the lockfile has. --pack also writes the tarball with `npm pack`.
// Nothing is published.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
// Only workspace packages actually reachable from bin/ninerr.mjs (through @ninerr/* imports
// and workspace dependencies) are bundled into the headless engine package; the frozen desktop
// app, browser studio-web UI, and unreferenced research/governance packages stay out.
const LEFT_OUT = new Set(["desktop", "studio-web"]);
const RELATIVE_TS = /((?:from|import)\s*\(?\s*)(["'])(\.{1,2}\/[^"'\n]+?)\.ts\2/gu;
const WORKSPACE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["']@ninerr\/([a-z][a-z0-9-]*)["']/gmu;

/** Workspace packages reachable from `entry` (excluding desktop and browser UI). */
export function engineReachablePackages(entry = join(ROOT, "bin", "ninerr.mjs")) {
  const found = new Set();
  const queue = [];
  const enqueue = (name) => {
    if (LEFT_OUT.has(name) || found.has(name)) return;
    if (!existsSync(join(ROOT, "packages", name, "package.json"))) fail(`unknown workspace package @ninerr/${name}`);
    found.add(name);
    queue.push(name);
  };
  const entryText = readFileSync(entry, "utf8");
  for (const [, name] of entryText.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["']\.\.\/packages\/([a-z][a-z0-9-]*)\//gu)) enqueue(name);
  for (const [, name] of entryText.matchAll(WORKSPACE_IMPORT)) enqueue(name);
  while (queue.length > 0) {
    const name = queue.pop();
    const pkgDir = join(ROOT, "packages", name);
    const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      if (dep.startsWith("@ninerr/")) enqueue(dep.slice("@ninerr/".length));
    }
    for (const rel of filesUnder(pkgDir)) {
      if (!/\.(?:mjs|js|cjs|ts)$/u.test(rel)) continue;
      const text = readFileSync(join(pkgDir, rel), "utf8");
      for (const [, imported] of text.matchAll(WORKSPACE_IMPORT)) enqueue(imported);
    }
  }
  return [...found].sort();
}

function fail(message) {
  process.stderr.write(`build-engine: ${message}\n`);
  process.exit(2);
}

/** Every file under `folder`, as paths relative to it, in a stable order. */
function filesUnder(folder) {
  const found = [];
  const walk = (relativePath) => {
    for (const name of readdirSync(join(folder, relativePath)).sort()) {
      const path = relativePath === "" ? name : `${relativePath}/${name}`;
      if (name === "node_modules") continue;
      if (statSync(join(folder, path)).isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk("");
  return found;
}

/** A module's source with its relative `.ts` imports pointing at the `.js` files the build writes. */
export function retarget(source) {
  return source.replace(RELATIVE_TS, (_match, prefix, quote, path) => `${prefix}${quote}${path}.js${quote}`);
}

/** Build the engine package into `out`; returns its package.json. */
export function buildEngine(out) {
  const product = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "bin"), { recursive: true });

  const bundled = [];
  const external = new Map();
  for (const name of engineReachablePackages()) {
    const source = join(ROOT, "packages", name);
    const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    const target = join(out, "node_modules", "@ninerr", name);
    for (const path of filesUnder(source)) {
      const from = join(source, path);
      if (path === "package.json") continue;
      if (path.endsWith(".ts")) {
        const js = retarget(stripTypeScriptTypes(readFileSync(from, "utf8"), { mode: "strip" }));
        mkdirSync(dirname(join(target, path)), { recursive: true });
        writeFileSync(join(target, path.replace(/\.ts$/u, ".js")), js);
      } else if (path.endsWith(".mjs") || path.endsWith(".js")) {
        mkdirSync(dirname(join(target, path)), { recursive: true });
        writeFileSync(join(target, path), retarget(readFileSync(from, "utf8")));
      } else {
        mkdirSync(dirname(join(target, path)), { recursive: true });
        cpSync(from, join(target, path));
      }
    }
    const toJs = (value) => (typeof value === "string" ? value.replace(/\.ts$/u, ".js") : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toJs(entry)])));
    // A bundled package declares no dependencies: npm would take its third-party ones as bundled
    // too and install none. They are the engine's own dependencies, which Node.js finds from here.
    const { devDependencies: _dev, scripts: _scripts, dependencies: _dependencies, ...kept } = manifest;
    writeFileSync(join(target, "package.json"), `${JSON.stringify({ ...kept, ...(kept.main ? { main: toJs(kept.main) } : {}), ...(kept.exports ? { exports: toJs(kept.exports) } : {}) }, null, 2)}\n`);
    bundled.push(manifest.name);
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (dependency.startsWith("@ninerr/")) continue;
      const locked = lock.packages[`node_modules/${dependency}`]?.version;
      if (typeof locked !== "string") fail(`${dependency} is not in package-lock.json`);
      external.set(dependency, locked);
    }
  }

  // The command: the same bin, reaching the engine through its bundled package.
  const bin = readFileSync(join(ROOT, "bin", "ninerr.mjs"), "utf8").replace('"../packages/studio-host/src/index.ts"', '"@ninerr/studio-host"');
  if (!bin.includes('from "@ninerr/studio-host"')) fail("bin/ninerr.mjs no longer imports the studio host as the build expects");
  writeFileSync(join(out, "bin", "ninerr.mjs"), bin);
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md", "SECURITY.md", "README.md"]) cpSync(join(ROOT, file), join(out, file));

  const engine = {
    name: "ninerr",
    version: product.version,
    description: "Ninerr Engine: an agent-first, local design engine with a headless MCP server.",
    license: product.license,
    type: "module",
    bin: { ninerr: "bin/ninerr.mjs" },
    engines: { node: "^22.18.0 || >=24.11.0" },
    dependencies: Object.fromEntries([...[...external].sort(), ...bundled.map((name) => [name, "0.0.0"])]),
    bundleDependencies: bundled,
  };
  writeFileSync(join(out, "package.json"), `${JSON.stringify(engine, null, 2)}\n`);
  return engine;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--out");
  const out = resolve(at >= 0 && args[at + 1] ? args[at + 1] : join(ROOT, "dist", "engine"));
  // The build replaces its output folder: only a folder inside dist/ (never dist/ itself), or a new or empty one elsewhere.
  const inside = relative(ROOT, out);
  const underDist = inside.startsWith(`dist${sep}`) && inside.length > `dist${sep}`.length;
  if (!underDist && existsSync(out) && readdirSync(out).length > 0) fail(`${out} must be a folder inside dist/, or a new or empty one`);
  const engine = buildEngine(out);
  process.stdout.write(`built ${engine.name} ${engine.version} in ${out}: ${engine.bundleDependencies.length} bundled packages, ${Object.keys(engine.dependencies).length - engine.bundleDependencies.length} third-party\n`);
  if (args.includes("--pack")) {
    // npm on Windows is a .cmd, which runs only through a shell; the one argument is the build's own folder.
    const packed = process.platform === "win32"
      ? spawnSync(`npm pack --json --pack-destination "${dirname(out)}"`, { cwd: out, encoding: "utf8", shell: true })
      : spawnSync("npm", ["pack", "--json", "--pack-destination", dirname(out)], { cwd: out, encoding: "utf8" });
    if (packed.status !== 0) fail(`npm pack failed: ${packed.stderr}`);
    const [result] = JSON.parse(packed.stdout);
    process.stdout.write(`packed ${join(dirname(out), result.filename)} (${result.entryCount} files, sha512 ${result.integrity})\n`);
  }
}
